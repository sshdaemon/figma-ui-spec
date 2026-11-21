import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ComponentMapError, readComponentMap, saveMapping } from '../src/adapters/fs/component-map.ts';
import { ComponentScanError, scanComponents, scanIconNames } from '../src/adapters/ts/component-scan.ts';
import type { DesignNode, DesignSnapshot } from '../src/design/types.ts';
import { dice, mapKeyOf, matchComponents, toKebab } from '../src/mapping/components.ts';
import { buildTable } from '../src/mapping/table.ts';
import { collectUsage, type ComponentUsage } from '../src/mapping/usage.ts';

const fixture = path.join(import.meta.dirname, '../fixtures/tailwind-v4');

const box = (w = 100, h = 100) => ({ x: 0, y: 0, w, h });

function snapshotOf(...frames: DesignNode[]): DesignSnapshot {
  return {
    file: { fileKey: 'K', name: 'F', version: '1', lastModified: '' },
    root: { id: '0:1', name: 'Page', type: 'CANVAS' },
    items: [],
    skipped: [],
    frames: Object.fromEntries(frames.map((f) => [f.id, f])),
    hiddenNodes: 0,
    comments: [],
  };
}

test('collectUsage groups styled and raw values, counts instances once, and skips component-set chrome', () => {
  const frame: DesignNode = {
    id: '1:1',
    name: 'Screen',
    type: 'FRAME',
    box: box(),
    layout: { direction: 'column', gap: 16, padding: [24, 24, 24, 24], wrap: false },
    fills: [{ kind: 'solid', hex: '#ffffff' }],
    styles: { fill: 'White' },
    radius: [4, 4, 0, 0],
    children: [
      {
        id: '1:2',
        name: 'Title',
        type: 'TEXT',
        box: box(),
        text: { characters: 'Hi', family: 'Lexend', sizePx: 20, weight: 700, lineHeightPx: 30, mixed: false },
        styles: { text: 'Heading/Small' },
      },
      {
        id: '1:3',
        name: 'Checkbox',
        type: 'INSTANCE',
        box: box(20, 20),
        component: { name: 'Checkbox', key: 'cb', remote: true, variant: { State: 'Default' }, properties: {} },
        fills: [{ kind: 'solid', hex: '#123456' }],
        children: [{ id: '1:4', name: 'mark', type: 'VECTOR', box: box(), fills: [{ kind: 'solid', hex: '#abcdef' }] }],
      },
      {
        id: '1:5',
        name: 'Checkbox',
        type: 'INSTANCE',
        box: box(24, 24),
        component: { name: 'Checkbox', key: 'cb', remote: true, variant: { State: 'Checked' }, properties: {} },
      },
      { id: '1:6', name: 'Set', type: 'COMPONENT_SET', box: box(), strokes: [{ kind: 'solid', hex: '#9747ff' }] },
      {
        id: '1:7',
        name: 'Row',
        type: 'FRAME',
        box: box(),
        layout: { direction: 'row', gap: 8, padding: [0, 0, 0, 0], wrap: false },
        children: [],
      },
    ],
  };
  const u = collectUsage(snapshotOf(frame));
  assert.deepEqual(
    u.colorStyles.map((s) => [s.name, s.values.map((v) => v.value)]),
    [['White', ['#ffffff']]],
  );
  assert.deepEqual(
    u.rawColors.map((c) => c.value),
    ['#123456'],
    'the instance fill counts, its insides and the set outline do not',
  );
  assert.deepEqual(u.textStyles[0]?.values[0]?.value, {
    family: 'Lexend',
    sizePx: 20,
    weight: 700,
    lineHeightPx: 30,
    letterSpacingPx: 0,
  });
  assert.deepEqual(
    u.gaps.map((g) => g.value),
    [16],
    'a gap with fewer than two children does nothing',
  );
  assert.deepEqual(
    u.paddings.map((p) => [p.value, p.count]),
    [[24, 1]],
  );
  assert.deepEqual(
    u.radii.map((r) => r.value),
    [4],
  );
  assert.deepEqual(u.components, [
    {
      name: 'Checkbox',
      key: 'cb',
      remote: true,
      count: 2,
      examples: ['1:3', '1:5'],
      variants: { State: ['Default', 'Checked'] },
      maxW: 24,
      maxH: 24,
    },
  ]);
});

const usage = (name: string, w: number, extra: Partial<ComponentUsage> = {}): ComponentUsage => ({
  name,
  key: `k-${name}`,
  remote: true,
  count: 1,
  examples: [],
  variants: {},
  maxW: w,
  maxH: w,
  ...extra,
});

test('matchComponents: saved mappings first, small lower-case components are icons, the rest get name suggestions', () => {
  const code = [
    { name: 'Checkbox', file: 'src/ui/checkbox/Checkbox.tsx' },
    { name: 'CheckboxGroup', file: 'src/ui/checkbox/CheckboxGroup.tsx' },
    { name: 'Badge', file: 'src/ui/badge.tsx' },
  ];
  const rows = matchComponents(
    [usage('Badge', 80), usage('Checkbox', 20), usage('chevron-down', 20), usage('Totally different', 300), usage('Action', 40)],
    [{ key: 'k-Badge', name: 'Badge', code: 'src/ui/badge.tsx#Badge', decided: '2026-01-01' }],
    code,
    { lucide: new Set(['chevron-down']), local: [{ name: 'ChevronDownBold', file: 'src/icons/ChevronDownBold.tsx' }] },
  );
  assert.deepEqual(
    rows.map((r) => [r.name, r.kind, r.code ?? r.suggestions.join(' ')]),
    [
      ['Badge', 'mapped', 'src/ui/badge.tsx#Badge'],
      ['Checkbox', 'unmapped', 'src/ui/checkbox/Checkbox.tsx#Checkbox src/ui/checkbox/CheckboxGroup.tsx#CheckboxGroup'],
      ['chevron-down', 'icon', 'lucide-react#ChevronDown src/icons/ChevronDownBold.tsx#ChevronDownBold'],
      ['Totally different', 'unmapped', ''],
      ['Action', 'unmapped', ''],
    ],
  );
  assert.ok(dice('checkbox', 'checkbx') > 0.7, 'a typo still matches');
  assert.equal(dice('act', 'button'), 0);
  assert.equal(toKebab('ChevronDown 2'), 'chevron-down-2');
});

test('scanComponents finds named, default and re-exported PascalCase components and skips tests', () => {
  assert.deepEqual(scanComponents(fixture, ['src/ui']), [
    { name: 'Button', file: 'src/ui/Button.tsx' },
    { name: 'IconButton', file: 'src/ui/Button.tsx' },
    { name: 'Pill', file: 'src/ui/Button.tsx' },
  ]);
  assert.throws(
    () => scanIconNames(path.join(fixture, 'missing')),
    (err) => err instanceof ComponentScanError && /check components\.lucide/.test(err.message),
  );
});

test('the component map is validated, replaces by key, and stays sorted', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'figma-ui-spec-map-'));
  try {
    const file = path.join(dir, 'component-map.json');
    assert.deepEqual(readComponentMap(file), []);
    saveMapping(file, { key: 'b', name: 'Button', code: 'src/ui/Button.tsx#Button', decided: '2026-01-01' });
    saveMapping(file, { key: 'a', name: 'Alert', code: 'src/ui/Alert.tsx#Alert', decided: '2026-01-01' });
    const entries = saveMapping(file, { key: 'b', name: 'Button', code: 'src/ui/Button.tsx#IconButton', decided: '2026-01-02' });
    assert.deepEqual(
      entries.map((e) => [e.name, e.code]),
      [
        ['Alert', 'src/ui/Alert.tsx#Alert'],
        ['Button', 'src/ui/Button.tsx#IconButton'],
      ],
    );
    assert.match(readFileSync(file, 'utf8'), /^\{\n {2}"entries"/);
    writeFileSync(file, '{"entries":[{"key":"x"}]}');
    assert.throws(
      () => readComponentMap(file),
      (err) => err instanceof ComponentMapError && /entries\[0\]\.name/.test(err.message),
    );
    writeFileSync(file, '{"entries":[null]}');
    assert.throws(() => readComponentMap(file), /entries\[0\] must be an object/);
    writeFileSync(file, 'null');
    assert.throws(
      () => readComponentMap(file),
      (err) => err instanceof ComponentMapError,
    );
    writeFileSync(file, '[]');
    assert.throws(() => readComponentMap(file), /expected \{ "entries"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildTable lists each group with its match', () => {
  const frame: DesignNode = {
    id: '1:1',
    name: 'Screen',
    type: 'FRAME',
    box: box(),
    layout: { direction: 'column', gap: 7, padding: [0, 0, 0, 0], wrap: false },
    fills: [{ kind: 'solid', hex: '#ffffff' }],
    children: [
      { id: '1:2', name: 'a', type: 'FRAME', box: box() },
      { id: '1:3', name: 'b', type: 'FRAME', box: box() },
    ],
  };
  const catalogue = {
    tokens: [
      { name: 'color-white', kind: 'color' as const, key: 'white', raw: '#fff', value: '#fff', via: [], origin: 'project' as const },
      { name: 'spacing', kind: 'spacing' as const, key: '', raw: '0.25rem', value: '0.25rem', via: [], px: 4, origin: 'base' as const },
    ],
    typography: [],
    protectedPaths: [],
  };
  const table = buildTable(collectUsage(snapshotOf(frame)), catalogue, []);
  assert.deepEqual(
    table.rows.map((r) => [r.group, r.value, r.match.status, r.match.code]),
    [
      ['colour', '#ffffff', 'same', 'white'],
      ['gap', '7px', 'off-scale', 'gap-[7px]'],
    ],
  );
});

test('review fixes: local components map by name, space-between gaps are ignored, missing folders say so', () => {
  const local = usage('Order-row', 600, { remote: false, key: 'file-local-key' });
  assert.equal(mapKeyOf(local), 'name:Order-row');
  assert.equal(mapKeyOf(usage('Badge', 80)), 'k-Badge');
  const rows = matchComponents(
    [local],
    [{ key: 'name:Order-row', name: 'Order-row', code: 'src/ui/Row.tsx#Row', decided: '2026-01-01' }],
    [],
    {
      lucide: new Set(),
      local: [],
    },
  );
  assert.deepEqual(
    rows.map((r) => [r.key, r.kind, r.code]),
    [['name:Order-row', 'mapped', 'src/ui/Row.tsx#Row']],
  );

  const frame: DesignNode = {
    id: '1:1',
    name: 'Bar',
    type: 'FRAME',
    box: box(),
    layout: { direction: 'row', gap: 13, padding: [0, 0, 0, 0], wrap: false, mainAlign: 'space_between' },
    children: [
      { id: '1:2', name: 'a', type: 'FRAME', box: box() },
      { id: '1:3', name: 'b', type: 'FRAME', box: box() },
    ],
  };
  assert.deepEqual(collectUsage(snapshotOf(frame)).gaps, []);

  assert.throws(
    () => scanComponents(fixture, ['src/nope']),
    (err) => err instanceof ComponentScanError && /src\/nope does not exist/.test(err.message),
  );
});

test('component map entries may carry props, which must be strings', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'figma-ui-spec-props-'));
  try {
    const file = path.join(dir, 'component-map.json');
    const entry = { key: 'k', name: 'Action', code: 'src/ui/Button.tsx#Button', decided: '2026-01-01' };
    writeFileSync(file, JSON.stringify({ entries: [{ ...entry, props: { 'Emphasis=Primary': 'variant="primary"' } }] }));
    assert.deepEqual(readComponentMap(file)[0]?.props, { 'Emphasis=Primary': 'variant="primary"' });
    writeFileSync(file, JSON.stringify({ entries: [{ ...entry, props: { 'Emphasis=Primary': 1 } }] }));
    assert.throws(() => readComponentMap(file), /entries\[0\]\.props must map property values to strings/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
