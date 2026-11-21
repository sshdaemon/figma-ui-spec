import type { ComponentUse, DesignNode, DesignSnapshot, Shadow, TextContent } from '../design/types.ts';

/** A design value and the nodes that use it. */
export interface Used<T> {
  readonly value: T;
  /** Node ids, at most a few, so a reader can find an example. */
  readonly examples: readonly string[];
  readonly count: number;
}

export type TextValue = Required<Pick<TextContent, 'family' | 'sizePx' | 'weight' | 'lineHeightPx'>> & { readonly letterSpacingPx: number };

/** One library style and every value its nodes carry (normally one). */
export interface StyleUse<T> {
  readonly name: string;
  readonly values: readonly Used<T>[];
}

export interface ComponentUsage {
  readonly name: string;
  readonly key: string;
  readonly remote: boolean;
  readonly count: number;
  readonly examples: readonly string[];
  /** Every value seen per variant property, for example `{ Size: ['sm', 'md'] }`. */
  readonly variants: Readonly<Record<string, readonly string[]>>;
  /** Largest width and height seen, which tells icons apart from components. */
  readonly maxW: number;
  readonly maxH: number;
}

export interface DesignUsage {
  readonly colorStyles: readonly StyleUse<string>[];
  /** Fill and stroke colours on nodes with no colour style. */
  readonly rawColors: readonly Used<string>[];
  readonly textStyles: readonly StyleUse<TextValue>[];
  /** Text on nodes with no text style. */
  readonly rawText: readonly Used<TextValue>[];
  readonly effectStyles: readonly StyleUse<readonly Shadow[]>[];
  readonly gaps: readonly Used<number>[];
  readonly paddings: readonly Used<number>[];
  readonly radii: readonly Used<number>[];
  readonly components: readonly ComponentUsage[];
}

const EXAMPLES = 3;

/** Every value the read frames use, grouped the way the code side is matched. Nodes inside component instances count only through the instance. */
export function collectUsage(snapshot: DesignSnapshot): DesignUsage {
  const c = new Collector();
  for (const frame of Object.values(snapshot.frames)) c.visit(frame, false);
  return c.result();
}

class Collector {
  private readonly colorStyles = new Map<string, Map<string, MutableUsed<string>>>();
  private readonly rawColors = new Map<string, MutableUsed<string>>();
  private readonly textStyles = new Map<string, Map<string, MutableUsed<TextValue>>>();
  private readonly rawText = new Map<string, MutableUsed<TextValue>>();
  private readonly effectStyles = new Map<string, Map<string, MutableUsed<readonly Shadow[]>>>();
  private readonly gaps = new Map<string, MutableUsed<number>>();
  private readonly paddings = new Map<string, MutableUsed<number>>();
  private readonly radii = new Map<string, MutableUsed<number>>();
  private readonly components = new Map<string, MutableComponent>();

  visit(n: DesignNode, insideInstance: boolean): void {
    if (n.component) this.component(n, n.component);
    if (!insideInstance) this.own(n);
    for (const child of n.children ?? []) this.visit(child, insideInstance || n.component !== undefined);
  }

  private own(n: DesignNode): void {
    // A component set's own fill and dashed purple outline are Figma's canvas chrome, not design.
    if (n.type !== 'COMPONENT_SET') {
      this.paints(n, n.fills, n.styles?.fill);
      this.paints(n, n.strokes, n.styles?.stroke);
    }
    const text = textValue(n.text);
    if (text) add(n.styles?.text ? group(this.textStyles, n.styles.text) : this.rawText, JSON.stringify(text), text, n.id);
    if (n.shadows && n.styles?.effect) add(group(this.effectStyles, n.styles.effect), JSON.stringify(n.shadows), n.shadows, n.id);
    this.layout(n);
    for (const r of radiiOf(n.radius)) add(this.radii, String(r), r, n.id);
  }

  private layout(n: DesignNode): void {
    if (!n.layout) return;
    // With "Auto" spacing (space-between) Figma keeps a stale itemSpacing that the design does not use.
    const spaced = n.layout.mainAlign !== 'space_between' && (n.children?.length ?? 0) > 1;
    if (n.layout.gap > 0 && spaced) add(this.gaps, String(n.layout.gap), n.layout.gap, n.id);
    for (const p of new Set(n.layout.padding)) if (p > 0) add(this.paddings, String(p), p, n.id);
  }

  private paints(n: DesignNode, paints: DesignNode['fills'], style: string | undefined): void {
    for (const p of paints ?? []) {
      if (p.kind !== 'solid' || !p.hex) continue;
      add(style ? group(this.colorStyles, style) : this.rawColors, p.hex, p.hex, n.id);
    }
  }

  private component(n: DesignNode, use: ComponentUse): void {
    const c = this.components.get(use.key) ?? {
      name: use.name,
      key: use.key,
      remote: use.remote,
      count: 0,
      examples: [],
      variants: {},
      maxW: 0,
      maxH: 0,
    };
    c.count++;
    if (c.examples.length < EXAMPLES) c.examples.push(n.id);
    for (const [prop, value] of Object.entries(use.variant)) {
      const seen = (c.variants[prop] ??= []);
      if (!seen.includes(value)) seen.push(value);
    }
    c.maxW = Math.max(c.maxW, n.box.w);
    c.maxH = Math.max(c.maxH, n.box.h);
    this.components.set(use.key, c);
  }

  result(): DesignUsage {
    const styles = <T>(m: Map<string, Map<string, MutableUsed<T>>>): StyleUse<T>[] =>
      [...m].map(([name, values]) => ({ name, values: byCount(values) })).toSorted((a, b) => a.name.localeCompare(b.name));
    return {
      colorStyles: styles(this.colorStyles),
      rawColors: byCount(this.rawColors),
      textStyles: styles(this.textStyles),
      rawText: byCount(this.rawText),
      effectStyles: styles(this.effectStyles),
      gaps: byValue(this.gaps),
      paddings: byValue(this.paddings),
      radii: byValue(this.radii),
      components: [...this.components.values()].toSorted((a, b) => b.count - a.count),
    };
  }
}

interface MutableUsed<T> {
  value: T;
  examples: string[];
  count: number;
}

type MutableComponent = Omit<ComponentUsage, 'examples' | 'variants'> & {
  count: number;
  examples: string[];
  variants: Record<string, string[]>;
  maxW: number;
  maxH: number;
};

function group<T>(m: Map<string, Map<string, MutableUsed<T>>>, name: string): Map<string, MutableUsed<T>> {
  const existing = m.get(name);
  if (existing) return existing;
  const created = new Map<string, MutableUsed<T>>();
  m.set(name, created);
  return created;
}

function add<T>(m: Map<string, MutableUsed<T>>, key: string, value: T, nodeId: string): void {
  const u = m.get(key) ?? { value, examples: [], count: 0 };
  u.count++;
  if (u.examples.length < EXAMPLES) u.examples.push(nodeId);
  m.set(key, u);
}

function byCount<T>(m: Map<string, MutableUsed<T>>): Used<T>[] {
  return [...m.values()].toSorted((a, b) => b.count - a.count);
}

function byValue(m: Map<string, MutableUsed<number>>): Used<number>[] {
  return [...m.values()].toSorted((a, b) => a.value - b.value);
}

function textValue(t: TextContent | undefined): TextValue | undefined {
  if (!t?.family || t.sizePx === undefined || t.weight === undefined || t.lineHeightPx === undefined) return undefined;
  return { family: t.family, sizePx: t.sizePx, weight: t.weight, lineHeightPx: t.lineHeightPx, letterSpacingPx: t.letterSpacingPx ?? 0 };
}

function radiiOf(radius: DesignNode['radius']): number[] {
  if (radius === undefined) return [];
  if (typeof radius === 'number') return [radius];
  return [...new Set(radius)].filter((r) => r > 0);
}
