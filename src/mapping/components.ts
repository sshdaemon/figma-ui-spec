import type { ComponentUsage } from './usage.ts';

/** An exported component in the project, as `file#Export`. */
export interface CodeComponent {
  readonly name: string;
  /** Repo-relative path. */
  readonly file: string;
}

/** A decided mapping from a Figma component to code, saved per project. */
export interface MapEntry {
  /** Library key of the Figma component or component set, or `name:<name>` for a file-local one (see `mapKeyOf`). */
  readonly key: string;
  /** The Figma name when it was decided, for reading the file. */
  readonly name: string;
  /** `file#Export`, or `lucide-react#Icon` for icons. */
  readonly code: string;
  readonly decided: string;
  /** Figma property values to code props, for example `{ "Emphasis=Primary": "variant=\"primary\"" }`; filled in when a spec needs them. */
  readonly props?: Readonly<Record<string, string>>;
}

/**
 * The key a mapping is saved under. Library components keep their key across files; a file-local component gets a new
 * key in every file it is copied to, so it is matched by name instead.
 */
export function mapKeyOf(u: Pick<ComponentUsage, 'key' | 'name' | 'remote'>): string {
  return u.remote ? u.key : `name:${u.name}`;
}

export type ComponentKind = 'mapped' | 'icon' | 'unmapped';

export interface ComponentRow {
  readonly name: string;
  /** The key to pass to `map --key`: the library key, or `name:<name>` for a file-local component. */
  readonly key: string;
  readonly remote: boolean;
  readonly count: number;
  readonly examples: readonly string[];
  readonly variants: Readonly<Record<string, readonly string[]>>;
  readonly kind: ComponentKind;
  /** The mapped code component; set only when `kind` is `mapped`. */
  readonly code?: string;
  /** Likely code components to map it to, best first. */
  readonly suggestions: readonly string[];
}

export interface IconSources {
  /** Icon names lucide ships, in kebab case (`chevron-down`). */
  readonly lucide: ReadonlySet<string>;
  /** The project's own icon components. */
  readonly local: readonly CodeComponent[];
}

/** Small instances with a lower-case name (`chevron-down`) are icons; `Checkbox` at 20px is not. */
const ICON_MAX_PX = 32;
const MIN_SIMILARITY = 0.45;
const SUGGESTIONS = 3;

export function matchComponents(
  used: readonly ComponentUsage[],
  map: readonly MapEntry[],
  code: readonly CodeComponent[],
  icons: IconSources,
): ComponentRow[] {
  const byKey = new Map(map.map((m) => [m.key, m]));
  return used.map((u) => {
    const key = mapKeyOf(u);
    const base = { name: u.name, key, remote: u.remote, count: u.count, examples: u.examples, variants: u.variants };
    const mapped = byKey.get(key);
    if (mapped) return { ...base, kind: 'mapped', code: mapped.code, suggestions: [] };
    if (u.maxW <= ICON_MAX_PX && u.maxH <= ICON_MAX_PX && /^[a-z]/.test(u.name)) {
      return { ...base, kind: 'icon', suggestions: iconSuggestions(u.name, icons) };
    }
    return { ...base, kind: 'unmapped', suggestions: similar(u.name, code) };
  });
}

function iconSuggestions(name: string, icons: IconSources): string[] {
  const kebab = toKebab(name);
  const lucide = icons.lucide.has(kebab) ? [`lucide-react#${toPascal(kebab)}`] : [];
  return [...lucide, ...similar(name, icons.local)].slice(0, SUGGESTIONS);
}

function similar(name: string, candidates: readonly CodeComponent[]): string[] {
  const target = normalize(name);
  return candidates
    .map((c) => ({ c, score: dice(target, normalize(c.name)) }))
    .filter((x) => x.score >= MIN_SIMILARITY)
    .toSorted((a, b) => b.score - a.score || a.c.file.localeCompare(b.c.file))
    .slice(0, SUGGESTIONS)
    .map((x) => `${x.c.file}#${x.c.name}`);
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z\d]/g, '');
}

/** Dice coefficient over letter pairs: 1 for equal strings, robust to small typos and word order. */
export function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pa = pairs(a);
  const pb = pairs(b);
  let shared = 0;
  for (const [pair, n] of pa) shared += Math.min(n, pb.get(pair) ?? 0);
  return (2 * shared) / (a.length - 1 + (b.length - 1));
}

function pairs(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
  return m;
}

export function toKebab(name: string): string {
  return name
    .replace(/([a-z\d])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z\d]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** lucide's export name for an icon file name: `grid-2x2` → `Grid2x2`, `a-arrow-down` → `AArrowDown`. */
export function toPascal(kebab: string): string {
  return kebab
    .split('-')
    .map((w) => (w ? w[0]?.toUpperCase() + w.slice(1) : ''))
    .join('');
}
