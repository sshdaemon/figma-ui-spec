import type { FigmaNode } from './figma-json.ts';
import type { FrameRef, ItemKind, SkippedItem } from './types.ts';

/** A project-specific rule: items or sections whose type (if given) and name match are skipped with the reason given. */
export interface SkipRule {
  /** A Figma node type in upper case, for example `FRAME` or `SECTION`. */
  readonly type?: string;
  readonly name?: string;
  readonly reason: string;
}

interface Rule {
  readonly reason: string;
  readonly test: (n: FigmaNode) => boolean;
}

/** Labels designers put next to screens: short frames holding only text. */
const LABEL_MAX_HEIGHT = 80;

function isLabelFrame(n: FigmaNode): boolean {
  if (n.type !== 'FRAME' || (n.absoluteBoundingBox?.height ?? Infinity) > LABEL_MAX_HEIGHT) return false;
  const children = n.children ?? [];
  return children.length > 0 && children.every((c) => c.type === 'TEXT');
}

const BUILT_IN: readonly Rule[] = [
  { reason: 'pasted image', test: (n) => n.type === 'RECTANGLE' && (n.fills ?? []).some((f) => f.type === 'IMAGE') },
  { reason: 'connector or divider', test: (n) => ['VECTOR', 'LINE', 'ARROW', 'CONNECTOR'].includes(n.type) },
  { reason: 'outline shape', test: (n) => ['RECTANGLE', 'ELLIPSE'].includes(n.type) && visibleFills(n) === 0 },
  { reason: 'note', test: (n) => ['TEXT', 'STICKY', 'SHAPE_WITH_TEXT'].includes(n.type) },
  { reason: 'label', test: isLabelFrame },
];

const FRAME_TYPES: Readonly<Record<string, ItemKind>> = { FRAME: 'frame', INSTANCE: 'frame', GROUP: 'frame', COMPONENT: 'component', COMPONENT_SET: 'component' };

export interface Outline {
  readonly items: FrameRef[];
  readonly skipped: SkippedItem[];
}

interface Rules {
  readonly project: readonly Rule[];
  readonly builtIn: readonly Rule[];
}

/**
 * The design frames and components under a page, section or frame, and what was skipped and why.
 * Nested sections are walked unless a project rule skips them; anything that is not a frame or component,
 * or matches a rule, is skipped. A frame's direct children must be in the tree for the label rule.
 */
export function outline(root: FigmaNode, rules: readonly SkipRule[] = []): Outline {
  const out: Outline = { items: [], skipped: [] };
  const compiled: Rules = { project: rules.map(compile), builtIn: BUILT_IN };
  if (root.type !== 'CANVAS' && root.type !== 'SECTION') {
    visit(root, [], out, compiled);
    return out;
  }
  const sections = root.type === 'SECTION' ? [root.name] : [];
  for (const child of root.children ?? []) visit(child, sections, out, compiled);
  return out;
}

function compile(r: SkipRule): Rule {
  const name = r.name === undefined ? undefined : new RegExp(r.name);
  return { reason: r.reason, test: (n) => (r.type === undefined || r.type === n.type) && (name === undefined || name.test(n.name)) };
}

function visit(n: FigmaNode, sections: readonly string[], out: Outline, rules: Rules): void {
  if (n.visible === false) {
    out.skipped.push(skippedOf(n, 'hidden', sections));
    return;
  }
  const projectRule = rules.project.find((r) => r.test(n));
  if (projectRule) {
    out.skipped.push(skippedOf(n, projectRule.reason, sections));
    return;
  }
  if (n.type === 'SECTION') {
    for (const child of n.children ?? []) visit(child, [...sections, n.name], out, rules);
    return;
  }
  const builtIn = rules.builtIn.find((r) => r.test(n));
  if (builtIn) {
    out.skipped.push(skippedOf(n, builtIn.reason, sections));
    return;
  }
  const kind = FRAME_TYPES[n.type];
  if (!kind) {
    out.skipped.push(skippedOf(n, `not a frame (${n.type.toLowerCase()})`, sections));
    return;
  }
  const box = n.absoluteBoundingBox;
  out.items.push({ id: n.id, name: n.name, kind, sections, w: Math.round(box?.width ?? 0), h: Math.round(box?.height ?? 0) });
}

function skippedOf(n: FigmaNode, reason: string, sections: readonly string[]): SkippedItem {
  return { id: n.id, name: n.name, type: n.type, reason, sections };
}

function visibleFills(n: FigmaNode): number {
  return (n.fills ?? []).filter((f) => f.visible !== false).length;
}

/**
 * Nodes a depth-limited read cut off that the outline still needs: sections at the limit (their frames are missing)
 * and the direct children of sections at the limit (their own children are missing, which the label rule reads).
 * `limit` is the depth the tree was read to, counted from `root` at 0.
 */
export function cutOff(root: FigmaNode, limit: number): string[] {
  const ids: string[] = [];
  const walk = (n: FigmaNode, level: number, parentType: string | undefined): void => {
    if (level === limit) {
      if (n.type === 'SECTION' || parentType === 'SECTION') ids.push(n.id);
      return;
    }
    for (const c of n.children ?? []) walk(c, level + 1, n.type);
  };
  walk(root, 0, undefined);
  return ids;
}

/** The tree with each listed node's children replaced by the ones read for it. */
export function graft(root: FigmaNode, read: ReadonlyMap<string, FigmaNode>): FigmaNode {
  const replacement = read.get(root.id);
  if (replacement) return { ...root, children: replacement.children ?? [] };
  if (!root.children) return root;
  return { ...root, children: root.children.map((c) => graft(c, read)) };
}
