import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { FsDesignCache } from '../src/adapters/fs/design-cache.ts';
import type { FigmaComment, FigmaNode, FigmaNodesResponse } from '../src/design/figma-json.ts';
import { DesignReadError, readDesign } from '../src/design/read.ts';
import type { DesignCache } from '../src/ports/design-cache.ts';
import type { FigmaApi } from '../src/ports/figma-api.ts';
import { cutAt, entry, samplePage } from './figma-builders.ts';

function memoryCache(): DesignCache {
  const store = new Map<string, unknown>();
  return { get: (k, v, n) => store.get(`${k}/${v}/${n}`), put: (k, v, n, value) => void store.set(`${k}/${v}/${n}`, value) };
}

function fakeApi(page: FigmaNode, comments: FigmaComment[] = [], version = 'v1') {
  const byId = new Map<string, FigmaNode>();
  const index = (n: FigmaNode): void => {
    byId.set(n.id, n);
    for (const c of n.children ?? []) index(c);
  };
  index(page);
  const calls: { ids: readonly string[]; depth?: number }[] = [];
  const api: FigmaApi = {
    fileMeta: async () => ({ name: 'Checkout', version, lastModified: '2026-01-01T00:00:00Z' }),
    nodes: async (_key, ids, depth) => {
      calls.push({ ids, ...(depth === undefined ? {} : { depth }) });
      const read = (id: string) => (depth === undefined ? (byId.get(id) as FigmaNode) : cutAt(byId.get(id) as FigmaNode, depth));
      const nodes: FigmaNodesResponse['nodes'] = Object.fromEntries(ids.map((id) => [id, byId.has(id) ? entry(read(id)) : null]));
      return { name: 'Checkout', version, lastModified: '', nodes };
    },
    comments: async () => comments,
  };
  return { api, calls };
}

const target = { fileKey: 'AbCdEfGhIjKlMn', nodeId: '0:1' };

test('readDesign reads the outline once at depth 3, then the frames in batches, and caches per version', async () => {
  const { api, calls } = fakeApi(samplePage());
  const cache = memoryCache();
  const first = await readDesign(api, cache, target, { batchSize: 4 });
  assert.deepEqual(calls[0], { ids: ['0:1'], depth: 3 });
  assert.deepEqual(calls[1], { ids: ['2:12', '1:4'], depth: 2 }, 'the nested section the depth cut off is read in a second outline call');
  assert.deepEqual(calls.slice(2).map((c) => c.ids), [['2:1', '2:2', '2:9', '2:12'], ['2:15', '2:13', '2:14']]);
  assert.deepEqual(first.stats.calls, { meta: 1, outline: 2, nodes: 2, comments: 1 });
  assert.deepEqual(Object.keys(first.snapshot.frames), ['2:1', '2:2', '2:9', '2:12', '2:15', '2:13', '2:14']);
  assert.equal(first.snapshot.root.name, 'Checkout');
  assert.deepEqual(first.snapshot.skipped.at(-1), { id: '2:16', name: 'Frame 2', type: 'FRAME', reason: 'label', sections: ['Final', 'Icons', 'Old icons'] });

  const again = await readDesign(api, cache, target, { batchSize: 4 });
  assert.equal(calls.length, 4, 'nothing re-read for the same version');
  assert.deepEqual(again.stats.calls, { meta: 1, outline: 0, nodes: 0, comments: 1 });
  assert.equal(again.stats.cachedFrames, 7);

  const changed = fakeApi(samplePage(), [], 'v2');
  await readDesign(changed.api, cache, target);
  assert.equal(changed.calls.length, 4, 'a new version reads again');
});

test('readDesign reads only the frames asked for, and says when a node is missing', async () => {
  const { api, calls } = fakeApi(samplePage());
  const { snapshot } = await readDesign(api, memoryCache(), target, { frames: ['2:2'] });
  assert.deepEqual(Object.keys(snapshot.frames), ['2:2']);
  assert.deepEqual(calls.at(-1)?.ids, ['2:2']);
  await assert.rejects(readDesign(api, memoryCache(), target, { frames: ['9:9'] }), (err) => err instanceof DesignReadError && /frame 9:9/.test(err.message));
  await assert.rejects(readDesign(api, memoryCache(), { ...target, nodeId: '7:7' }), /node 7:7 is not in file/);
  await assert.rejects(readDesign(api, memoryCache(), { fileKey: 'AbCdEfGhIjKlMn' }), /needs a node-id/);
});

test('readDesign keeps comments pinned under the root, with the frame they sit in; replies follow their parent', async () => {
  const comments: FigmaComment[] = [
    { id: 'c1', message: 'Drop this export', created_at: '2026-01-02', client_meta: { node_id: '3:1' } },
    { id: 'c2', message: 'Done', created_at: '2026-01-03', parent_id: 'c1', resolved_at: '2026-01-04' },
    { id: 'c3', message: 'On the section', created_at: '2026-01-02', client_meta: { node_id: '1:1' } },
    { id: 'c4', message: 'Elsewhere', created_at: '2026-01-02', client_meta: { node_id: '99:1' } },
    { id: 'c5', message: 'Unpinned', created_at: '2026-01-02', client_meta: null },
  ];
  const { api } = fakeApi(samplePage(), comments);
  const { snapshot } = await readDesign(api, memoryCache(), target);
  assert.deepEqual(
    snapshot.comments.map((c) => [c.id, c.nodeId, c.frameId, c.resolved, c.parentId]),
    [
      ['c1', '3:1', '2:1', false, undefined],
      ['c2', '3:1', '2:1', true, 'c1'],
      ['c3', '1:1', undefined, false, undefined],
    ],
  );
});

test('FsDesignCache keeps each version apart and survives odd characters in names', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'figma-ui-spec-cache-'));
  try {
    const cache = new FsDesignCache(dir);
    cache.put('Key1', '100', 'node-1:2', { a: 1 });
    assert.deepEqual(cache.get('Key1', '100', 'node-1:2'), { a: 1 });
    assert.equal(cache.get('Key1', '101', 'node-1:2'), undefined);
    assert.equal(cache.get('../Key1', '100', 'node-1:2'), undefined);
    writeFileSync(path.join(dir, 'Key1', '100', 'node-1_2.json'), '{"cut off');
    assert.equal(cache.get('Key1', '100', 'node-1:2'), undefined, 'a half-written file is a miss');
    cache.put('Key1', '100', 'node-1:2', { a: 2 });
    assert.deepEqual(cache.get('Key1', '100', 'node-1:2'), { a: 2 });
    assert.deepEqual(readdirSync(path.join(dir, 'Key1', '100')), ['node-1_2.json'], 'no temporary file left behind');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
