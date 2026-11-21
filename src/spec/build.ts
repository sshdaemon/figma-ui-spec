import type { Catalogue } from '../catalogue/types.ts';
import type { DesignSnapshot } from '../design/types.ts';
import type { ComponentRow, MapEntry } from '../mapping/components.ts';
import { ColorMatcher, ShadowMatcher, TextMatcher } from '../mapping/match.ts';
import type { MappingTable } from '../mapping/table.ts';
import { ConflictRegistry } from './conflicts.ts';
import { groupFlows, type Flow } from './flows.ts';
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
    questions: [...stateQuestions(flows, screens), ...componentQuestions(components), ...commentQuestions(snapshot, screens)],
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
  return flows.flatMap((flow, i) => {
    const design = flow.states.filter((s) => s.role === 'design');
    if (design.length === 0) return [];
    const showsText = screens[i]?.states.some((s) => s.tree && hasText(s.tree)) ?? false;
    return [...(showsText ? missingStates(flow) : []), ...roleQuestions(flow, design)];
  });
}

function missingStates(flow: Flow): string[] {
  const words = flow.states.map((s) => `${s.label ?? ''} ${s.frame.name}`).join(' ');
  const missing = USUAL_STATES.filter(([, pattern]) => !pattern.test(words)).map(([state]) => state);
  return missing.length > 0 ? [`${flow.name}: the design has no ${joinOr(missing)} state. What should each show?`] : [];
}

function roleQuestions(flow: Flow, design: readonly Flow['states'][number][]): string[] {
  const referenceNames = new Set(flow.states.filter((s) => s.role === 'reference').map((s) => s.frame.name));
  return design.flatMap((s) => {
    const id = `${flow.name}: ${s.frame.id} "${s.frame.name}"`;
    if (s.nameLooksLikeReference) return [`${id} is named like today's UI but no label says so. Is it a reference?`];
    if (referenceNames.has(s.frame.name)) {
      return [`${id}${s.label ? ` (${s.label})` : ''} has the name of a reference frame. Is it a new design or today's UI?`];
    }
    return [];
  });
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
