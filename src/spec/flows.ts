import type { CanvasBox, FrameRef, SkippedItem } from '../design/types.ts';
import type { StateRole } from './types.ts';

/** A frame placed in a flow, with the designer's label for it. */
export interface PlacedState {
  readonly frame: FrameRef;
  readonly label?: string;
  readonly role: StateRole;
  /** The frame's own name sounds like today's UI while no label says so; the spec asks. */
  readonly nameLooksLikeReference?: true;
}

export interface Flow {
  readonly name: string;
  readonly sections: readonly string[];
  readonly states: readonly PlacedState[];
}

export const DEFAULT_REFERENCE = /\b(current|old|existing|before|live)\b/i;

/** A line at least this long splits a section into flows, one band each. */
const DIVIDER_MIN_PX = 2000;
/** A label at most this far above a frame, overlapping it horizontally, names that frame. */
const LABEL_GAP_PX = 250;

/**
 * Frames grouped into flows the way designers lay out a board: each section, split into bands by long divider lines,
 * named by the band's top label. A label right above a frame names its state; a state whose label matches `reference`
 * (`LIVE SCREEN`) shows today's UI and is not built. Without canvas positions, frames group by section and name.
 */
export function groupFlows(items: readonly FrameRef[], skipped: readonly SkippedItem[], reference: RegExp = DEFAULT_REFERENCE): Flow[] {
  const frames = items.filter((i) => i.kind === 'frame');
  const bySection = groupBy(frames, (f) => f.sections.join('\u0000'));
  return [...bySection.values()].flatMap((group) => flowsOfSection(group, skipped, reference));
}

function flowsOfSection(frames: readonly FrameRef[], skipped: readonly SkippedItem[], reference: RegExp): Flow[] {
  const sections = frames[0]?.sections ?? [];
  const sameSection = skipped.filter((s) => s.sections.join('\u0000') === sections.join('\u0000') && s.canvas);
  const dividers = sameSection
    .filter((s) => (s.type === 'LINE' || s.type === 'VECTOR') && (s.canvas?.w ?? 0) >= DIVIDER_MIN_PX)
    .map((s) => s.canvas?.y ?? 0)
    .toSorted((a, b) => a - b);
  const labels = sameSection.filter((s) => s.text && (s.reason === 'label' || s.reason === 'note'));
  if (frames.some((f) => !f.canvas)) return byName(frames, sections, reference);
  const band = (box: CanvasBox): number => dividers.filter((y) => y < box.y).length;
  const bands = groupBy(frames, (f) => String(band(f.canvas as CanvasBox)));
  return [...bands.entries()]
    .toSorted((a, b) => Number(a[0]) - Number(b[0]))
    .map(([key, group]) => {
      const bandLabels = labels.filter((l) => String(band(l.canvas as CanvasBox)) === key);
      const header = bandLabels.toSorted((a, b) => topFirst(a.canvas, b.canvas))[0];
      const states = group.toSorted(byPosition).map((frame) => place(frame, bandLabels, reference));
      return { name: flowName(sections, header?.text ?? group[0]?.name ?? ''), sections, states };
    });
}

function byName(frames: readonly FrameRef[], sections: readonly string[], reference: RegExp): Flow[] {
  return [...groupBy(frames, (f) => f.name).entries()].map(([name, group]) => ({
    name: flowName(sections, name),
    sections,
    states: group.map((frame): PlacedState => ({
      frame,
      role: 'design',
      ...(reference.test(frame.name) ? { nameLooksLikeReference: true as const } : {}),
    })),
  }));
}

/** The nearest label names the state; any label stacked above it (`LIVE SCREENS` over `VARIANT B`) can mark it as reference. */
function place(frame: FrameRef, labels: readonly SkippedItem[], reference: RegExp): PlacedState {
  const chain: SkippedItem[] = [];
  for (let box = frame.canvas, next = labelAbove(box, labels); next && chain.length < 5; next = labelAbove(box, labels)) {
    chain.push(next);
    box = next.canvas;
  }
  const label = chain[0]?.text;
  const role: StateRole = chain.some((l) => reference.test(l.text ?? '')) ? 'reference' : 'design';
  const hint = role === 'design' && reference.test(frame.name) ? { nameLooksLikeReference: true as const } : {};
  return { frame, role, ...(label ? { label } : {}), ...hint };
}

function labelAbove(box: CanvasBox | undefined, labels: readonly SkippedItem[]): SkippedItem | undefined {
  if (!box) return undefined;
  return labels.filter((l) => sitsAbove(l.canvas as CanvasBox, box)).toSorted((a, b) => (b.canvas?.y ?? 0) - (a.canvas?.y ?? 0))[0];
}

function byPosition(a: FrameRef, b: FrameRef): number {
  return topFirst(a.canvas, b.canvas);
}

/** Top to bottom, then left to right. */
function topFirst(a: CanvasBox | undefined, b: CanvasBox | undefined): number {
  const dy = (a?.y ?? 0) - (b?.y ?? 0);
  return dy === 0 ? (a?.x ?? 0) - (b?.x ?? 0) : dy;
}

/** `label` sits just above `box` and overlaps it horizontally. */
function sitsAbove(label: CanvasBox, box: CanvasBox): boolean {
  const gap = box.y - (label.y + label.h);
  const overlaps = label.x < box.x + box.w && label.x + label.w > box.x;
  return overlaps && gap >= -10 && gap <= LABEL_GAP_PX;
}

function flowName(sections: readonly string[], name: string): string {
  return [...sections, name].filter(Boolean).join(' / ');
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) out.set(key(item), [...(out.get(key(item)) ?? []), item]);
  return out;
}
