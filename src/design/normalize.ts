import type { FigmaColor, FigmaEffect, FigmaNode, FigmaNodeEntry, FigmaPaint } from './figma-json.ts';
import type { Box, ComponentUse, DesignNode, Layout, Paint, Shadow, StyleRefs, TextContent } from './types.ts';

export interface NormalizeResult {
  readonly node: DesignNode;
  /** Hidden nodes left out of the tree. */
  readonly hidden: number;
}

/** A frame's REST entry as a compact tree: positions relative to the frame, style and component names resolved, hidden nodes dropped. */
export function normalizeFrame(entry: FigmaNodeEntry): NormalizeResult {
  const origin = entry.document.absoluteBoundingBox ?? { x: 0, y: 0 };
  const ctx = { entry, origin: { x: origin.x, y: origin.y }, hidden: 0 };
  return { node: convert(entry.document, ctx), hidden: ctx.hidden };
}

interface Context {
  readonly entry: FigmaNodeEntry;
  readonly origin: { readonly x: number; readonly y: number };
  hidden: number;
}

function convert(n: FigmaNode, ctx: Context): DesignNode {
  const children = (n.children ?? []).filter((c) => {
    if (c.visible !== false) return true;
    ctx.hidden += countNodes(c);
    return false;
  });
  const layout = layoutOf(n);
  const fills = paints(n.fills);
  const strokes = paints(n.strokes);
  const radius = radiusOf(n);
  const shadows = shadowsOf(n.effects);
  const styles = styleRefs(n.styles, ctx.entry);
  const variables = variablesOf(n.boundVariables);
  const text = textOf(n);
  const component = componentOf(n, ctx.entry);
  return {
    id: n.id,
    name: n.name,
    type: n.type,
    box: boxOf(n, ctx.origin),
    ...(layout ? { layout } : {}),
    ...(fills.length > 0 ? { fills } : {}),
    ...(strokes.length > 0 ? { strokes, ...(n.strokeWeight ? { strokeWeight: n.strokeWeight } : {}) } : {}),
    ...(radius === undefined ? {} : { radius }),
    ...(shadows.length > 0 ? { shadows } : {}),
    ...(n.opacity !== undefined && n.opacity < 1 ? { opacity: round(n.opacity) } : {}),
    ...(styles ? { styles } : {}),
    ...(variables ? { variables } : {}),
    ...(text ? { text } : {}),
    ...(component ? { component } : {}),
    ...(children.length > 0 ? { children: children.map((c) => convert(c, ctx)) } : {}),
  };
}

export function countNodes(n: FigmaNode): number {
  return 1 + (n.children ?? []).reduce((sum, c) => sum + countNodes(c), 0);
}

function boxOf(n: FigmaNode, origin: { x: number; y: number }): Box {
  const b = n.absoluteBoundingBox;
  if (!b) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: round(b.x - origin.x), y: round(b.y - origin.y), w: round(b.width), h: round(b.height) };
}

function layoutOf(n: FigmaNode): Layout | undefined {
  if (n.layoutMode !== 'HORIZONTAL' && n.layoutMode !== 'VERTICAL') return undefined;
  return {
    direction: n.layoutMode === 'HORIZONTAL' ? 'row' : 'column',
    gap: n.itemSpacing ?? 0,
    padding: [n.paddingTop ?? 0, n.paddingRight ?? 0, n.paddingBottom ?? 0, n.paddingLeft ?? 0],
    wrap: n.layoutWrap === 'WRAP',
    ...(n.primaryAxisAlignItems ? { mainAlign: n.primaryAxisAlignItems.toLowerCase() } : {}),
    ...(n.counterAxisAlignItems ? { crossAlign: n.counterAxisAlignItems.toLowerCase() } : {}),
  };
}

function paints(list: readonly FigmaPaint[] | undefined): Paint[] {
  return (list ?? []).filter((p) => p.visible !== false).map(paintOf);
}

function paintOf(p: FigmaPaint): Paint {
  if (p.type === 'SOLID' && p.color) return { kind: 'solid', hex: toHex(p.color, p.opacity ?? 1) };
  if (p.type === 'IMAGE') return { kind: 'image' };
  if (p.type.startsWith('GRADIENT')) return { kind: 'gradient' };
  return { kind: 'other' };
}

function radiusOf(n: FigmaNode): DesignNode['radius'] {
  const r = n.rectangleCornerRadii;
  if (r && r.length === 4 && new Set(r).size > 1) return [r[0] ?? 0, r[1] ?? 0, r[2] ?? 0, r[3] ?? 0];
  const single = n.cornerRadius ?? r?.[0];
  return single ? single : undefined;
}

function shadowsOf(effects: readonly FigmaEffect[] | undefined): Shadow[] {
  return (effects ?? [])
    .filter((e) => e.visible !== false && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') && e.color)
    .map((e) => ({
      kind: e.type === 'DROP_SHADOW' ? ('drop' as const) : ('inner' as const),
      x: e.offset?.x ?? 0,
      y: e.offset?.y ?? 0,
      blur: e.radius ?? 0,
      spread: e.spread ?? 0,
      hex: toHex(e.color as FigmaColor, 1),
    }));
}

/** Figma names a node's style slots `fill`/`fills`, `stroke`/`strokes`, `text` and `effect`. */
function styleRefs(styles: FigmaNode['styles'], entry: FigmaNodeEntry): StyleRefs | undefined {
  if (!styles) return undefined;
  const name = (...slots: string[]): string | undefined => {
    for (const slot of slots) {
      const id = styles[slot];
      const meta = id ? entry.styles?.[id] : undefined;
      if (meta) return meta.name;
    }
    return undefined;
  };
  const refs: StyleRefs = {
    ...optional('fill', name('fill', 'fills')),
    ...optional('stroke', name('stroke', 'strokes')),
    ...optional('text', name('text')),
    ...optional('effect', name('effect', 'effects')),
  };
  return Object.keys(refs).length > 0 ? refs : undefined;
}

function optional<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

/** Variable ids per bound property, whether Figma gives one alias, a list, or a nested record (fills, strokes). */
function variablesOf(bound: FigmaNode['boundVariables']): Record<string, string[]> | undefined {
  if (!bound) return undefined;
  const out: Record<string, string[]> = {};
  for (const [prop, value] of Object.entries(bound)) {
    const ids = aliasIds(value);
    if (ids.length > 0) out[prop] = ids;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function aliasIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(aliasIds);
  if (typeof value !== 'object' || value === null) return [];
  const rec = value as Record<string, unknown>;
  if (rec['type'] === 'VARIABLE_ALIAS' && typeof rec['id'] === 'string') return [rec['id']];
  return Object.values(rec).flatMap(aliasIds);
}

function textOf(n: FigmaNode): TextContent | undefined {
  if (n.type !== 'TEXT' || n.characters === undefined) return undefined;
  const s = n.style ?? {};
  return {
    characters: n.characters,
    ...(s.fontFamily ? { family: s.fontFamily } : {}),
    ...(s.fontWeight ? { weight: s.fontWeight } : {}),
    ...(s.fontSize ? { sizePx: round(s.fontSize) } : {}),
    ...(s.lineHeightPx ? { lineHeightPx: round(s.lineHeightPx) } : {}),
    ...(s.letterSpacing ? { letterSpacingPx: round(s.letterSpacing) } : {}),
    mixed: (n.characterStyleOverrides ?? []).some((o) => o !== 0),
  };
}

function componentOf(n: FigmaNode, entry: FigmaNodeEntry): ComponentUse | undefined {
  if (n.type !== 'INSTANCE' || !n.componentId) return undefined;
  const meta = entry.components?.[n.componentId];
  const set = meta?.componentSetId ? entry.componentSets?.[meta.componentSetId] : undefined;
  const variant: Record<string, string> = {};
  const properties: Record<string, string | boolean> = {};
  for (const [rawName, prop] of Object.entries(n.componentProperties ?? {})) {
    if (prop.type === 'VARIANT') variant[rawName] = String(prop.value);
    else properties[rawName.replace(/#[\d:]+$/, '')] = prop.value;
  }
  return {
    name: set?.name ?? meta?.name ?? n.name,
    key: set?.key ?? meta?.key ?? n.componentId,
    remote: (set ?? meta)?.remote ?? false,
    variant,
    properties,
  };
}

function byte(v: number): string {
  return Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, '0');
}

export function toHex(c: FigmaColor, opacity: number): string {
  const alpha = c.a * opacity;
  return `#${byte(c.r)}${byte(c.g)}${byte(c.b)}${alpha < 1 ? byte(alpha) : ''}`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
