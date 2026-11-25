import type { DesignNode, Layout } from '../design/types.ts';
import { mapKeyOf, toPascal, type ComponentRow, type MapEntry } from '../mapping/components.ts';
import type { TextValue } from '../mapping/usage.ts';
import { describeText } from '../mapping/table.ts';
import { colorClass, layoutClasses, NodeConflicts, sizeClass, sizingClasses, surfaceClasses, type ClassContext } from './classes.ts';
import type { ComponentDefinition, NodeKind, SpecNode } from './types.ts';

export interface TreeContext extends ClassContext {
  /** Component rows by the key `map` uses. */
  readonly components: ReadonlyMap<string, ComponentRow>;
  readonly map: ReadonlyMap<string, MapEntry>;
  /** Inner trees of unmapped components, written once per key and filled as instances are met. */
  readonly definitions: Map<string, ComponentDefinition>;
}

const SHAPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'LINE', 'ELLIPSE', 'REGULAR_POLYGON', 'POLYGON']);

/** A frame as a tree of what to build: code components, typography, and markup with classes. */
export function buildTree(ctx: TreeContext, n: DesignNode, parent?: Layout): SpecNode {
  const nc = new NodeConflicts(ctx, n.id);
  const node = buildNode(ctx, n, parent, nc);
  return nc.ids.length > 0 ? { ...node, conflicts: [...(node.conflicts ?? []), ...nc.ids] } : node;
}

function buildNode(ctx: TreeContext, n: DesignNode, parent: Layout | undefined, nc: NodeConflicts): SpecNode {
  if (n.component) return componentNode(ctx, n, parent);
  if (n.text) return textNode(ctx, n, parent, nc);
  if (SHAPES.has(n.type)) return shapeNode(ctx, n, parent, nc);
  if (n.fills?.some((p) => p.kind === 'image')) return leaf(n, 'image', sizingClasses(ctx, n, parent));
  return boxNode(ctx, n, parent, nc);
}

/** A line is a divider border, an ellipse a round box, any other shape an svg coloured through `currentColor`. */
function shapeNode(ctx: TreeContext, n: DesignNode, parent: Layout | undefined, nc: NodeConflicts): SpecNode {
  const sizing = sizingClasses(ctx, n, parent);
  const stroke = n.strokes?.find((p) => p.kind === 'solid' && p.hex)?.hex;
  const fill = n.fills?.find((p) => p.kind === 'solid' && p.hex)?.hex;
  if (n.type === 'LINE') {
    const edge = n.box.h === 0 ? 'border-t' : 'border-l';
    const weight = n.strokeWeight && n.strokeWeight !== 1 ? `${edge}-${n.strokeWeight}` : edge;
    return leaf(n, 'box', [...sizing, weight, ...(stroke ? [colorClass(ctx, stroke, 'stroke', n.styles?.stroke, nc)] : [])]);
  }
  if (n.type === 'ELLIPSE') return leaf(n, 'box', [...sizing, ...surfaceClasses(ctx, n, nc), 'rounded-full']);
  if (fill) return leaf(n, 'vector', [...sizing, colorClass(ctx, fill, 'text', n.styles?.fill, nc)]);
  // A stroke-only path (a tick, an outlined icon) draws with currentColor at its stroke width.
  if (stroke) {
    return leaf(n, 'vector', [...sizing, colorClass(ctx, stroke, 'text', n.styles?.stroke, nc), strokeWidth(n.strokeWeight ?? 1)]);
  }
  return leaf(n, 'vector', sizing);
}

function strokeWidth(px: number): string {
  return Number.isInteger(px) ? `stroke-${px}` : `stroke-[${px}px]`;
}

function leaf(n: DesignNode, kind: NodeKind, classes: string[]): SpecNode {
  return { id: n.id, name: n.name, kind, classes };
}

/** Icon plugins name their frames `lucide/<icon>`; such a frame is that icon, not markup. */
const LUCIDE_FRAME = /^lucide\/([a-z\d-]+)$/;

function boxNode(ctx: TreeContext, n: DesignNode, parent: Layout | undefined, nc: NodeConflicts): SpecNode {
  const lucide = LUCIDE_FRAME.exec(n.name)?.[1];
  if (lucide) {
    return { id: n.id, name: lucide, kind: 'icon', code: `lucide-react#${toPascal(lucide)}`, classes: sizingClasses(ctx, n, parent) };
  }
  const kids = n.children ?? [];
  // Without auto layout, children sit where they were drawn: only vectors make one asset; mixed layers are placed.
  const free = !n.layout && kids.length > 1;
  if (free && kids.every(onlyVectors)) return leaf(n, 'vector', [...sizingClasses(ctx, n, parent), 'asset']);
  const placed = (c: DesignNode): boolean => c.absolute === true || free;
  const anyAbsolute = kids.some(placed);
  const classes = [
    ...(anyAbsolute ? ['relative'] : []),
    ...(free ? boxSize(ctx, n) : []),
    ...(n.layout ? layoutClasses(ctx, n.layout, nc) : []),
    ...sizingClasses(ctx, n, parent),
    ...surfaceClasses(ctx, n, nc),
  ];
  const children = kids.map((c) => {
    const child = buildTree(ctx, c, placed(c) ? undefined : n.layout);
    const span = c.span ? spanClasses(c.span) : [];
    if (!placed(c)) return span.length > 0 ? { ...child, classes: [...span, ...child.classes] } : child;
    // An absolute box already contains its own absolute children, so it needs no `relative`.
    const own = child.classes.filter((cls) => cls !== 'relative');
    const at = offsets(ctx, c, n);
    return { ...child, classes: ['absolute', ...at, ...(at[0] === 'inset-0' ? [] : boxSize(ctx, c)), ...own] };
  });
  // A wrapper that adds nothing is left out, so the tree reads like the markup to write.
  if (classes.length === 0 && children.length === 1 && children[0]) return children[0];
  return { id: n.id, name: n.name, kind: 'box', classes, ...(children.length > 0 ? { children } : {}) };
}

/** Where an absolute child sits in its parent: `inset-0` when it covers it, else the nearer edge on each axis. */
/** A layer made only of vector shapes (an illustration or logo), which is exported as one svg rather than rebuilt. */
function onlyVectors(n: DesignNode): boolean {
  if (SHAPES.has(n.type)) return true;
  if (n.text || n.component) return false;
  const kids = n.children ?? [];
  return kids.length > 0 && kids.every(onlyVectors);
}

/** Without auto-layout sizing, a placed box keeps the size it was drawn at; otherwise it would collapse. */
function boxSize(ctx: TreeContext, n: DesignNode): string[] {
  if (n.sizing || n.text) return [];
  return [sizeClass(ctx, 'w', n.box.w), sizeClass(ctx, 'h', n.box.h)];
}

function spanClasses(span: NonNullable<DesignNode['span']>): string[] {
  return [...(span.columns > 1 ? [`col-span-${span.columns}`] : []), ...(span.rows > 1 ? [`row-span-${span.rows}`] : [])];
}

/** Offsets under half a pixel are rounding left over from Figma's float positions. */
function roundOffset(px: number): number {
  return Math.abs(px) < 0.5 ? 0 : Math.round(px * 100) / 100;
}

function offsets(ctx: TreeContext, child: DesignNode, parent: DesignNode): string[] {
  const left = roundOffset(child.box.x - parent.box.x);
  const top = roundOffset(child.box.y - parent.box.y);
  const right = roundOffset(parent.box.w - (left + child.box.w));
  const bottom = roundOffset(parent.box.h - (top + child.box.h));
  if (left === 0 && top === 0 && right === 0 && bottom === 0) return ['inset-0'];
  const edge = (near: string, nearPx: number, far: string, farPx: number): string =>
    Math.abs(nearPx) <= Math.abs(farPx) ? offsetClass(ctx, near, nearPx) : offsetClass(ctx, far, farPx);
  return [edge('top', top, 'bottom', bottom), edge('left', left, 'right', right)];
}

/** `top-4`, `-right-0.5` for a child sticking out, or the exact value when it is off the scale. */
function offsetClass(ctx: TreeContext, side: string, px: number): string {
  if (px === 0) return `${side}-0`;
  const step = ctx.unitPx ? Math.abs(px) / ctx.unitPx : undefined;
  if (step !== undefined && Number.isInteger(step * 2)) return `${px < 0 ? '-' : ''}${side}-${step}`;
  return `${side}-[${px}px]`;
}

function textNode(ctx: TreeContext, n: DesignNode, parent: Layout | undefined, nc: NodeConflicts): SpecNode {
  const t = n.text;
  const base = { id: n.id, name: n.name, kind: 'text' as const, ...(t ? { text: t.characters } : {}) };
  const fill = n.fills?.find((p) => p.kind === 'solid' && p.hex)?.hex;
  const color = fill ? [colorClass(ctx, fill, 'text', n.styles?.fill, nc)] : [];
  const v = textValue(n);
  const sizing = sizingClasses(ctx, n, parent);
  if (!v) return { ...base, classes: [...sizing, ...color] };
  const typo = typography(ctx, v, n.styles?.text, nc);
  return { ...base, ...(typo.code ? { code: typo.code } : {}), classes: [...sizing, ...typo.classes, ...color, ...textShape(t)] };
}

/**
 * An exact component variant; else, when a variant has the same family and size, a conflict between it (nearest) and
 * classes (override); else classes from tokens, which need no decision.
 */
function typography(ctx: TreeContext, v: TextValue, style: string | undefined, nc: NodeConflicts): { code?: string; classes: string[] } {
  const m = ctx.text.match(v, style);
  if (m.status === 'same' || m.status === 'renamed') return { code: m.code, classes: [] };
  const recipe = ctx.text.recipe(v);
  const near = ctx.text.sameFace(v);
  if (!near && m.status === 'classes') return { classes: recipe.classes };
  const nearest = near ? near.name : recipe.nearest.join(' ');
  // A variant plus the classes that differ keeps the component, which is how such a text gets built.
  const adjusted = near ? ctx.text.adjustments(v, near.name) : undefined;
  const exact = adjusted && adjusted.length > 0 ? `${near?.name} ${adjusted.join(' ')}` : recipe.exact.join(' ');
  const chosen = nc.resolve({
    kind: 'text',
    key: `text:${describeText(v)}`,
    design: [style, describeText(v)].filter(Boolean).join(' '),
    nearest,
    ...(exact === nearest ? {} : { override: exact }),
    ...noteOf(m.note, m.status === 'missing' ? [] : recipe.missing),
  });
  if (near && (chosen === near.name || chosen.startsWith(`${near.name} `))) {
    return { code: near.name, classes: chosen.slice(near.name.length).split(' ').filter(Boolean) };
  }
  return { classes: chosen.split(' ').filter(Boolean) };
}

function noteOf(note: string | undefined, missing: readonly string[]): { note?: string } {
  const parts = [note, missing.length > 0 ? `no token for ${missing.join(', ')}` : undefined].filter(Boolean);
  return parts.length > 0 ? { note: [...new Set(parts)].join('; ') } : {};
}

const CASE_CLASS = { upper: 'uppercase', lower: 'lowercase', title: 'capitalize' } as const;
const ALIGN_CLASS = { center: 'text-center', right: 'text-right', justify: 'text-justify' } as const;

/** Case and alignment, which no typography variant carries. */
function textShape(t: DesignNode['text']): string[] {
  return [...(t?.textCase ? [CASE_CLASS[t.textCase]] : []), ...(t?.align ? [ALIGN_CLASS[t.align]] : [])];
}

function textValue(n: DesignNode): TextValue | undefined {
  const t = n.text;
  if (!t?.family || t.sizePx === undefined || t.weight === undefined || t.lineHeightPx === undefined) return undefined;
  return { family: t.family, sizePx: t.sizePx, weight: t.weight, lineHeightPx: t.lineHeightPx, letterSpacingPx: t.letterSpacingPx ?? 0 };
}

function componentNode(ctx: TreeContext, n: DesignNode, parent: Layout | undefined): SpecNode {
  const use = n.component;
  if (!use) return leaf(n, 'box', []);
  const key = mapKeyOf(use);
  const row = ctx.components.get(key);
  const entry = ctx.map.get(key);
  const props: Record<string, string> = {};
  for (const [prop, value] of Object.entries(use.variant)) props[prop] = entry?.props?.[`${prop}=${value}`] ?? value;
  // Instance-swap properties hold node ids, which mean nothing in code.
  for (const [prop, value] of Object.entries(use.properties)) if (!/^\d+:\d+$/.test(String(value))) props[prop] = String(value);
  const texts = collectTexts(n);
  const code = row?.code ?? (row?.kind === 'icon' ? row.suggestions[0] : undefined);
  if (!code) define(ctx, key, use.name, use.variant, n);
  return {
    id: n.id,
    name: use.name,
    kind: row?.kind === 'icon' ? 'icon' : 'component',
    componentKey: key,
    ...(code ? { code } : {}),
    ...(Object.keys(props).length > 0 ? { props } : {}),
    classes: sizingClasses(ctx, n, parent),
    ...(texts.length > 0 ? { texts } : {}),
  };
}

/** Writes an unmapped component's inner tree once per variant used, from the first instance of it, to build as new markup. */
function define(ctx: TreeContext, key: string, name: string, variant: Readonly<Record<string, string>>, n: DesignNode): void {
  const signature = Object.entries(variant)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  const id = `${key}|${signature}`;
  if (ctx.definitions.has(id)) return;
  ctx.definitions.set(id, { key, name, variant: signature, tree: { id: n.id, name, kind: 'box', classes: [] } });
  const plain: DesignNode = Object.fromEntries(
    Object.entries(n).filter(([k]) => k !== 'component' && k !== 'sizing'),
  ) as unknown as DesignNode;
  ctx.definitions.set(id, { key, name, variant: signature, tree: buildTree(ctx, plain) });
}

function collectTexts(n: DesignNode, out: string[] = []): string[] {
  for (const c of n.children ?? []) {
    if (c.text?.characters.trim()) out.push(c.text.characters.trim());
    collectTexts(c, out);
  }
  return out;
}
