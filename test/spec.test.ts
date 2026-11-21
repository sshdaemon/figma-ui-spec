import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { decide, previousFor, readSpec, writeSpec } from '../src/adapters/fs/spec-files.ts';
import { applyDeclarations, buildTokens, parseThemeDeclarations } from '../src/catalogue/theme.ts';
import { indexTokens } from '../src/catalogue/typography.ts';
import { typographyVariants } from '../src/catalogue/variants.ts';
import type { Catalogue } from '../src/catalogue/types.ts';
import { appendGaps } from '../src/cli/config.ts';
import type { DesignNode, DesignSnapshot, FrameRef, SkippedItem } from '../src/design/types.ts';
import { matchComponents } from '../src/mapping/components.ts';
import { ColorMatcher, ShadowMatcher, TextMatcher } from '../src/mapping/match.ts';
import { buildTable } from '../src/mapping/table.ts';
import { collectUsage } from '../src/mapping/usage.ts';
import { buildSpec } from '../src/spec/build.ts';
import { ConflictRegistry } from '../src/spec/conflicts.ts';
import { groupFlows } from '../src/spec/flows.ts';
import { renderSpec } from '../src/spec/render.ts';
import { buildTree, type TreeContext } from '../src/spec/tree.ts';

const tokens = buildTokens(
  applyDeclarations(
    parseThemeDeclarations(
      `@theme {
        --color-white: #fff;
        --color-gray-50: #f9fafb;
        --color-gray-200: #e5e7eb;
        --color-ink-900: #1e2430;
        --color-bg: var(--color-white);
        --color-fg: var(--color-ink-900);
        --color-card-fg: var(--color-ink-900);
        --color-foreground: var(--color-fg);
        --color-border: var(--color-gray-200);
        --color-input: var(--color-gray-200);
        --color-muted: var(--color-gray-200);
        --color-secondary: var(--color-gray-200);
        --font-display: Lexend;
        --text-h6: 1.25rem;
        --font-weight-bold: 700;
        --leading-tight: 1.25;
        --leading-normal: 1.5;
        --radius-md: 0.375rem;
        --spacing: 0.25rem;
      }`,
      'project',
    ),
  ),
  { rootPx: 16, fontFamilies: {} },
);
const variants = typographyVariants(
  'Heading',
  { base: 'font-display font-bold leading-tight', variants: { level: { '6': 'text-h6' } }, defaults: {} },
  indexTokens(tokens),
  16,
);
const catalogue: Catalogue = { tokens, typography: variants, protectedPaths: [] };

function context(previous = new ConflictRegistry()): TreeContext {
  return {
    colors: new ColorMatcher(tokens),
    text: new TextMatcher(variants, tokens),
    shadows: new ShadowMatcher(tokens),
    tokens,
    unitPx: 4,
    conflicts: previous,
    definitions: new Map(),
    components: new Map([
      [
        'k-btn',
        {
          name: 'Action',
          key: 'k-btn',
          remote: true,
          count: 1,
          examples: [],
          variants: {},
          kind: 'mapped',
          code: 'src/ui/Button.tsx#Button',
          suggestions: [],
        },
      ],
    ]),
    map: new Map([
      [
        'k-btn',
        {
          key: 'k-btn',
          name: 'Action',
          code: 'src/ui/Button.tsx#Button',
          decided: '2026-01-01',
          props: { 'Emphasis=Primary': 'variant="primary"' },
        },
      ],
    ]),
  };
}

const box = (w = 100, h = 100) => ({ x: 0, y: 0, w, h });
const text = (id: string, characters: string, lineHeightPx: number): DesignNode => ({
  id,
  name: characters,
  type: 'TEXT',
  box: box(),
  fills: [{ kind: 'solid', hex: '#1e2430' }],
  text: { characters, family: 'Lexend', sizePx: 20, weight: 700, lineHeightPx, mixed: false },
});

const drawer: DesignNode = {
  id: '1:1',
  name: 'Drawer',
  type: 'FRAME',
  box: box(880, 600),
  layout: { direction: 'column', gap: 16, padding: [24, 24, 24, 24], wrap: false },
  fills: [{ kind: 'solid', hex: '#ffffff' }],
  strokes: [{ kind: 'solid', hex: '#e5e7eb' }],
  strokeWeight: 1,
  radius: 6,
  children: [
    { id: '1:2', name: 'Wrapper', type: 'FRAME', box: box(), children: [text('1:3', 'Exact title', 25)] },
    text('1:4', 'Taller title', 30),
    {
      id: '1:5',
      name: 'Row',
      type: 'FRAME',
      box: box(800, 40),
      sizing: { w: 'fill', h: 'fixed' },
      layout: { direction: 'row', gap: 7, padding: [0, 0, 0, 0], wrap: false, mainAlign: 'space_between', crossAlign: 'center' },
      fills: [{ kind: 'solid', hex: '#e5e7eb' }],
      children: [
        {
          id: '1:6',
          name: 'lucide/chevron-down',
          type: 'FRAME',
          box: box(16, 16),
          sizing: { w: 'fixed', h: 'fixed' },
          children: [{ id: '1:7', name: 'Vector', type: 'VECTOR', box: box() }],
        },
        {
          id: '1:8',
          name: 'Action',
          type: 'INSTANCE',
          box: box(120, 40),
          sizing: { w: 'fill', h: 'hug' },
          component: {
            name: 'Action',
            key: 'k-btn',
            remote: true,
            variant: { Emphasis: 'Primary' },
            properties: { trailingIcon: '4093:82', label: 'Next' },
          },
          children: [text('1:9', 'Next', 25)],
        },
      ],
    },
  ],
};

test('buildTree turns a frame into markup, typography, components and icons, with conflicts for what the code lacks', () => {
  const ctx = context();
  const tree = buildTree(ctx, drawer);
  assert.deepEqual(tree.classes, ['flex', 'flex-col', 'gap-4', 'p-6', 'items-start', 'bg-bg', 'border', 'border-border', 'rounded-md']);
  const [exact, taller, row] = tree.children ?? [];
  assert.deepEqual(
    [exact?.kind, exact?.code, exact?.classes],
    ['text', 'Heading level=6', ['text-fg']],
    'the empty wrapper is left out and the exact variant is used',
  );
  assert.equal(taller?.code, 'Heading level=6', 'a near variant is the default');
  assert.equal(taller?.conflicts?.length, 1);
  assert.deepEqual(
    row?.classes,
    ['flex', 'justify-between', 'items-center', 'w-full', 'h-10', 'bg-gray-200'],
    'space-between drops the gap; an ambiguous fill keeps the palette name',
  );
  const [icon, action] = row?.children ?? [];
  assert.deepEqual([icon?.kind, icon?.code, icon?.classes], ['icon', 'lucide-react#ChevronDown', ['w-4', 'h-4']]);
  assert.deepEqual(
    [action?.code, action?.props, action?.classes, action?.texts],
    ['src/ui/Button.tsx#Button', { Emphasis: 'variant="primary"', label: 'Next' }, ['flex-1'], ['Next']],
  );
  const [k] = ctx.conflicts.list();
  assert.deepEqual(
    [k?.id, k?.kind, k?.nearest, k?.override, k?.outcome],
    ['K1', 'text', 'Heading level=6', 'font-display text-h6 font-bold leading-normal', 'nearest'],
  );
});

test('decisions carry over by key: a local override switches the tree to the exact classes', () => {
  const first = new ConflictRegistry();
  buildTree(context(first), drawer);
  const decided = first.list().map((c) => ({ ...c, outcome: 'local-override' as const, decidedBy: 'Sam', decided: '2026-01-02' }));
  const again = new ConflictRegistry(decided);
  const tree = buildTree(context(again), drawer);
  assert.deepEqual(tree.children?.[1]?.classes, ['font-display', 'text-h6', 'font-bold', 'leading-normal', 'text-fg']);
  assert.equal(tree.children?.[1]?.code, undefined);
  assert.deepEqual(
    again.list().map((c) => [c.id, c.outcome, c.decidedBy]),
    [['K1', 'local-override', 'Sam']],
  );
  const later = new ConflictRegistry([{ ...decided[0], id: 'K7' } as never]);
  later.add({ kind: 'spacing', key: 'spacing:7', design: '7px', nearest: 'gap-2' }, 'x');
  assert.deepEqual(
    later.list().map((c) => [c.id, c.uses, c.outcome]),
    [
      ['K7', 0, 'local-override'],
      ['K8', 1, 'nearest'],
    ],
    'an earlier conflict this run did not meet is kept with its decision; new ones continue after the highest id',
  );
});

function paintedNode(id: string, fills: string, strokes?: string): DesignNode {
  return {
    id,
    name: id,
    type: 'FRAME',
    box: box(),
    fills: [{ kind: 'solid', hex: fills }],
    ...(strokes ? { strokes: [{ kind: 'solid' as const, hex: strokes }] } : {}),
  };
}

test('colours pick the semantic alias the role makes unambiguous, and missing colours become conflicts', () => {
  const ctx = context();
  assert.deepEqual(buildTree(ctx, paintedNode('a', '#f9fafb', '#e5e7eb')).classes, ['bg-gray-50', 'border', 'border-border']);
  assert.deepEqual(buildTree(ctx, paintedNode('b', '#1e243080')).classes, ['bg-ink-900/50']);
  assert.deepEqual(buildTree(ctx, paintedNode('c', '#ffffff00')).classes, ['bg-transparent']);
  const missing = buildTree(ctx, paintedNode('d', '#123456'));
  assert.equal(missing.classes[0], 'bg-ink-900');
  assert.deepEqual(
    ctx.conflicts.list().map((c) => [c.kind, c.override]),
    [['colour', 'bg-[#123456]']],
  );
});

const frame = (id: string, name: string, x: number, y: number): FrameRef => ({
  id,
  name,
  kind: 'frame',
  sections: ['Final'],
  w: 400,
  h: 300,
  canvas: { x, y, w: 400, h: 300 },
});
const label = (id: string, words: string, x: number, y: number): SkippedItem => ({
  id,
  name: id,
  type: 'FRAME',
  reason: 'label',
  sections: ['Final'],
  canvas: { x, y, w: 300, h: 50 },
  text: words,
});

test('groupFlows splits sections by divider lines, names flows by their top label and states by the label above them', () => {
  const items = [
    frame('f1', 'Page', 0, 100),
    frame('f2', 'Page', 500, 100),
    frame('f3', 'Dialog', 0, 2200),
    frame('f4', 'Dialog', 500, 2200),
  ];
  const skipped: SkippedItem[] = [
    label('h1', 'ORDER LIST', -400, 0),
    label('h2', 'REFUND LIST', -400, 1950),
    {
      id: 'line',
      name: 'Line',
      type: 'LINE',
      reason: 'connector or divider',
      sections: ['Final'],
      canvas: { x: -500, y: 1900, w: 5000, h: 0 },
    },
    label('l1', 'LIVE SCREENS', 0, 1990),
    label('l2', 'VARIANT B', 0, 2100),
    label('l3', 'NEW', 500, 2100),
  ];
  const flows = groupFlows(items, skipped);
  assert.deepEqual(
    flows.map((f) => [f.name, f.states.map((s) => [s.frame.id, s.label ?? '', s.role])]),
    [
      [
        'Final / ORDER LIST',
        [
          ['f1', '', 'design'],
          ['f2', '', 'design'],
        ],
      ],
      [
        'Final / REFUND LIST',
        [
          ['f3', 'VARIANT B', 'reference'],
          ['f4', 'NEW', 'design'],
        ],
      ],
    ],
  );
  const noCanvas = groupFlows([{ ...frame('g1', 'Old page', 0, 0), canvas: undefined } as unknown as FrameRef], []);
  assert.deepEqual(
    noCanvas.map((f) => [f.name, f.states[0]?.role, f.states[0]?.nameLooksLikeReference]),
    [['Final / Old page', 'design', true]],
    'a name alone asks instead of deciding',
  );
});

test('buildSpec assembles flows, notes, questions and gaps; files round-trip through decide', () => {
  const snapshot: DesignSnapshot = {
    file: { fileKey: 'Key', name: 'Checkout', version: '7', lastModified: '' },
    root: { id: '0:1', name: 'Page', type: 'CANVAS' },
    items: [{ id: '1:1', name: 'Drawer', kind: 'frame', sections: ['Final'], w: 880, h: 600 }],
    skipped: [],
    frames: { '1:1': drawer },
    hiddenNodes: 0,
    comments: [
      { id: 'c1', message: 'Use the  new   button', resolved: false, createdAt: '', nodeId: '1:8', frameId: '1:1' },
      { id: 'c2', message: 'Overall: shorter copy', resolved: false, createdAt: '', nodeId: '0:1' },
    ],
  };
  const usage = collectUsage(snapshot);
  const table = buildTable(usage, catalogue, matchComponents(usage.components, [], [], { lucide: new Set(), local: [] }));
  const spec = buildSpec({ repo: 'web', snapshot, catalogue, table, map: [], generated: '2026-01-01' });
  assert.equal(spec.screens[0]?.name, 'Final / Drawer');
  assert.deepEqual(spec.screens[0]?.states[0]?.notes, ['Use the  new   button']);
  assert.deepEqual(spec.questions, [
    'Final / Drawer: the design has no empty, loading or error state. What should each show?',
    'Map component "Action" (x1, key k-btn): no suggestion; new markup?',
    'Final / Drawer / Drawer: designer comment: Use the new button',
    'Open designer comment: Overall: shorter copy',
  ]);
  const md = renderSpec(spec);
  assert.match(md, /^# UI spec: Page/);
  assert.match(md, /text Heading level=6 {2}text-fg {2}"Exact title"/);
  assert.match(md, /<Action> \(unmapped, see Components to build\) {2}Emphasis=Primary label=Next {2}flex-1 {2}"Next"/);
  assert.match(md, /\| K1 \| text \| Lexend 20\/30 700 \| 1 \| `Heading level=6` \|/);

  const dir = mkdtempSync(path.join(os.tmpdir(), 'figma-ui-spec-spec-'));
  try {
    const file = path.join(dir, 'drawer.json');
    writeSpec(file, spec);
    assert.deepEqual(readSpec(file), spec);
    decide(file, 'K1', 'new-variant', 'Sam', '2026-01-03');
    assert.match(readFileSync(path.join(dir, 'drawer.md'), 'utf8'), /new-variant \(Sam, 2026-01-03\)/);
    assert.throws(() => decide(file, 'K9', 'nearest', 'Sam', ''), /has no conflict K9/);
    assert.equal(readSpec(path.join(dir, 'none.json'), { optional: true }), undefined);

    const gaps = path.join(dir, 'gaps.md');
    assert.equal(appendGaps(gaps, ['a', 'b'], 'Checkout'), 2);
    assert.equal(appendGaps(gaps, ['b', 'c'], 'Checkout'), 1);
    assert.equal(readFileSync(gaps, 'utf8').match(/^- /gm)?.length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('review fixes: side borders, corner radii, shapes, unmapped definitions, decide guard, foreign specs', () => {
  const ctx = context();
  const sided: DesignNode = {
    id: 's1',
    name: 'Footer',
    type: 'FRAME',
    box: box(),
    strokes: [{ kind: 'solid', hex: '#e5e7eb' }],
    strokeSides: [1, 0, 0, 1],
    radius: [0, 0, 16, 16],
    layout: { direction: 'column', gap: 0, padding: [0, 0, 0, 0], wrap: false },
    children: [
      {
        id: 's2',
        name: 'Line',
        type: 'LINE',
        box: { x: 0, y: 0, w: 100, h: 0 },
        sizing: { w: 'fill', h: 'fixed' },
        strokes: [{ kind: 'solid', hex: '#e5e7eb' }],
      },
      { id: 's3', name: 'Dot', type: 'ELLIPSE', box: box(4, 4), fills: [{ kind: 'solid', hex: '#1e2430' }] },
      { id: 's4', name: 'Path', type: 'VECTOR', box: box(10, 10), fills: [{ kind: 'solid', hex: '#1e2430' }] },
    ],
  };
  const tree = buildTree(ctx, sided);
  assert.deepEqual(
    tree.classes,
    ['flex', 'flex-col', 'items-start', 'border-t', 'border-l', 'border-border', 'rounded-b-md'],
    '16px is off the radius scale: nearest by default',
  );
  assert.deepEqual(
    tree.children?.map((c) => [c.kind, c.classes]),
    [
      ['box', ['w-full', 'h-0', 'border-t', 'border-border']],
      ['box', ['bg-ink-900', 'rounded-full']],
      ['vector', ['text-fg']],
    ],
  );
  assert.equal(ctx.conflicts.list().find((c) => c.kind === 'radius')?.nearest, 'rounded-b-md');

  const unmapped: DesignNode = {
    id: 'u1',
    name: 'Row',
    type: 'INSTANCE',
    box: box(),
    component: { name: 'Order row', key: 'local', remote: false, variant: {}, properties: {} },
    layout: { direction: 'row', gap: 8, padding: [0, 0, 0, 0], wrap: false },
    children: [text('u2', 'Label', 25), text('u3', 'Value', 25)],
  };
  buildTree(ctx, unmapped);
  buildTree(ctx, { ...unmapped, id: 'u4' });
  assert.deepEqual([...ctx.definitions.keys()], ['name:Order row|'], 'one definition per component');
  assert.deepEqual(ctx.definitions.get('name:Order row|')?.tree.classes, ['flex', 'gap-2', 'items-start']);

  const dir = mkdtempSync(path.join(os.tmpdir(), 'figma-ui-spec-guard-'));
  try {
    const file = path.join(dir, 's.json');
    const conflicts = [
      {
        id: 'K1',
        key: 'text:x',
        kind: 'text' as const,
        design: 'x',
        nearest: 'Heading level=6',
        uses: 1,
        examples: [],
        outcome: 'nearest' as const,
      },
    ];
    const spec = {
      format: 1 as const,
      generated: '',
      repo: 'web',
      source: { file: 'F', fileKey: 'K', version: '1', root: 'R', rootId: '0:1' },
      screens: [],
      components: [],
      definitions: [],
      conflicts,
      questions: [],
      gaps: [],
    };
    writeSpec(file, spec);
    assert.throws(() => decide(file, 'K1', 'local-override', 'Sam', ''), /K1 has no exact override/);
    assert.equal(previousFor(file, 'web', 'K', '0:1')?.repo, 'web');
    assert.throws(() => previousFor(file, 'web', 'K', '9:9'), /is a spec for F node 0:1 in web; use another --name or --out/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('review fixes, round 2: exact text overrides, text case and alignment, absolute children', () => {
  const ctx = context();
  const odd: DesignNode = {
    id: 'o1',
    name: 'Odd',
    type: 'TEXT',
    box: box(),
    text: {
      characters: 'Odd',
      family: 'Lexend',
      sizePx: 28,
      weight: 700,
      lineHeightPx: 33,
      mixed: false,
      textCase: 'upper',
      align: 'center',
    },
  };
  const t = buildTree(ctx, odd);
  assert.deepEqual(
    t.classes,
    ['font-display', 'text-h6', 'font-bold', 'leading-tight', 'uppercase', 'text-center'],
    'nearest tokens fill the missing size',
  );
  const k = ctx.conflicts.list()[0];
  assert.equal(k?.override, 'font-display text-[28px] font-bold leading-[33px]', 'the override is whole and exact');

  const page: DesignNode = {
    id: 'p1',
    name: 'Page',
    type: 'FRAME',
    box: { x: 0, y: 0, w: 400, h: 800 },
    layout: { direction: 'column', gap: 0, padding: [0, 0, 0, 0], wrap: false },
    children: [
      { id: 'p2', name: 'Body', type: 'FRAME', box: { x: 0, y: 0, w: 400, h: 800 }, fills: [{ kind: 'solid', hex: '#ffffff' }] },
      {
        id: 'p3',
        name: 'Overlay',
        type: 'FRAME',
        box: { x: 0, y: 0, w: 400, h: 800 },
        absolute: true,
        fills: [{ kind: 'solid', hex: '#1e243066' }],
      },
      {
        id: 'p4',
        name: 'Close',
        type: 'FRAME',
        box: { x: 360, y: 16, w: 24, h: 24 },
        absolute: true,
        fills: [{ kind: 'solid', hex: '#ffffff' }],
      },
    ],
  };
  const tree = buildTree(ctx, page);
  assert.deepEqual(tree.classes, ['relative', 'flex', 'flex-col', 'items-start']);
  assert.deepEqual(
    tree.children?.map((c) => c.classes),
    [['bg-bg'], ['absolute', 'inset-0', 'bg-ink-900/40'], ['absolute', 'top-4', 'right-4', 'w-6', 'h-6', 'bg-bg']],
  );
});

function pillInstance(id: string, emphasis: string): DesignNode {
  return {
    id,
    name: 'Action',
    type: 'INSTANCE',
    box: box(),
    component: { name: 'Pill', key: 'k-pill', remote: true, variant: { Emphasis: emphasis }, properties: {} },
    fills: [{ kind: 'solid', hex: emphasis === 'Primary' ? '#1e2430' : '#e5e7eb' }],
  };
}

test('review fixes, round 3: start alignment, variants defined apart, outside offsets, stroke-only paths', () => {
  const ctx = context();
  const column: DesignNode = {
    id: 'c1',
    name: 'Column',
    type: 'FRAME',
    box: { x: 0, y: 0, w: 300, h: 100 },
    layout: { direction: 'column', gap: 0, padding: [0, 0, 0, 0], wrap: false },
    children: [
      {
        id: 'c2',
        name: 'Tick',
        type: 'VECTOR',
        box: { x: 0, y: 0, w: 6, h: 4 },
        strokes: [{ kind: 'solid', hex: '#ffffff' }],
        strokeWeight: 2,
      },
      {
        id: 'c3',
        name: 'Badge',
        type: 'FRAME',
        box: { x: 280, y: -2, w: 24, h: 8 },
        absolute: true,
        fills: [{ kind: 'solid', hex: '#1e2430' }],
      },
    ],
  };
  const tree = buildTree(ctx, column);
  assert.ok(tree.classes.includes('items-start'), "Figma's default start alignment is written, not left to CSS stretch");
  assert.deepEqual(tree.children?.[0]?.classes, ['text-white', 'stroke-2'], 'bg is a fill alias, so text falls back to the palette name');
  assert.deepEqual(tree.children?.[1]?.classes, ['absolute', '-top-0.5', '-right-1', 'w-6', 'h-2', 'bg-ink-900']);

  for (const [id, emphasis] of [
    ['v1', 'Disabled'],
    ['v2', 'Primary'],
    ['v3', 'Disabled'],
  ] as const) {
    buildTree(ctx, pillInstance(id, emphasis));
  }
  assert.deepEqual(
    [...ctx.definitions.values()].map((d) => [d.variant, d.tree.classes]),
    [
      ['Emphasis=Disabled', ['bg-gray-200']],
      ['Emphasis=Primary', ['bg-ink-900']],
    ],
  );
});

test('review fixes, round 4: role names only, pills, text widths, free layers and vector assets', () => {
  const ctx = context();
  const greenish: DesignNode = {
    id: 'g1',
    name: 'Dot',
    type: 'FRAME',
    box: box(37, 37),
    radius: 19,
    fills: [{ kind: 'solid', hex: '#e5e7eb' }],
  };
  assert.deepEqual(
    buildTree(ctx, greenish).classes,
    ['bg-gray-200', 'rounded-full'],
    'muted/secondary are not the fill role name; a 19px radius on 37px is a pill',
  );
  assert.deepEqual(ctx.conflicts.list(), []);

  const free: DesignNode = {
    id: 'f1',
    name: 'Page',
    type: 'FRAME',
    box: { x: 0, y: 0, w: 400, h: 300 },
    children: [
      { id: 'f2', name: 'Shot', type: 'RECTANGLE', box: { x: 0, y: 0, w: 400, h: 300 }, fills: [{ kind: 'image' }] },
      {
        id: 'f3',
        name: 'Panel',
        type: 'FRAME',
        box: { x: 200, y: 0, w: 200, h: 300 },
        layout: { direction: 'column', gap: 0, padding: [0, 0, 0, 0], wrap: false },
        children: [{ ...text('f4', 'Wide', 25), sizing: { w: 'fill', h: 'hug' } }],
      },
      {
        id: 'f5',
        name: 'Logo',
        type: 'GROUP',
        box: { x: 8, y: 8, w: 40, h: 20 },
        children: [
          { id: 'f6', name: 'Vector', type: 'VECTOR', box: box() },
          { id: 'f7', name: 'Vector', type: 'VECTOR', box: box() },
        ],
      },
    ],
  };
  const tree = buildTree(ctx, free);
  assert.deepEqual(tree.classes, ['relative', 'w-100', 'h-75'], 'a free frame keeps its drawn size');
  assert.deepEqual(
    tree.children?.map((c) => [c.kind, c.classes]),
    [
      ['image', ['absolute', 'inset-0']],
      ['box', ['absolute', 'top-0', 'right-0', 'w-50', 'h-75', 'flex', 'flex-col', 'items-start']],
      ['vector', ['absolute', 'top-2', 'left-2', 'w-10', 'h-5', 'asset']],
    ],
  );
  assert.deepEqual(tree.children?.[1]?.children?.[0]?.classes, ['w-full', 'text-fg'], 'a fill-width text keeps its width');
});

test('review fixes, round 5: grids, and placed boxes that place their own children', () => {
  const ctx = context();
  const grid: DesignNode = {
    id: 'q1',
    name: 'Cards',
    type: 'FRAME',
    box: { x: 0, y: 0, w: 360, h: 300 },
    layout: { direction: 'grid', gap: 16, rowGap: 8, columns: 2, rows: 2, padding: [0, 0, 0, 0], wrap: false },
    children: [
      {
        id: 'q2',
        name: 'Wide',
        type: 'FRAME',
        box: box(),
        span: { columns: 2, rows: 1 },
        sizing: { w: 'fill', h: 'fill' },
        fills: [{ kind: 'solid', hex: '#f9fafb' }],
      },
      { id: 'q3', name: 'Cell', type: 'FRAME', box: box(), sizing: { w: 'fill', h: 'fill' }, fills: [{ kind: 'solid', hex: '#f9fafb' }] },
    ],
  };
  const tree = buildTree(ctx, grid);
  assert.deepEqual(tree.classes, ['grid', 'grid-cols-2', 'gap-x-4', 'gap-y-2']);
  assert.deepEqual(
    tree.children?.map((c) => c.classes),
    [
      ['col-span-2', 'w-full', 'h-full', 'bg-gray-50'],
      ['w-full', 'h-full', 'bg-gray-50'],
    ],
  );

  const nested: DesignNode = {
    id: 'n1',
    name: 'Bar',
    type: 'FRAME',
    box: { x: 0, y: 0, w: 200, h: 40 },
    layout: { direction: 'row', gap: 0, padding: [0, 0, 0, 0], wrap: false },
    children: [
      {
        id: 'n2',
        name: 'Tab',
        type: 'FRAME',
        box: { x: 2, y: 2, w: 80, h: 36 },
        absolute: true,
        layout: { direction: 'row', gap: 0, padding: [0, 0, 0, 0], wrap: false },
        children: [
          {
            id: 'n3',
            name: 'Mark',
            type: 'FRAME',
            box: { x: 2, y: 36, w: 80, h: 2 },
            absolute: true,
            fills: [{ kind: 'solid', hex: '#1e2430' }],
          },
        ],
      },
    ],
  };
  const tab = buildTree(ctx, nested).children?.[0];
  assert.deepEqual(tab?.classes.slice(0, 2), ['absolute', 'top-0.5'], 'absolute, never also relative');
  assert.ok(!tab?.classes.includes('relative'));
});
