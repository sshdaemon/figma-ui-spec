import path from 'node:path';
import { parseThemeDeclarations, themeResidue } from '../catalogue/theme.ts';
import type { Token, TokenKind, TypographyVariant } from '../catalogue/types.ts';
import type { VariantDefinition } from '../catalogue/variants.ts';
import { variantName } from '../mapping/match.ts';
import type { Conflict } from '../spec/types.ts';

/** One file a change touches, repo-relative with forward slashes. */
export interface FileChange {
  readonly file: string;
  /** Both sides when known, `''` for a side where the file does not exist; absent when only the path is known. */
  readonly contents?: { readonly before: string; readonly after: string };
}

/** A conflict from a spec, with the spec it was decided in. */
export interface Decision {
  readonly spec: string;
  readonly conflict: Conflict;
}

export interface GuardInput {
  readonly changes: readonly FileChange[];
  /** Repo-relative globs of shared code. */
  readonly protectedPaths: readonly string[];
  /** Repo-relative files holding the project's `@theme` blocks. */
  readonly themeFiles: readonly string[];
  /** Typography components and the file each is defined in. */
  readonly typography: readonly { readonly component: string; readonly file: string }[];
  readonly variants: readonly TypographyVariant[];
  readonly tokens: readonly Token[];
  readonly decisions: readonly Decision[];
  /**
   * The cva definitions of the typography components in a file's contents, by component, and the contents with their
   * `variants` tables cut out; throws when they cannot be read.
   */
  readonly definitions: (file: string, contents: string) => TypographyFile;
}

export interface TypographyFile {
  readonly definitions: ReadonlyMap<string, VariantDefinition>;
  /** Everything but the variant tables: render code, other exports, base classes, defaults, compound variants. */
  readonly rest: string;
}

export type TokenChange = 'added' | 'removed' | 'changed';

export interface TokenDiff {
  readonly token: string;
  readonly change: TokenChange;
  readonly before?: string;
  readonly after?: string;
}

export interface Finding {
  readonly file: string;
  /** `token` for one theme variable; `file` for any other change to a protected file. */
  readonly kind: 'file' | 'token';
  readonly token?: string;
  readonly change?: TokenChange;
  readonly before?: string;
  readonly after?: string;
  /** The decisions that allow it, as `spec K3 new-variant (Sam, 2026-11-21)`. Empty for a finding that stands. */
  readonly coveredBy: readonly string[];
}

export interface GuardResult {
  /** Changes no decision covers. */
  readonly findings: readonly Finding[];
  /** Changes a `new-variant` or `token-change` decision allows. */
  readonly covered: readonly Finding[];
}

/**
 * Changes to shared code: each changed `@theme` variable, and any other change to a protected file. A `new-variant`
 * decision allows changes to the file of the component variant it names; a `token-change` decision allows changes to
 * the theme variables its nearest option uses.
 */
export function guard(input: GuardInput): GuardResult {
  const themeFiles = new Set(input.themeFiles.map(normal));
  const decided = input.decisions.filter((d) => d.conflict.outcome === 'new-variant' || d.conflict.outcome === 'token-change');
  const variants = variantCoverage(
    input,
    decided.filter((d) => d.conflict.outcome === 'new-variant'),
  );
  const tokens = tokenCoverage(
    input,
    decided.filter((d) => d.conflict.outcome === 'token-change'),
  );
  const all = input.changes.flatMap((change): Finding[] => {
    const file = normal(change.file);
    const isProtected = matchesPaths(file, input.protectedPaths);
    if (themeFiles.has(file)) return themeFindings(file, change, isProtected, tokens);
    return isProtected ? [{ file, kind: 'file', coveredBy: allowedVariantChange(input, file, change, variants) }] : [];
  });
  return { findings: all.filter((f) => f.coveredBy.length === 0), covered: all.filter((f) => f.coveredBy.length > 0) };
}

/** Whether a file is under the globs: it matches one, and no `!glob` after it excludes it again. */
export function matchesPaths(file: string, globs: readonly string[]): boolean {
  const f = normal(file);
  let matched = false;
  for (const glob of globs) {
    if (glob.startsWith('!')) {
      if (matched && path.matchesGlob(f, glob.slice(1))) matched = false;
    } else if (!matched) {
      matched = path.matchesGlob(f, glob);
    }
  }
  return matched;
}

/** Whether the guard looks at a file at all, so a change source can skip reading the rest. */
export function isGuarded(file: string, protectedPaths: readonly string[], themeFiles: readonly string[]): boolean {
  return themeFiles.map(normal).includes(normal(file)) || matchesPaths(file, protectedPaths);
}

function themeFindings(file: string, change: FileChange, isProtected: boolean, tokens: ReadonlyMap<string, string[]>): Finding[] {
  // Without contents the variables that change are unknown, so nothing short of a review of the edit allows it.
  if (!change.contents) return [{ file, kind: 'file', coveredBy: [] }];
  const { before, after } = change.contents;
  const out = tokenDiff(before, after).map((d): Finding => ({ file, kind: 'token', ...d, coveredBy: tokenCovers(d.token, tokens) }));
  if (isProtected && themeResidue(before) !== themeResidue(after)) out.push({ file, kind: 'file', coveredBy: [] });
  return out;
}

/** Theme variables added, removed or given another value; the last declaration of a name wins, as in CSS. */
export function tokenDiff(before: string, after: string): TokenDiff[] {
  const a = lastValues(before);
  const b = lastValues(after);
  const names = [...new Set([...a.keys(), ...b.keys()])];
  return names.flatMap((token): TokenDiff[] => {
    const was = a.get(token);
    const is = b.get(token);
    if (was === is) return [];
    if (was === undefined) return [{ token, change: 'added' as const, after: is as string }];
    if (is === undefined) return [{ token, change: 'removed' as const, before: was }];
    return [{ token, change: 'changed' as const, before: was, after: is }];
  });
}

function lastValues(css: string): Map<string, string> {
  return new Map(parseThemeDeclarations(css, 'project').map((d) => [d.name, d.value]));
}

interface VariantAllowance {
  readonly component: string;
  readonly prop: string;
  readonly value: string;
  readonly by: string;
}

/** For each typography file, the variants `new-variant` decisions name in it. */
function variantCoverage(input: GuardInput, decisions: readonly Decision[]): Map<string, VariantAllowance[]> {
  const out = new Map<string, VariantAllowance[]>();
  for (const d of decisions) {
    const variant = input.variants.find((v) => variantName(v) === d.conflict.nearest);
    const file = variant && input.typography.find((t) => t.component === variant.component)?.file;
    if (!variant || !file) continue;
    const allowance = { component: variant.component, prop: variant.prop, value: variant.value, by: describe(d) };
    out.set(normal(file), [...(out.get(normal(file)) ?? []), allowance]);
  }
  return out;
}

/**
 * The decisions that allow a change to a typography file: those naming a variant in it, when everything outside the
 * variant tables is unchanged and every other variant that existed keeps its classes. Added variants pass; anything
 * unreadable does not.
 */
function allowedVariantChange(input: GuardInput, file: string, change: FileChange, all: ReadonlyMap<string, VariantAllowance[]>): string[] {
  const allowances = all.get(file) ?? [];
  if (allowances.length === 0 || !change.contents) return [];
  let before: TypographyFile;
  let after: TypographyFile;
  try {
    before = input.definitions(file, change.contents.before);
    after = input.definitions(file, change.contents.after);
  } catch {
    return [];
  }
  const named = (component: string, prop: string, value: string): boolean =>
    allowances.some((a) => a.component === component && a.prop === prop && a.value === value);
  const kept =
    before.rest === after.rest &&
    [...before.definitions].every(([component, was]) => {
      const is = after.definitions.get(component);
      return is !== undefined && keepsOthers(was, is, (prop, value) => named(component, prop, value));
    });
  return kept ? [...new Set(allowances.map((a) => a.by))] : [];
}

/** Every variant value that existed, other than the named ones, is still there with the same classes. */
function keepsOthers(was: VariantDefinition, is: VariantDefinition, named: (prop: string, value: string) => boolean): boolean {
  return Object.entries(was.variants).every(([prop, values]) =>
    Object.entries(values).every(([value, classes]) => named(prop, value) || is.variants[prop]?.[value] === classes),
  );
}

/** For each theme variable a `token-change` decision allows, the decisions that allow it. */
function tokenCoverage(input: GuardInput, decisions: readonly Decision[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const d of decisions) {
    const variant = input.variants.find((v) => variantName(v) === d.conflict.nearest);
    const classes = variant ? variant.classes : d.conflict.nearest.split(/\s+/);
    for (const name of classes.flatMap((c) => tokensOf(c, input.tokens))) out.set(name, [...(out.get(name) ?? []), describe(d)]);
  }
  return out;
}

/** A variable is allowed when it, or the variable it is a companion of (`text-h4--line-height`), is. */
function tokenCovers(token: string, tokens: ReadonlyMap<string, string[]>): string[] {
  const owner = token.split('--')[0] ?? token;
  return [...new Set([...(tokens.get(token) ?? []), ...(tokens.get(owner) ?? [])])];
}

/** Class prefixes and the token kinds their value names. */
const PREFIX_KINDS: readonly (readonly [RegExp, readonly TokenKind[]])[] = [
  [/^text-/, ['text', 'color']],
  [/^(bg|border(-[xytrblse])?|ring|outline|fill|stroke|divide|accent|caret|decoration|placeholder|from|via|to)-/, ['color']],
  [/^font-/, ['font', 'font-weight']],
  [/^leading-/, ['leading']],
  [/^tracking-/, ['tracking']],
  [/^rounded(-(t|r|b|l|s|e|tl|tr|br|bl|ss|se|es|ee))?-/, ['radius']],
  [/^shadow-/, ['shadow', 'color']],
];

/** Theme variables a utility class reads, for example `color-lime-400` for `hover:bg-lime-400/50`. */
export function tokensOf(cls: string, tokens: readonly Token[]): string[] {
  const bare = (cls.split(':').at(-1) ?? cls).replace(/^[!-]/, '').replace(/\/[\d.]+$/, '');
  for (const [prefix, kinds] of PREFIX_KINDS) {
    const m = prefix.exec(bare);
    if (!m) continue;
    const key = bare.slice(m[0].length);
    const hits = tokens.filter((t) => kinds.includes(t.kind) && t.key === key).map((t) => t.name);
    if (hits.length > 0) return hits;
  }
  return [];
}

function describe(d: Decision): string {
  const c = d.conflict;
  const who = [c.decidedBy, c.decided].filter(Boolean).join(', ');
  return `${d.spec} ${c.id} ${c.outcome}${who ? ` (${who})` : ''}`;
}

function normal(file: string): string {
  return path.posix.normalize(file.split(path.sep).join('/'));
}
