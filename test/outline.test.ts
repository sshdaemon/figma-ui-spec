import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FigmaNode } from '../src/design/figma-json.ts';
import { cutOff, graft, outline } from '../src/design/outline.ts';
import { cutAt, node, samplePage } from './figma-builders.ts';

test('outline keeps design frames and components and says why everything else was skipped', () => {
  const { items, skipped } = outline(samplePage());
  assert.deepEqual(
    items.map((i) => [i.id, i.kind, i.sections.join(' / '), i.w, i.h]),
    [
      ['2:1', 'frame', 'Final', 1280, 900],
      ['2:2', 'frame', 'Final', 1280, 900],
      ['2:9', 'frame', 'Final', 300, 400],
      ['2:12', 'frame', 'Final / Icons', 24, 24],
      ['2:15', 'frame', 'Final / Icons / Old icons', 24, 24],
      ['2:13', 'component', 'Components', 100, 100],
      ['2:14', 'component', 'Components', 100, 100],
    ],
  );
  assert.deepEqual(
    skipped.map((s) => [s.id, s.reason]),
    [
      ['2:3', 'pasted image'],
      ['2:4', 'connector or divider'],
      ['2:5', 'connector or divider'],
      ['2:6', 'outline shape'],
      ['2:7', 'not a frame (rectangle)'],
      ['2:8', 'label'],
      ['2:10', 'note'],
      ['2:11', 'hidden'],
      ['2:16', 'label'],
    ],
  );
});

test('a project rule can skip a whole section', () => {
  const { items, skipped } = outline(samplePage(), [{ type: 'SECTION', name: '^Icons$', reason: 'graphics' }]);
  assert.ok(!items.some((i) => i.id === '2:12' || i.id === '2:15'));
  assert.deepEqual(
    skipped.find((s) => s.id === '1:2'),
    { id: '1:2', name: 'Icons', type: 'SECTION', reason: 'graphics', sections: ['Final'] },
  );
});

test('cutOff finds sections and section children a depth-limited read cut off, and graft fills them in', () => {
  const page = samplePage();
  const cut = cutAt(page, 3);
  assert.deepEqual(cutOff(cut, 3), ['2:12', '1:4']);
  const read = new Map(['2:12', '1:4'].map((id) => [id, cutAt(find(page, id), 2)]));
  const full = graft(cut, read);
  assert.deepEqual(cutOff(full, 5), []);
  assert.deepEqual(
    outline(full).items.map((i) => i.id),
    outline(page).items.map((i) => i.id),
  );
  assert.deepEqual(
    outline(cut)
      .items.map((i) => i.id)
      .includes('2:15'),
    false,
    'without the extra read the nested frame is missing',
  );
});

function find(n: FigmaNode, id: string): FigmaNode {
  const found = findIn(n, id);
  if (!found) throw new Error(`no ${id}`);
  return found;
}

function findIn(n: FigmaNode, id: string): FigmaNode | undefined {
  if (n.id === id) return n;
  for (const c of n.children ?? []) {
    const found = findIn(c, id);
    if (found) return found;
  }
  return undefined;
}

test('project rules come before the built-in ones', () => {
  const { items, skipped } = outline(samplePage(), [
    { name: '^Cart page empty$', reason: 'superseded' },
    { type: 'COMPONENT_SET', reason: 'library copy' },
  ]);
  assert.ok(!items.some((i) => i.id === '2:2' || i.id === '2:14'));
  assert.deepEqual(
    skipped.filter((s) => s.reason === 'superseded' || s.reason === 'library copy').map((s) => s.id),
    ['2:2', '2:14'],
  );
});

test('a frame or section root reads as itself', () => {
  assert.deepEqual(
    outline(node('FRAME', '9:1', 'Modal')).items.map((i) => [i.id, i.sections]),
    [['9:1', []]],
  );
  const section = node('SECTION', '9:2', 'Final', { children: [node('FRAME', '9:3', 'Screen')] });
  assert.deepEqual(
    outline(section).items.map((i) => [i.id, i.sections]),
    [['9:3', ['Final']]],
  );
});
