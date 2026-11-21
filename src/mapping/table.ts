import type { Catalogue } from '../catalogue/types.ts';
import type { ComponentRow } from './components.ts';
import {
  ColorMatcher,
  describeShadows,
  matchRadius,
  matchSpacing,
  ShadowMatcher,
  TextMatcher,
  type Match,
  type MatchStatus,
} from './match.ts';
import type { DesignUsage, StyleUse, TextValue, Used } from './usage.ts';

export type RowGroup = 'colour' | 'text' | 'shadow' | 'gap' | 'padding' | 'radius';

export interface TableRow {
  readonly group: RowGroup;
  /** The library style name, or empty for a value no style names. */
  readonly design: string;
  readonly value: string;
  readonly uses: number;
  readonly examples: readonly string[];
  readonly match: Match;
}

export interface MappingTable {
  readonly rows: readonly TableRow[];
  readonly components: readonly ComponentRow[];
}

/** Every design value in the read frames next to what the code has for it. */
export function buildTable(usage: DesignUsage, catalogue: Catalogue, components: readonly ComponentRow[]): MappingTable {
  const colors = new ColorMatcher(catalogue.tokens);
  const text = new TextMatcher(catalogue.typography, catalogue.tokens);
  const shadows = new ShadowMatcher(catalogue.tokens);
  const unit = catalogue.tokens.find((t) => t.kind === 'spacing')?.px;
  const rows: TableRow[] = [
    ...styleRows(
      'colour',
      usage.colorStyles,
      (hex, name) => colors.match(hex, name),
      (hex) => hex,
    ),
    ...rawRows(
      'colour',
      usage.rawColors,
      (hex) => colors.match(hex),
      (hex) => hex,
    ),
    ...styleRows('text', usage.textStyles, (v, name) => text.match(v, name), describeText),
    ...rawRows('text', usage.rawText, (v) => text.match(v), describeText),
    ...styleRows('shadow', usage.effectStyles, (s, name) => shadows.match(s, name), describeShadows),
    ...rawRows(
      'gap',
      usage.gaps,
      (px) => matchSpacing(px, unit, 'gap'),
      (px) => `${px}px`,
    ),
    ...rawRows(
      'padding',
      usage.paddings,
      (px) => matchSpacing(px, unit, 'p'),
      (px) => `${px}px`,
    ),
    ...rawRows(
      'radius',
      usage.radii,
      (px) => matchRadius(px, catalogue.tokens),
      (px) => `${px}px`,
    ),
  ];
  return { rows, components };
}

function styleRows<T>(
  group: RowGroup,
  styles: readonly StyleUse<T>[],
  match: (v: T, name: string) => Match,
  show: (v: T) => string,
): TableRow[] {
  return styles.flatMap((s) => {
    const mixed = s.values.length > 1;
    return s.values.map((u) => {
      const m = match(u.value, s.name);
      const note = mixed ? [m.note, `style used with ${s.values.length} different values`].filter(Boolean).join('; ') : m.note;
      return {
        group,
        design: s.name,
        value: show(u.value),
        uses: u.count,
        examples: u.examples,
        match: { ...m, ...(note ? { note } : {}) },
      };
    });
  });
}

function rawRows<T>(group: RowGroup, used: readonly Used<T>[], match: (v: T) => Match, show: (v: T) => string): TableRow[] {
  return used.map((u) => ({ group, design: '', value: show(u.value), uses: u.count, examples: u.examples, match: match(u.value) }));
}

export function describeText(v: TextValue): string {
  const tracking = v.letterSpacingPx ? ` tracking ${v.letterSpacingPx}px` : '';
  return `${v.family} ${v.sizePx}/${v.lineHeightPx} ${v.weight}${tracking}`;
}

/** Rows per status, for a one-line summary. */
export function countByStatus(rows: readonly TableRow[]): Partial<Record<MatchStatus, number>> {
  const counts: Partial<Record<MatchStatus, number>> = {};
  for (const r of rows) counts[r.match.status] = (counts[r.match.status] ?? 0) + 1;
  return counts;
}
