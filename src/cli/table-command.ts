import type { ComponentRow } from '../mapping/components.ts';
import type { MatchStatus } from '../mapping/match.ts';
import { countByStatus, type MappingTable, type RowGroup, type TableRow } from '../mapping/table.ts';

const GROUPS: readonly (readonly [RowGroup, string])[] = [
  ['colour', 'Colours'],
  ['text', 'Text'],
  ['shadow', 'Shadows'],
  ['gap', 'Gaps'],
  ['padding', 'Padding'],
  ['radius', 'Radius'],
];

const STATUS_ORDER: readonly MatchStatus[] = ['same', 'renamed', 'classes', 'differs', 'off-scale', 'missing'];

export function renderTable(table: MappingTable, title: string): string {
  const counts = countByStatus(table.rows);
  const summary = STATUS_ORDER.flatMap((s) => (counts[s] ? [`${s} ${counts[s]}`] : [])).join(', ');
  const lines = [title, `Values: ${summary}`];
  for (const [group, heading] of GROUPS) {
    const rows = table.rows.filter((r) => r.group === group);
    if (rows.length === 0) continue;
    lines.push('', heading);
    for (const r of rows.toSorted(byStatus)) lines.push(`  ${rowLine(r)}`);
  }
  lines.push('', `Components (${table.components.length})`);
  for (const c of table.components) lines.push(`  ${componentLine(c)}`);
  return `${lines.join('\n')}\n`;
}

function byStatus(a: TableRow, b: TableRow): number {
  return STATUS_ORDER.indexOf(b.match.status) - STATUS_ORDER.indexOf(a.match.status) || b.uses - a.uses;
}

function rowLine(r: TableRow): string {
  const design = (r.design || '(no style)').slice(0, 30).padEnd(30);
  const value = r.value.slice(0, 44).padEnd(44);
  const note = r.match.note ? `  (${r.match.note})` : '';
  return `${r.match.status.padEnd(9)} ${design} ${value} x${String(r.uses).padEnd(4)} ${r.match.code}${note}`;
}

function componentLine(c: ComponentRow): string {
  const head = `${c.kind.padEnd(9)} ${c.name.slice(0, 30).padEnd(30)} x${String(c.count).padEnd(4)}`;
  const variants = Object.entries(c.variants)
    .map(([prop, values]) => `${prop}=${values.join('|')}`)
    .join(' ');
  return `${head} ${target(c)}${variants ? `  [${variants}]` : ''}  key ${c.key}`;
}

function target(c: ComponentRow): string {
  if (c.code) return `→ ${c.code}`;
  if (c.suggestions.length > 0) return `suggest ${c.suggestions.join(', ')}`;
  return 'no suggestion';
}
