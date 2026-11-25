import type { Catalogue } from '../catalogue/types.ts';
import type { DesignNode, DesignSnapshot } from '../design/types.ts';
import type { ComponentRow, MapEntry } from '../mapping/components.ts';
import { ColorMatcher, ShadowMatcher, TextMatcher } from '../mapping/match.ts';
import type { MappingTable } from '../mapping/table.ts';
import { ConflictRegistry } from './conflicts.ts';
import { FINAL, groupFlows, iterationOf, type Flow } from './flows.ts';
import { buildTree, type TreeContext } from './tree.ts';
import type { SpecNode, SpecScreen, SpecState, UiSpec } from './types.ts';

export interface SpecInput {
  readonly repo: string;
  readonly snapshot: DesignSnapshot;
  readonly catalogue: Catalogue;
  readonly table: MappingTable;
  readonly map: readonly MapEntry[];
  /** An earlier spec for the same design, whose conflict ids and decisions carry over. */
  readonly previous?: UiSpec;
  readonly reference?: RegExp;
  readonly generated: string;
}

/** States designs often leave out, and the words that show a frame covers one. */
const USUAL_STATES: readonly (readonly [string, RegExp])[] = [
  ['empty', /\b(empty|no \w+|nothing)\b/i],
  ['loading', /\b(loading|skeleton|spinner)\b/i],
  ['error', /\b(error|fail(ed|ure)?)\b/i],
];

export function buildSpec(input: SpecInput): UiSpec {
  const { snapshot, catalogue } = input;
  const conflicts = new ConflictRegistry(input.previous?.conflicts ?? []);
  const ctx: TreeContext = {
    colors: new ColorMatcher(catalogue.tokens),
    text: new TextMatcher(catalogue.typography, catalogue.tokens),
    shadows: new ShadowMatcher(catalogue.tokens),
    tokens: catalogue.tokens,
    ...unit(catalogue),
    conflicts,
    components: new Map(input.table.components.map((c) => [c.key, c])),
    map: new Map(input.map.map((m) => [m.key, m])),
    definitions: new Map(),
  };
  const flows = groupFlows(snapshot.items, snapshot.skipped, input.reference).filter((f) =>
    f.states.some((s) => snapshot.frames[s.frame.id]),
  );
  const screens = flows.map((flow) => screenOf(ctx, flow, snapshot));
  const definitions = [...ctx.definitions.values()];
  const used = usedComponents([
    ...screens.flatMap((s) => s.states.flatMap((st) => (st.tree ? [st.tree] : []))),
    ...definitions.map((d) => d.tree),
  ]);
  const components = input.table.components.filter((c) => used.has(c.key));
  return {
    format: 1,
    generated: input.generated,
    repo: input.repo,
    source: {
      file: snapshot.file.name,
      fileKey: snapshot.file.fileKey,
      version: snapshot.file.version,
      root: snapshot.root.name,
      rootId: snapshot.root.id,
    },
    screens,
    components,
    definitions,
    conflicts: conflicts.list(),
    questions: [
      ...sectionQuestions(flows),
      ...stateQuestions(flows, screens),
      ...headingQuestions(flows, snapshot),
      ...componentQuestions(components),
      ...commentQuestions(snapshot, screens),
    ],
    gaps: gapsOf(input.table),
  };
}

function unit(catalogue: Catalogue): { unitPx?: number } {
  const px = catalogue.tokens.find((t) => t.kind === 'spacing')?.px;
  return px === undefined ? {} : { unitPx: px };
}

function screenOf(ctx: TreeContext, flow: Flow, snapshot: DesignSnapshot): SpecScreen {
  const states = flow.states
    .filter((s) => snapshot.frames[s.frame.id])
    .map((s): SpecState => {
      const frame = snapshot.frames[s.frame.id];
      const notes = snapshot.comments.filter((c) => c.frameId === s.frame.id && !c.resolved && !c.parentId).map((c) => c.message);
      return {
        frameId: s.frame.id,
        name: s.frame.name,
        ...(s.label ? { label: s.label } : {}),
        role: s.role,
        size: { w: s.frame.w, h: s.frame.h },
        notes,
        ...(frame && s.role === 'design' ? { tree: buildTree(ctx, frame) } : {}),
      };
    });
  return { name: flow.name, sections: flow.sections, states };
}

/** Map keys of the components and icons the given trees use. */
function usedComponents(trees: readonly SpecNode[]): Set<string> {
  const keys = new Set<string>();
  const walk = (n: SpecNode): void => {
    if (n.componentKey) keys.add(n.componentKey);
    for (const c of n.children ?? []) walk(c);
  };
  for (const t of trees) walk(t);
  return keys;
}

/** Missing usual states (asked once per flow that shows text), and frames whose role is unclear. */
function stateQuestions(flows: readonly Flow[], screens: readonly SpecScreen[]): string[] {
  const notBuilt = flows.flatMap((f) => f.states.filter((s) => s.role !== 'design'));
  return flows.flatMap((flow, i) => {
    const design = flow.states.filter((s) => s.role === 'design');
    if (design.length === 0) return [];
    const showsText = screens[i]?.states.some((s) => s.tree && hasText(s.tree)) ?? false;
    return [...(showsText ? missingStates(flow) : []), ...roleQuestions(flow, design, notBuilt)];
  });
}

function missingStates(flow: Flow): string[] {
  const words = flow.states.map((s) => `${s.label ?? ''} ${s.frame.name}`).join(' ');
  const missing = USUAL_STATES.filter(([, pattern]) => !pattern.test(words)).map(([state]) => state);
  return missing.length > 0 ? [`${flow.name}: the design has no ${joinOr(missing)} state. What should each show?`] : [];
}

type State = Flow['states'][number];

/** Widths within this many pixels count as the same frame size. */
const SAME_WIDTH_PX = 2;

/**
 * Design states that may not be meant to be built: named like today's UI, named like a reference frame of the flow, or
 * the odd size out in their flow while sized like frames that are not built (a modal left over from an earlier
 * iteration, say). The reasons a state has go into one question.
 */
function roleQuestions(flow: Flow, design: readonly State[], notBuilt: readonly State[]): string[] {
  const referenceNames = new Set(flow.states.filter((s) => s.role === 'reference').map((s) => s.frame.name));
  return design.flatMap((s) => {
    const id = `${flow.name}: ${s.frame.id} "${s.frame.name}"${s.label ? ` (${s.label})` : ''}`;
    const reasons = [
      ...(s.nameLooksLikeReference ? ["is named like today's UI but no label says so"] : []),
      ...(referenceNames.has(s.frame.name) ? ['has the name of a reference frame'] : []),
      ...oddSize(s, design, notBuilt),
    ];
    return reasons.length > 0 ? [`${id} ${reasons.join(' and ')}. Is it a new design, today's UI or an earlier iteration?`] : [];
  });
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= SAME_WIDTH_PX;
}

/**
 * Why a state's width stands out: no other design state of its flow has it, at least two others share a width (so a
 * desktop and mobile pair is not a "rest of the flow"), and frames that are not built have its width.
 */
function oddSize(s: State, design: readonly State[], notBuilt: readonly State[]): string[] {
  const others = design.filter((o) => o !== s);
  if (others.some((o) => near(o.frame.w, s.frame.w))) return [];
  if (!others.some((o) => others.filter((p) => near(p.frame.w, o.frame.w)).length >= 2)) return [];
  const alike = notBuilt.filter((o) => near(o.frame.w, s.frame.w)).map((o) => o.frame.id);
  if (alike.length === 0) return [];
  const widths = [...new Set(others.map((o) => o.frame.w))].toSorted((a, b) => a - b).join(', ');
  return [`is ${s.frame.w}px wide like frames that are not built (${alike.join(', ')}), unlike the flow's other states (${widths})`];
}

/**
 * Sections read as earlier iterations, at any depth, so the person confirms nothing real was left out, and sections
 * beside a final one whose names do not say which they are.
 */
function sectionQuestions(flows: readonly Flow[]): string[] {
  const iterations = new Set(flows.flatMap((f) => iterationOf(f.sections) ?? []));
  const superseded = [...iterations].map((t) => {
    const keepsFinal = flows.some((f) => f.sections.includes(t) && !iterationOf(f.sections));
    const what = keepsFinal ? 'its frames outside the Final section inside it are' : 'its frames are';
    return `Section "${t}" is read as an earlier iteration, so ${what} not built. Right?`;
  });
  const unclear = [...siblingSections(flows)].flatMap(([parent, names]) => {
    const final = [...names].find((n) => FINAL.test(n));
    if (!final) return [];
    // Only sections whose frames are built: a sibling inside an iteration is already superseded.
    return [...names]
      .filter((n) => !FINAL.test(n) && !iterationOf([...parent, n]))
      .map((n) => `Section "${n}" sits beside "${final}". Its frames are specced as states to build: is it an earlier iteration instead?`);
  });
  return [...superseded, ...new Set(unclear)];
}

/** The names of the sections under each parent section path, at every depth. */
function siblingSections(flows: readonly Flow[]): Map<readonly string[], Set<string>> {
  const byKey = new Map<string, { parent: readonly string[]; names: Set<string> }>();
  for (const { sections } of flows) {
    for (const [depth, name] of sections.entries()) {
      const parent = sections.slice(0, depth);
      const key = parent.join('\u0000');
      const entry = byKey.get(key) ?? { parent, names: new Set<string>() };
      byKey.set(key, { parent: entry.parent, names: entry.names.add(name) });
    }
  }
  return new Map([...byKey.values()].map((e) => [e.parent, e.names]));
}

/** Headings this size and weight or more name a screen or a drawer, rather than a step inside it. */
const HEADING_MIN_PX = 18;
const HEADING_MIN_WEIGHT = 600;

/**
 * A heading some design states of a flow show and others replace with another one, often because a frame was copied
 * from a sibling flow and kept its title. Headings every state shares (the page's own) are left out.
 */
function headingQuestions(flows: readonly Flow[], snapshot: DesignSnapshot): string[] {
  const perFlow = flows.map((flow) => {
    const states = flow.states.filter((s) => s.role === 'design' && snapshot.frames[s.frame.id]);
    return { flow, states: states.map((s) => ({ id: s.frame.id, headings: headingsOf(snapshot.frames[s.frame.id]) })) };
  });
  const owners = (heading: string, except: Flow): string[] =>
    perFlow.filter((p) => p.flow !== except && p.states.some((s) => s.headings.has(heading))).map((p) => p.flow.name);
  return perFlow.flatMap(({ flow, states }) => {
    const shared = new Set([...(states[0]?.headings ?? [])].filter((h) => states.every((s) => s.headings.has(h))));
    const varying = [...new Set(states.flatMap((s) => [...s.headings]))].filter((h) => !shared.has(h));
    if (states.length < 2 || varying.length < 2) return [];
    const parts = varying.map((h) => {
      const where = states.filter((s) => s.headings.has(h)).map((s) => s.id);
      const elsewhere = owners(h, flow);
      return `"${h}" (${where.join(', ')}${elsewhere.length > 0 ? `; also in ${elsewhere.join(', ')}` : ''})`;
    });
    return [`${flow.name}: its states show different headings: ${parts.join(', ')}. Which is right for each?`];
  });
}

function headingsOf(node: DesignNode | undefined): Set<string> {
  const out = new Set<string>();
  const walk = (n: DesignNode): void => {
    if (isHeading(n.text)) out.add((n.text?.characters ?? '').replace(/\s+/g, ' ').trim());
    for (const c of n.children ?? []) walk(c);
  };
  if (node) walk(node);
  return out;
}

function isHeading(t: DesignNode['text']): boolean {
  return (t?.sizePx ?? 0) >= HEADING_MIN_PX && (t?.weight ?? 0) >= HEADING_MIN_WEIGHT;
}

function hasText(n: SpecNode): boolean {
  return n.kind === 'text' || (n.texts?.length ?? 0) > 0 || (n.children ?? []).some(hasText);
}

function joinOr(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;
}

function componentQuestions(components: readonly ComponentRow[]): string[] {
  return components.flatMap((c) => {
    if (c.kind === 'mapped' || (c.kind === 'icon' && c.suggestions.length > 0)) return [];
    const hint = c.suggestions.length > 0 ? `suggestions: ${c.suggestions.join(', ')}` : 'no suggestion; new markup?';
    return [`Map component "${c.name}" (x${c.count}, key ${c.key}): ${hint}`];
  });
}

/** Every open designer comment as a question, prefixed with the flow and state it is pinned in when there is one. */
function commentQuestions(snapshot: DesignSnapshot, screens: readonly SpecScreen[]): string[] {
  const where = new Map(screens.flatMap((s) => s.states.map((st) => [st.frameId, `${s.name} / ${st.label ?? st.name}`] as const)));
  return snapshot.comments
    .filter((c) => !c.resolved && !c.parentId)
    .map((c) => {
      const place = c.frameId ? where.get(c.frameId) : undefined;
      return `${place ? `${place}: designer comment` : 'Open designer comment'}: ${c.message.replace(/\s+/g, ' ').trim()}`;
    });
}

function gapsOf(table: MappingTable): string[] {
  return table.rows
    .filter((r) => r.design && (r.match.status === 'renamed' || r.match.status === 'differs'))
    .map((r) => `${r.group} "${r.design}" (${r.value}) is ${r.match.code} in code${r.match.note ? `: ${r.match.note}` : ''}`);
}
