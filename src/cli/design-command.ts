import type { DesignNode, DesignSnapshot, FrameRef } from '../design/types.ts';
import type { ReadStats } from '../design/read.ts';

interface FrameCounts {
  nodes: number;
  instances: number;
  texts: number;
}

export function renderDesign(s: DesignSnapshot, stats: ReadStats): string {
  const lines: string[] = [
    `${s.file.name}  version ${s.file.version}, saved ${s.file.lastModified}`,
    `Root: ${s.root.name} (${s.root.type.toLowerCase()} ${s.root.id})`,
  ];

  for (const [kind, title] of [
    ['frame', 'Design frames'],
    ['component', 'Local components'],
  ] as const) {
    const items = s.items.filter((i) => i.kind === kind);
    lines.push('', `${title} (${items.length})`);
    for (const [section, group] of bySection(items)) {
      lines.push(`  ${section}`);
      for (const i of group) lines.push(`    ${i.id.padEnd(12)} ${i.name.padEnd(28)} ${i.w}x${i.h}${frameSummary(s.frames[i.id])}`);
    }
  }

  lines.push('', `Skipped (${s.skipped.length})`);
  for (const k of s.skipped) lines.push(`  ${k.id.padEnd(12)} ${k.name.slice(0, 40).padEnd(40)} ${k.reason}`);

  const frames = Object.values(s.frames);
  const styles = new Map<string, Set<string>>();
  const components = new Map<string, { count: number; props: Set<string> }>();
  for (const f of frames) {
    walk(f, (n) => {
      for (const [slot, name] of Object.entries(n.styles ?? {})) (styles.get(slot) ?? styles.set(slot, new Set()).get(slot))?.add(name);
      if (n.component) {
        const c = components.get(n.component.name) ?? { count: 0, props: new Set<string>() };
        c.count++;
        for (const p of Object.keys(n.component.variant)) c.props.add(p);
        components.set(n.component.name, c);
      }
    });
  }
  lines.push('', 'Library styles used');
  for (const [slot, names] of styles) lines.push(`  ${slot.padEnd(7)} ${[...names].toSorted().join(', ')}`);
  lines.push('', `Components used (${components.size})`);
  for (const [name, c] of [...components].toSorted((a, b) => b[1].count - a[1].count)) {
    lines.push(`  ${name.padEnd(36)} x${c.count}${c.props.size > 0 ? `  variants: ${[...c.props].join(', ')}` : ''}`);
  }

  const open = s.comments.filter((c) => !c.resolved);
  lines.push(
    '',
    `Comments: ${open.length} open, ${s.comments.length - open.length} resolved, ${s.comments.filter((c) => c.frameId).length} inside read frames`,
  );
  lines.push(`Hidden nodes left out: ${s.hiddenNodes}`);
  const c = stats.calls;
  lines.push(
    `Figma API calls: meta ${c.meta}, outline ${c.outline}, frames ${c.nodes}, comments ${c.comments}; frames from cache: ${stats.cachedFrames}`,
  );
  return `${lines.join('\n')}\n`;
}

function bySection(items: readonly FrameRef[]): Map<string, FrameRef[]> {
  const groups = new Map<string, FrameRef[]>();
  for (const i of items) {
    const key = i.sections.join(' / ') || '(no section)';
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  return groups;
}

function frameSummary(f: DesignNode | undefined): string {
  if (!f) return '  (not read)';
  const counts: FrameCounts = { nodes: 0, instances: 0, texts: 0 };
  walk(f, (n) => {
    counts.nodes++;
    if (n.component) counts.instances++;
    if (n.text) counts.texts++;
  });
  return `  ${counts.nodes} nodes, ${counts.instances} instances, ${counts.texts} texts`;
}

export function walk(n: DesignNode, visit: (n: DesignNode) => void): void {
  visit(n);
  for (const c of n.children ?? []) walk(c, visit);
}
