import { globSync } from 'node:fs';
import path from 'node:path';
import { readSpec, SpecFileError } from '../adapters/fs/spec-files.ts';
import { guard, isGuarded, type Decision, type TypographyFile, type FileChange, type Finding, type GuardResult } from '../guard/check.ts';
import { cvaVariantsSpan, parseCva } from '../adapters/ts/cva-reader.ts';
import { buildCatalogue } from './catalogue-command.ts';
import type { RepoConfig } from './config.ts';

export interface GuardRun extends GuardResult {
  /** Specs that could not be read, with why; their decisions do not apply. */
  readonly unreadable: readonly string[];
}

/**
 * Runs the guard for a project: its protected paths, theme files and typography components, and the decisions in the
 * specs written for it. When no change touches a guarded file, nothing else is read, so a broken theme or spec only
 * matters to edits of shared code.
 */
export function guardChanges(repo: string, config: RepoConfig, changes: readonly FileChange[], specFiles: readonly string[]): GuardRun {
  const guarded = changes.filter((c) => isGuarded(c.file, config.protectedPaths, config.theme.files));
  if (guarded.length === 0) return { findings: [], covered: [], unreadable: [] };
  const catalogue = buildCatalogue(config);
  const unreadable: string[] = [];
  const decisions = specFiles.flatMap((file) => decisionsIn(file, repo, unreadable));
  const result = guard({
    changes: guarded,
    protectedPaths: config.protectedPaths,
    themeFiles: config.theme.files,
    typography: config.typography,
    variants: catalogue.typography,
    tokens: catalogue.tokens,
    decisions,
    definitions: (file, contents) => typographyFile(config, file, contents),
  });
  return { ...result, unreadable };
}

function typographyFile(config: RepoConfig, file: string, contents: string): TypographyFile {
  const components = config.typography.filter((t) => t.file === file);
  const spans = components
    .map((t) => cvaVariantsSpan(contents, file, t.cva))
    .filter((span) => span !== undefined)
    .toSorted((a, b) => b.start - a.start);
  const rest = spans.reduce((text, span) => `${text.slice(0, span.start)}{…}${text.slice(span.end)}`, contents);
  return { definitions: new Map(components.map((t) => [t.component, parseCva(contents, file, t.cva)])), rest };
}

/** `--spec` when given, else every spec the config's `specs` globs find. */
export function specFilesFor(config: RepoConfig, given: string | undefined): string[] {
  if (given) return given.split(',').map((f) => path.resolve(f.trim()));
  return config.specs.flatMap((glob) => globSync(glob)).toSorted();
}

/** The conflicts of a spec written for this project; a spec that cannot be read only loses its decisions, which keeps the guard strict. */
function decisionsIn(file: string, repo: string, unreadable: string[]): Decision[] {
  let spec;
  try {
    spec = readSpec(file);
  } catch (err) {
    if (!(err instanceof SpecFileError)) throw err;
    unreadable.push(err.message);
    return [];
  }
  if (spec?.repo !== repo) return [];
  const name = path.basename(file, '.json');
  return spec.conflicts.map((conflict) => ({ spec: name, conflict }));
}

export function renderGuard(result: GuardRun, specs: readonly string[]): string {
  const lines: string[] = [];
  if (result.findings.length > 0) {
    lines.push(
      `${result.findings.length} change(s) to shared code that no decision allows:`,
      ...result.findings.map((f) => `- ${describe(f)}`),
    );
  } else {
    lines.push('No unapproved changes to shared code.');
  }
  if (result.covered.length > 0) {
    lines.push('', 'Allowed by a decision:', ...result.covered.map((f) => `- ${describe(f)}: ${f.coveredBy.join('; ')}`));
  }
  if (result.unreadable.length > 0) lines.push('', 'Specs skipped:', ...result.unreadable.map((u) => `- ${u}`));
  lines.push('', specs.length > 0 ? `Decisions read from ${specs.join(', ')}` : 'No spec read, so no decisions apply.');
  return `${lines.join('\n')}\n`;
}

export function describe(f: Finding): string {
  if (f.kind === 'file') return `${f.file} changes`;
  const value = { added: `added as ${f.after}`, removed: `removed (was ${f.before})`, changed: `${f.before} → ${f.after}` }[
    f.change ?? 'changed'
  ];
  return `${f.file}: --${f.token} ${value}`;
}
