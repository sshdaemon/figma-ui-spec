import type { ComponentRow } from '../mapping/components.ts';
import type { Conflict, SpecNode, SpecState, UiSpec } from './types.ts';

/** The spec as markdown for the coding thread: one tree per design state, then conflicts, components, questions and gaps. */
export function renderSpec(spec: UiSpec): string {
  const designStates = spec.screens.flatMap((s) => s.states.filter((st) => st.role === 'design'));
  const lines = [
    `# UI spec: ${spec.source.root}`,
    '',
    `Figma file "${spec.source.file}" version ${spec.source.version}, node ${spec.source.rootId}; built against ${spec.repo} on ${spec.generated}.`,
    `${spec.screens.length} flows, ${designStates.length} states to build, ${spec.conflicts.length} conflicts, ${spec.questions.length} questions.`,
    '',
    'Each state is a tree of what to write: `Component` from its file, typography as a variant or classes, and markup with Tailwind classes. ',
    '`⚠K3` marks a value the code does not have; the conflict list says what was used instead and what else is possible.',
  ];
  for (const screen of spec.screens) {
    lines.push('', `## ${screen.name}`);
    for (const [i, state] of screen.states.entries()) lines.push('', ...stateLines(state, i + 1));
  }
  if (spec.definitions.length > 0) {
    lines.push(
      '',
      '## Components to build',
      '',
      'No code component is mapped to these; build each once as new markup (or map it with `map` and re-run).',
    );
    for (const [key, group] of byKey(spec.definitions)) {
      lines.push('', `### ${group[0]?.name ?? key} (key \`${key}\`)`);
      for (const d of group) lines.push('', ...(d.variant ? [`${d.variant}:`, ''] : []), '```text', ...nodeLines(d.tree, 0), '```');
    }
  }
  lines.push('', '## Conflicts', '', ...conflictLines(spec.conflicts));
  lines.push('', '## Components', '', ...componentLines(spec.components));
  lines.push('', '## Questions', '', ...listOrNone(spec.questions));
  lines.push(
    '',
    '## Design-system gaps',
    '',
    'Names and values the design and the code disagree on, for the designer; the trees above already use the code side.',
    '',
    ...listOrNone(spec.gaps),
  );
  return `${lines.join('\n')}\n`;
}

function byKey(definitions: UiSpec['definitions']): Map<string, UiSpec['definitions'][number][]> {
  const out = new Map<string, UiSpec['definitions'][number][]>();
  for (const d of definitions) out.set(d.key, [...(out.get(d.key) ?? []), d]);
  return out;
}

function stateLines(state: SpecState, n: number): string[] {
  const title = `### State ${n}: ${state.label ?? state.name} (${state.frameId}, ${state.size.w}x${state.size.h})`;
  const notes = state.notes.length > 0 ? ['', 'Designer notes:', ...state.notes.map((m) => `- ${oneLine(m)}`)] : [];
  if (state.role === 'reference') return [title, '', "Reference: shows today's UI for comparison. Not built.", ...notes];
  if (state.role === 'superseded') return [title, '', 'Earlier iteration: the final designs replace it. Not built.', ...notes];
  const tree = state.tree ? ['', '```text', ...nodeLines(state.tree, 0), '```'] : [];
  return [title, ...notes, ...tree];
}

function nodeLines(n: SpecNode, depth: number): string[] {
  const parts = [label(n)];
  if (n.props && Object.keys(n.props).length > 0) {
    parts.push(
      Object.entries(n.props)
        .map(([k, v]) => `${k}=${v}`)
        .join(' '),
    );
  }
  if (n.classes.length > 0) parts.push(n.classes.join(' '));
  if (n.text !== undefined) parts.push(JSON.stringify(oneLine(n.text)));
  if (n.texts && n.texts.length > 0) parts.push(n.texts.map((t) => JSON.stringify(oneLine(t))).join(' '));
  if (n.conflicts && n.conflicts.length > 0) parts.push(n.conflicts.map((c) => `⚠${c}`).join(' '));
  const line = `${'  '.repeat(depth)}${parts.join('  ')}`;
  return [line, ...(n.children ?? []).flatMap((c) => nodeLines(c, depth + 1))];
}

function label(n: SpecNode): string {
  if (n.kind === 'component' || n.kind === 'icon') {
    return n.code ? `<${n.name}> ${n.code}` : `<${n.name}> (unmapped, see Components to build)`;
  }
  if (n.kind === 'text') return n.code ? `text ${n.code}` : 'text';
  if (n.kind === 'image') return `image "${n.name}"`;
  if (n.kind === 'vector') return n.classes.includes('asset') ? `svg asset "${n.name}" (export from Figma)` : `svg "${n.name}"`;
  return `div "${n.name}"`;
}

function conflictLines(conflicts: readonly Conflict[]): string[] {
  if (conflicts.length === 0) return ['None.'];
  const head = [
    '| id | kind | design | uses | nearest (default) | override | outcome | note |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  return [
    ...head,
    ...conflicts.map((c) => {
      const outcome = c.decidedBy ? `${c.outcome} (${c.decidedBy}, ${c.decided ?? ''})` : `${c.outcome} (default)`;
      return `| ${c.id} | ${c.kind} | ${cell(c.design)} | ${c.uses === 0 ? 'not in this run' : c.uses} | \`${cell(c.nearest)}\` | ${c.override ? `\`${cell(c.override)}\`` : ''} | ${outcome} | ${cell(c.note ?? '')} |`;
    }),
  ];
}

function componentLines(rows: readonly ComponentRow[]): string[] {
  if (rows.length === 0) return ['None.'];
  return rows.map((c) => {
    const target = c.code ?? (c.kind === 'icon' && c.suggestions[0] ? `${c.suggestions[0]} (icon, default)` : 'unmapped');
    return `- ${c.name} x${c.count}: ${target} (key \`${c.key}\`)`;
  });
}

function listOrNone(items: readonly string[]): string[] {
  return items.length > 0 ? items.map((i) => `- ${oneLine(i)}`) : ['None.'];
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function cell(s: string): string {
  return s.replace(/\|/g, '\\|');
}
