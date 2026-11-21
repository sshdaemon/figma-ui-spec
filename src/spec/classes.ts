import type { Token } from '../catalogue/types.ts';
import type { DesignNode, Layout } from '../design/types.ts';
import { describeShadows, matchRadius, matchSpacing, type ColorMatcher, type ShadowMatcher, type TextMatcher } from '../mapping/match.ts';
import type { ConflictInput, ConflictRegistry } from './conflicts.ts';

export interface ClassContext {
  readonly colors: ColorMatcher;
  readonly text: TextMatcher;
  readonly shadows: ShadowMatcher;
  readonly tokens: readonly Token[];
  readonly unitPx?: number;
  readonly conflicts: ConflictRegistry;
}

/** Collects the conflict ids a node runs into while its classes are worked out. */
export class NodeConflicts {
  readonly ids: string[] = [];
  private readonly ctx: ClassContext;
  private readonly nodeId: string;

  constructor(ctx: ClassContext, nodeId: string) {
    this.ctx = ctx;
    this.nodeId = nodeId;
  }

  /** Registers the conflict and returns what to write: the override once someone chose `local-override`, else the nearest option. */
  resolve(input: ConflictInput): string {
    const id = this.ctx.conflicts.add(input, this.nodeId);
    if (!this.ids.includes(id)) this.ids.push(id);
    const chosen = this.ctx.conflicts.list().find((c) => c.id === id);
    return chosen?.outcome === 'local-override' && input.override ? input.override : input.nearest;
  }
}

export type ColorRole = 'fill' | 'stroke' | 'text';

const PREFIX: Readonly<Record<ColorRole, string>> = { fill: 'bg', stroke: 'border', text: 'text' };
/** Semantic aliases a role prefers by name, before any other alias that fits it. */
const PREFERRED: Readonly<Record<ColorRole, readonly string[]>> = {
  fill: ['bg', 'background'],
  stroke: ['border'],
  text: ['fg', 'foreground'],
};

/** A colour as a class for its role: the role's own semantic name when it has this value, else the palette name. */
export function colorClass(ctx: ClassContext, hex: string, role: ColorRole, styleName: string | undefined, nc: NodeConflicts): string {
  if (/^#[\da-f]{6}00$/i.test(hex)) return `${PREFIX[role]}-transparent`;
  const candidates = ctx.colors.candidates(hex);
  if (candidates.length > 0) return `${PREFIX[role]}-${pickForRole(candidates, role)}`;
  const m = ctx.colors.match(hex, styleName);
  const nearest = `${PREFIX[role]}-${m.code}`;
  return nc.resolve({
    kind: 'colour',
    key: `colour:${hex}`,
    design: [styleName, hex].filter(Boolean).join(' '),
    nearest,
    override: `${PREFIX[role]}-[${hex}]`,
    ...(m.note ? { note: m.note } : {}),
  });
}

export function pickForRole(candidates: readonly { key: string; token: Token }[], role: ColorRole): string {
  const aliases = candidates.filter((c) => c.token.via.length > 0);
  const preferred = PREFERRED[role].map((name) => aliases.find((a) => base(a.key) === name)).find(Boolean);
  if (preferred) return preferred.key;
  // Other aliases belong to other contexts (chart-3, destructive-fg); the palette name is the honest choice.
  const palette = candidates
    .filter((c) => c.token.via.length === 0)
    .toSorted((a, b) => Number(a.token.origin === 'base') - Number(b.token.origin === 'base'));
  return (palette[0] ?? candidates[0])?.key ?? '';
}

/** A colour key without its opacity suffix: `fg/50` → `fg`. */
function base(key: string): string {
  return key.split('/')[0] ?? key;
}

/** `gap-4`, or for a size off the scale the nearest step (with the exact size as the override). */
export function spacingClass(ctx: ClassContext, px: number, prefix: string, nc: NodeConflicts): string {
  const m = matchSpacing(px, ctx.unitPx, prefix);
  if (m.status === 'same') return m.code;
  const step = ctx.unitPx ? Math.round((px / ctx.unitPx) * 2) / 2 : undefined;
  const nearest = step === undefined ? m.code : `${prefix}-${step}`;
  return nc.resolve({
    kind: 'spacing',
    key: `spacing:${px}`,
    design: `${px}px`,
    nearest,
    override: `${prefix}-[${px}px]`,
    ...(m.note ? { note: m.note } : {}),
  });
}

export function layoutClasses(ctx: ClassContext, layout: Layout, nc: NodeConflicts): string[] {
  if (layout.direction === 'grid') return gridClasses(ctx, layout, nc);
  const out = ['flex'];
  if (layout.direction === 'column') out.push('flex-col');
  if (layout.wrap) out.push('flex-wrap');
  if (layout.gap > 0 && layout.mainAlign !== 'space_between') out.push(spacingClass(ctx, layout.gap, 'gap', nc));
  out.push(...paddingClasses(ctx, layout.padding, nc));
  const justify: Readonly<Record<string, string>> = { center: 'justify-center', max: 'justify-end', space_between: 'justify-between' };
  const items: Readonly<Record<string, string>> = { center: 'items-center', max: 'items-end', baseline: 'items-baseline' };
  if (layout.mainAlign && justify[layout.mainAlign]) out.push(justify[layout.mainAlign] as string);
  // Figma's default cross alignment is the start; CSS's is stretch, which would widen hug-sized children.
  out.push(items[layout.crossAlign ?? 'min'] ?? 'items-start');
  return out;
}

/** A grid with its column count and gaps; cells flow in it, spanning where the design says. */
function gridClasses(ctx: ClassContext, layout: Layout, nc: NodeConflicts): string[] {
  const out = ['grid'];
  if ((layout.columns ?? 1) > 1) out.push(`grid-cols-${layout.columns}`);
  const rowGap = layout.rowGap ?? layout.gap;
  if (layout.gap > 0 && layout.gap === rowGap) out.push(spacingClass(ctx, layout.gap, 'gap', nc));
  else {
    if (layout.gap > 0 && (layout.columns ?? 1) > 1) out.push(spacingClass(ctx, layout.gap, 'gap-x', nc));
    if (rowGap > 0 && (layout.rows ?? 1) > 1) out.push(spacingClass(ctx, rowGap, 'gap-y', nc));
  }
  out.push(...paddingClasses(ctx, layout.padding, nc));
  return out;
}

function paddingClasses(ctx: ClassContext, [t, r, b, l]: readonly [number, number, number, number], nc: NodeConflicts): string[] {
  const one = (prefix: string, px: number): string[] => (px > 0 ? [spacingClass(ctx, px, prefix, nc)] : []);
  if (t === r && r === b && b === l) return one('p', t);
  if (t === b && l === r) return [...one('px', l), ...one('py', t)];
  return [...one('pt', t), ...one('pr', r), ...one('pb', b), ...one('pl', l)];
}

/** Width and height from auto-layout sizing: fill grows along the parent's axis, fixed gets its size, hug needs nothing. */
export function sizingClasses(ctx: ClassContext, n: DesignNode, parent: Layout | undefined): string[] {
  if (!n.sizing) return [];
  const out: string[] = [];
  const along = (axis: 'w' | 'h'): boolean => (axis === 'w' ? parent?.direction === 'row' : parent?.direction === 'column');
  // Text takes its height from its lines; only its width carries design intent.
  for (const axis of n.text ? (['w'] as const) : (['w', 'h'] as const)) {
    const mode = n.sizing[axis];
    if (mode === 'fill') out.push(along(axis) ? 'flex-1' : `${axis}-full`);
    if (mode === 'fixed') out.push(sizeClass(ctx, axis, n.box[axis]));
  }
  return [...new Set(out)];
}

/** A size on the spacing scale as a step (`w-120` in Tailwind v4), else written out. */
export function sizeClass(ctx: ClassContext, axis: 'w' | 'h', px: number): string {
  const step = ctx.unitPx ? px / ctx.unitPx : undefined;
  return step !== undefined && Number.isInteger(step * 2) ? `${axis}-${step}` : `${axis}-[${px}px]`;
}

/** Background, border, radius, shadow and opacity of a box. */
export function surfaceClasses(ctx: ClassContext, n: DesignNode, nc: NodeConflicts): string[] {
  const out: string[] = [];
  const fill = n.fills?.find((p) => p.kind === 'solid' && p.hex);
  if (fill?.hex) out.push(colorClass(ctx, fill.hex, 'fill', n.styles?.fill, nc));
  const stroke = n.strokes?.find((p) => p.kind === 'solid' && p.hex);
  if (stroke?.hex) out.push(...borderWidths(n), colorClass(ctx, stroke.hex, 'stroke', n.styles?.stroke, nc));
  out.push(...radiusClasses(ctx, n.radius, Math.min(n.box.w, n.box.h) / 2, nc));
  if (n.shadows && n.shadows.length > 0) out.push(shadowClass(ctx, n, nc));
  if (n.opacity !== undefined) out.push(`opacity-${Math.round(n.opacity * 100)}`);
  return out.filter(Boolean);
}

/** `border`, or per side (`border-l`, `border-y-2`) when the design strokes only some sides. */
export function borderWidths(n: DesignNode): string[] {
  if (!n.strokeSides) return [width('border', n.strokeWeight ?? 1)];
  const [t, r, b, l] = n.strokeSides;
  const out: string[] = [];
  const pair = (both: string, first: [string, number], second: [string, number]): void => {
    if (first[1] > 0 && first[1] === second[1]) out.push(width(`border-${both}`, first[1]));
    else for (const [side, px] of [first, second]) if (px > 0) out.push(width(`border-${side}`, px));
  };
  pair('y', ['t', t], ['b', b]);
  pair('x', ['l', l], ['r', r]);
  return out;
}

function width(prefix: string, px: number): string {
  if (px === 1) return prefix;
  return Number.isInteger(px) ? `${prefix}-${px}` : `${prefix}-[${px}px]`;
}

/** One radius, or per side or corner (`rounded-b-2xl`, `rounded-tl-md`) when the corners differ; zero corners need nothing. */
function radiusClasses(ctx: ClassContext, radius: DesignNode['radius'], pillPx: number, nc: NodeConflicts): string[] {
  if (radius === undefined) return [];
  if (typeof radius === 'number') return [radiusClass(ctx, radius, '', pillPx, nc)];
  return cornerGroups(radius)
    .filter(([, px]) => px > 0)
    .map(([corner, px]) => radiusClass(ctx, px, `-${corner}`, pillPx, nc));
}

/** Corners grouped by the side they share a radius on, as Tailwind's side utilities do. */
function cornerGroups([tl, tr, br, bl]: readonly [number, number, number, number]): [string, number][] {
  if (tl === tr && br === bl) {
    return [
      ['t', tl],
      ['b', br],
    ];
  }
  if (tl === bl && tr === br) {
    return [
      ['l', tl],
      ['r', tr],
    ];
  }
  return [
    ['tl', tl],
    ['tr', tr],
    ['br', br],
    ['bl', bl],
  ];
}

/** A radius of half the box's shorter side or more draws a pill, which is `rounded-full` whatever the number. */
function radiusClass(ctx: ClassContext, px: number, corner: string, pillPx: number, nc: NodeConflicts): string {
  const named = (code: string): string => code.replace(/^rounded/, `rounded${corner}`);
  if (pillPx > 0 && px >= pillPx) return named('rounded-full');
  const m = matchRadius(px, ctx.tokens);
  if (m.status === 'same') return named(m.code);
  return nc.resolve({
    kind: 'radius',
    key: `radius:${px}`,
    design: `radius ${px}px`,
    nearest: named(m.code),
    override: `rounded${corner}-[${px}px]`,
    ...(m.note ? { note: m.note } : {}),
  });
}

/** A shadow token; else the same-named token (nearest) against the exact shadow (override), or the exact shadow alone. */
function shadowClass(ctx: ClassContext, n: DesignNode, nc: NodeConflicts): string {
  const shadows = n.shadows ?? [];
  const m = ctx.shadows.match(shadows, n.styles?.effect ?? '');
  if (m.status === 'same' || m.status === 'renamed') return m.code;
  if (m.sameValue) return m.sameValue;
  const css = shadows.map((s) => `${s.kind === 'inner' ? 'inset_' : ''}${s.x}px_${s.y}px_${s.blur}px_${s.spread}px_${s.hex}`).join(',');
  const exact = `shadow-[${css}]`;
  return nc.resolve({
    kind: 'shadow',
    key: `shadow:${describeShadows(shadows)}`,
    design: [n.styles?.effect, describeShadows(shadows)].filter(Boolean).join(' '),
    nearest: m.code || exact,
    ...(m.code ? { override: exact } : {}),
    ...(m.note ? { note: m.note } : {}),
  });
}
