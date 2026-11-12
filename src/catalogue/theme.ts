import type { Token, TokenKind, TokenOrigin } from './types.ts';

export interface Declaration {
  readonly name: string;
  readonly value: string;
  readonly origin: TokenOrigin;
}

export interface ThemeOptions {
  /** Pixels per rem. */
  readonly rootPx: number;
  /** Family names for font variables whose value is only known at runtime, keyed by token key (`roboto`). */
  readonly fontFamilies: Readonly<Record<string, string>>;
}

/** Top-level custom properties of every `@theme` block, in source order. Nested at-rules such as `@keyframes` are skipped. */
export function parseThemeDeclarations(css: string, origin: TokenOrigin): Declaration[] {
  const text = stripComments(css);
  const out: Declaration[] = [];
  const blockStart = /@theme\b[^{;]*\{/g;
  for (let match = blockStart.exec(text); match; match = blockStart.exec(text)) {
    const block = scanBlock(text, match.index + match[0].length);
    for (const statement of block.statements) {
      const decl = toDeclaration(statement, origin);
      if (decl) out.push(decl);
    }
    blockStart.lastIndex = block.end;
  }
  return out;
}

/** The `;`-terminated statements directly inside the block opening before `start`, and where the block ends. */
function scanBlock(text: string, start: number): { statements: string[]; end: number } {
  const statements: string[] = [];
  let depth = 1;
  let statement = '';
  let i = start;
  for (; i < text.length && depth > 0; i++) {
    const ch = text[i];
    if (ch === '{' || ch === '}') {
      depth += ch === '{' ? 1 : -1;
      statement = '';
    } else if (ch === ';') {
      if (depth === 1) statements.push(statement);
      statement = '';
    } else {
      statement += ch;
    }
  }
  return { statements, end: i };
}

/** Removes comments but not comment-like text inside strings, such as `@source "dist/*.js"`. */
export function stripComments(css: string): string {
  let out = '';
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const end = closingQuote(css, i);
      out += css.slice(i, end + 1);
      i = end;
    } else if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 1;
    } else {
      out += ch;
    }
  }
  return out;
}

function closingQuote(css: string, start: number): number {
  for (let i = start + 1; i < css.length; i++) {
    if (css[i] === '\\') i++;
    else if (css[i] === css[start] || css[i] === '\n') return i;
  }
  return css.length - 1;
}

function toDeclaration(statement: string, origin: TokenOrigin): Declaration | undefined {
  const colon = statement.indexOf(':');
  if (colon < 0) return undefined;
  const name = statement.slice(0, colon).trim();
  if (!name.startsWith('--')) return undefined;
  return {
    name: name.slice(2).replace(/\\/g, ''),
    value: statement
      .slice(colon + 1)
      .trim()
      .replace(/\s+/g, ' '),
    origin,
  };
}

/** Sub-namespaces Tailwind v4 keeps when their parent namespace is reset (its `lib.js` ignore map). */
const RESET_EXEMPT: Readonly<Record<string, readonly string[]>> = {
  'font-': ['font-weight-', 'font-size-'],
  'inset-': ['inset-shadow-', 'inset-ring-'],
  'text-': [
    'text-color-',
    'text-decoration-color-',
    'text-decoration-thickness-',
    'text-indent-',
    'text-shadow-',
    'text-underline-offset-',
  ],
  'grid-column-': ['grid-column-start-', 'grid-column-end-'],
  'grid-row-': ['grid-row-start-', 'grid-row-end-'],
};

/**
 * Applies declarations in order the way Tailwind v4 does: a later one replaces an earlier one of the same name,
 * `--name: initial` removes that variable, and `--ns-*: initial` (or `--*: initial`) removes everything declared
 * so far in that namespace, except the sub-namespaces Tailwind exempts.
 */
export function applyDeclarations(decls: readonly Declaration[]): Map<string, Declaration> {
  const map = new Map<string, Declaration>();
  for (const decl of decls) {
    if (decl.name.endsWith('*') && decl.value === 'initial') {
      resetNamespace(map, decl.name.slice(0, -1));
      continue;
    }
    map.delete(decl.name);
    if (decl.value !== 'initial') map.set(decl.name, decl);
  }
  return map;
}

function resetNamespace(map: Map<string, Declaration>, prefix: string): void {
  const exempt = RESET_EXEMPT[prefix] ?? [];
  const cleared = [...map.keys()].filter((key) => key.startsWith(prefix) && !exempt.some((e) => key.startsWith(e)));
  for (const key of cleared) map.delete(key);
}

const NAMESPACES: readonly (readonly [string, TokenKind])[] = [
  ['text-shadow-', 'other'],
  ['color-', 'color'],
  ['text-', 'text'],
  ['leading-', 'leading'],
  ['tracking-', 'tracking'],
  ['font-weight-', 'font-weight'],
  ['font-', 'font'],
  ['radius-', 'radius'],
  ['shadow-', 'shadow'],
  ['breakpoint-', 'breakpoint'],
];

export function classify(name: string): { kind: TokenKind; key: string } {
  if (name === 'spacing') return { kind: 'spacing', key: '' };
  for (const [prefix, kind] of NAMESPACES) {
    if (!name.startsWith(prefix)) continue;
    const key = name.slice(prefix.length);
    if (kind === 'text' && key.endsWith('--line-height')) return { kind: 'text-line-height', key: key.slice(0, -'--line-height'.length) };
    if (kind === 'other' || key.includes('--')) return { kind: 'other', key: name };
    return { kind, key };
  }
  return { kind: 'other', key: name };
}

/** Builds tokens from the applied declarations, following `var()` references. */
export function buildTokens(map: ReadonlyMap<string, Declaration>, options: ThemeOptions): Token[] {
  const tokens: Token[] = [];
  for (const decl of map.values()) {
    const { kind, key } = classify(decl.name);
    const via: string[] = [];
    let value = resolveReferences(decl.value, map, [decl.name], via);
    if (kind === 'font' && value.startsWith('var(')) value = options.fontFamilies[key] ?? value;
    const px = toPx(value, options.rootPx);
    tokens.push({ name: decl.name, kind, key, raw: decl.value, value, via, ...(px === undefined ? {} : { px }), origin: decl.origin });
  }
  return tokens;
}

function resolveReferences(value: string, map: ReadonlyMap<string, Declaration>, seen: readonly string[], via: string[]): string {
  return value.replace(/var\(\s*--([\w-]+)\s*(?:,\s*([^()]*))?\)/g, (whole, name: string, fallback: string | undefined) => {
    if (seen.includes(name)) return whole;
    const target = map.get(name);
    if (!target) return fallback?.trim() ?? whole;
    via.push(name);
    return resolveReferences(target.value, map, [...seen, name], via);
  });
}

/** Pixels for `12px`, `0.75rem` or `0`; undefined for anything else. */
export function toPx(value: string, rootPx: number): number | undefined {
  const unit = /^(-?\d*\.?\d+)(px|rem)?$/.exec(value.trim());
  if (!unit) return undefined;
  const n = Number(unit[1]);
  if (unit[2] === 'rem') return round(n * rootPx);
  if (unit[2] === 'px' || n === 0) return n;
  return undefined;
}

/** The factor of an `em` length such as `-0.025em`; undefined for anything else. */
export function toEm(value: string): number | undefined {
  const em = /^(-?\d*\.?\d+)em$/.exec(value.trim());
  return em ? Number(em[1]) : undefined;
}

/** A unitless number, or `calc(a / b)` of numbers, as Tailwind writes line-height ratios. */
export function toRatio(value: string): number | undefined {
  const v = value.trim();
  if (/^\d*\.?\d+$/.test(v)) return Number(v);
  const calc = /^calc\(\s*(\d*\.?\d+)\s*\/\s*(\d*\.?\d+)\s*\)$/.exec(v);
  if (calc) return Number(calc[1]) / Number(calc[2]);
  return undefined;
}

export function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
