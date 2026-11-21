import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { SkipRule } from '../design/outline.ts';

export interface TypographyComponentConfig {
  readonly component: string;
  /** Repo-relative file holding the cva definition. */
  readonly file: string;
  /** Name of the variable the `cva(...)` call is assigned to. */
  readonly cva: string;
}

export interface RepoConfig {
  /** Absolute path to the project checkout. */
  readonly root: string;
  readonly theme: {
    /** Repo-relative path of the framework's default theme, for example `node_modules/tailwindcss/theme.css`. */
    readonly base?: string;
    /** Repo-relative CSS files holding the project's `@theme` blocks, in load order. */
    readonly files: readonly string[];
    readonly rootPx: number;
    readonly fontFamilies: Readonly<Record<string, string>>;
  };
  readonly typography: readonly TypographyComponentConfig[];
  /** Repo-relative globs of shared code that feature work must not change. */
  readonly protectedPaths: readonly string[];
  /** Absolute globs of the specs whose decisions `guard` and `hook` apply when no `--spec` is given. */
  readonly specs: readonly string[];
  readonly design: {
    /** Extra rules for items next to the screens that are not designs, on top of the built-in ones. */
    readonly skip: readonly SkipRule[];
  };
  readonly components: {
    /** Repo-relative folders whose exported PascalCase components are candidates for Figma components. */
    readonly dirs: readonly string[];
    /** Repo-relative folders of the project's own icon components. */
    readonly iconDirs: readonly string[];
    /** Repo-relative folder of lucide's icon modules, when the project uses lucide. */
    readonly lucide?: string;
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** The tool's own checkout: `.env`, `.repos/` and `.cache/` live here. */
export const TOOL_ROOT = path.resolve(import.meta.dirname, '../..');

export function reposDir(): string {
  return process.env['FIGMA_UI_SPEC_REPOS'] ?? path.join(TOOL_ROOT, '.repos');
}

/** Loads `FIGMA_TOKEN` and friends from the checkout's `.env`; variables already set in the environment win. */
export function loadEnv(file = path.join(TOOL_ROOT, '.env')): void {
  if (existsSync(file)) process.loadEnvFile(file);
}

export function loadRepoConfig(name: string, rootOverride?: string): RepoConfig {
  if (!/^[\w.-]+$/.test(name)) throw new ConfigError(`invalid repo name: ${name}`);
  const file = path.join(reposDir(), name, 'config.json');
  if (!existsSync(file)) throw new ConfigError(`no config for ${name}: expected ${file} (see repos.example/)`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new ConfigError(`${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return parseRepoConfig(raw, file, rootOverride);
}

export function parseRepoConfig(raw: unknown, file: string, rootOverride?: string): RepoConfig {
  const obj = record(raw, file);
  const root = rootOverride ?? str(obj['root'], `${file}: root`);
  if (!path.isAbsolute(root)) throw new ConfigError(`${file}: root must be an absolute path`);
  const theme = record(obj['theme'], `${file}: theme`);
  const base = theme['base'] === undefined ? undefined : str(theme['base'], `${file}: theme.base`);
  const fontFamilies = record(theme['fontFamilies'] ?? {}, `${file}: theme.fontFamilies`);
  const typography = list(obj['typography'] ?? [], `${file}: typography`).map((t, i) => {
    const entry = record(t, `${file}: typography[${i}]`);
    return {
      component: str(entry['component'], `${file}: typography[${i}].component`),
      file: str(entry['file'], `${file}: typography[${i}].file`),
      cva: str(entry['cva'], `${file}: typography[${i}].cva`),
    };
  });
  const rootPx = theme['rootPx'] ?? 16;
  if (typeof rootPx !== 'number' || rootPx <= 0) throw new ConfigError(`${file}: theme.rootPx must be a positive number`);
  return {
    root,
    theme: {
      ...(base === undefined ? {} : { base }),
      files: list(theme['files'], `${file}: theme.files`).map((f, i) => str(f, `${file}: theme.files[${i}]`)),
      rootPx,
      fontFamilies: Object.fromEntries(Object.entries(fontFamilies).map(([k, v]) => [k, str(v, `${file}: theme.fontFamilies.${k}`)])),
    },
    typography,
    protectedPaths: list(obj['protectedPaths'] ?? [], `${file}: protectedPaths`).map((p, i) => str(p, `${file}: protectedPaths[${i}]`)),
    specs: list(obj['specs'] ?? [], `${file}: specs`).map((p, i) => {
      const glob = str(p, `${file}: specs[${i}]`);
      if (!path.isAbsolute(glob)) throw new ConfigError(`${file}: specs[${i}] must be an absolute path`);
      return glob;
    }),
    design: { skip: skipRules(obj['design'], file) },
    components: componentsConfig(obj['components'], file),
  };
}

function componentsConfig(raw: unknown, file: string): RepoConfig['components'] {
  if (raw === undefined) return { dirs: [], iconDirs: [] };
  const c = record(raw, `${file}: components`);
  const strings = (key: string): string[] =>
    list(c[key] ?? [], `${file}: components.${key}`).map((v, i) => str(v, `${file}: components.${key}[${i}]`));
  const lucide = c['lucide'] === undefined ? undefined : str(c['lucide'], `${file}: components.lucide`);
  return { dirs: strings('dirs'), iconDirs: strings('iconDirs'), ...(lucide === undefined ? {} : { lucide }) };
}

/** The project's learned Figma-to-code component mappings. */
export function componentMapFile(name: string): string {
  return path.join(reposDir(), name, 'component-map.json');
}

function skipRules(design: unknown, file: string): SkipRule[] {
  if (design === undefined) return [];
  const rules = list(record(design, `${file}: design`)['skip'] ?? [], `${file}: design.skip`);
  return rules.map((r, i) => {
    const where = `${file}: design.skip[${i}]`;
    const rule = record(r, where);
    const name = rule['name'] === undefined ? undefined : str(rule['name'], `${where}.name`);
    if (name !== undefined && !isValidPattern(name)) throw new ConfigError(`${where}.name is not a valid regular expression`);
    const type = rule['type'] === undefined ? undefined : str(rule['type'], `${where}.type`).toUpperCase();
    if (name === undefined && type === undefined) throw new ConfigError(`${where} needs a name or a type`);
    return {
      reason: str(rule['reason'], `${where}.reason`),
      ...(name === undefined ? {} : { name }),
      ...(type === undefined ? {} : { type }),
    };
  });
}

function record(v: unknown, where: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new ConfigError(`${where} must be an object`);
  return v as Record<string, unknown>;
}

function list(v: unknown, where: string): unknown[] {
  if (!Array.isArray(v)) throw new ConfigError(`${where} must be an array`);
  return v;
}

function str(v: unknown, where: string): string {
  if (typeof v !== 'string' || v === '') throw new ConfigError(`${where} must be a non-empty string`);
  return v;
}

function isValidPattern(source: string): boolean {
  try {
    RegExp(source);
    return true;
  } catch {
    return false;
  }
}

/** The running list of design-system gaps across tickets, for the designer. */
export function gapsFile(name: string): string {
  return path.join(reposDir(), name, 'design-system-gaps.md');
}

/** Adds the gaps not already in the file, under a heading naming the design they came from. */
export function appendGaps(file: string, gaps: readonly string[], source: string): number {
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '# Design-system gaps\n';
  const fresh = gaps.filter((g) => !existing.includes(`- ${g}\n`));
  if (fresh.length === 0) return 0;
  const body = `${existsSync(file) ? '' : existing}\n## ${source} (${new Date().toISOString().slice(0, 10)})\n\n${fresh.map((g) => `- ${g}`).join('\n')}\n`;
  appendFileSync(file, body);
  return fresh.length;
}
