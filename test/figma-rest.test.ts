import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FigmaApiError, FigmaRest } from '../src/adapters/figma/rest.ts';
import { FigmaUrlError, parseFigmaUrl } from '../src/design/url.ts';

function fakeFetch(responses: Response[]) {
  const requests: { url: string; token: string | undefined }[] = [];
  const fetch = async (url: string, init: { headers: Record<string, string> }) => {
    requests.push({ url, token: init.headers['X-Figma-Token'] });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    return next;
  };
  return { fetch, requests };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

test('FigmaRest sends the token and maps meta, nodes and comments', async () => {
  const { fetch, requests } = fakeFetch([
    json({ file: { name: 'Checkout', version: '42', last_touched_at: '2026-01-01T00:00:00Z' } }),
    json({ name: 'Checkout', version: '42', lastModified: '', nodes: {} }),
    json({ comments: [{ id: 'c1', message: 'hi', created_at: '' }] }),
  ]);
  const api = new FigmaRest('secret', { fetch, base: 'https://figma.test' });
  assert.deepEqual(await api.fileMeta('Key1'), { name: 'Checkout', version: '42', lastModified: '2026-01-01T00:00:00Z' });
  await api.nodes('Key1', ['1:2', '3:4'], 3);
  assert.equal((await api.comments('Key1')).length, 1);
  assert.deepEqual(
    requests.map((r) => [r.url, r.token]),
    [
      ['https://figma.test/v1/files/Key1/meta', 'secret'],
      ['https://figma.test/v1/files/Key1/nodes?ids=1%3A2%2C3%3A4&depth=3', 'secret'],
      ['https://figma.test/v1/files/Key1/comments', 'secret'],
    ],
  );
});

test('FigmaRest waits out a short rate limit once, and stops on a long one', async () => {
  const waits: number[] = [];
  const sleep = async (ms: number) => void waits.push(ms);
  const short = fakeFetch([json({}, 429, { 'retry-after': '3' }), json({ comments: [] })]);
  assert.deepEqual(await new FigmaRest('t', { fetch: short.fetch, sleep }).comments('K'), []);
  assert.deepEqual(waits, [3000]);

  const long = fakeFetch([json({}, 429, { 'retry-after': '86400' })]);
  await assert.rejects(new FigmaRest('t', { fetch: long.fetch, sleep }).comments('K'), (err) => err instanceof FigmaApiError && err.status === 429 && /retry in 86400s/.test(err.message));

  const twice = fakeFetch([json({}, 429, { 'retry-after': '1' }), json({}, 429, { 'retry-after': '1' })]);
  await assert.rejects(new FigmaRest('t', { fetch: twice.fetch, sleep }).comments('K'), /rate limit/);
});

test('FigmaRest explains access errors without echoing the token', async () => {
  const { fetch } = fakeFetch([json({ status: 403, err: 'Invalid token' }, 403)]);
  await assert.rejects(new FigmaRest('secret-token', { fetch }).nodes('K', ['1:2']), (err) => {
    assert.ok(err instanceof FigmaApiError);
    assert.match(err.message, /Figma 403 for \/v1\/files\/K\/nodes: Invalid token \(check FIGMA_TOKEN/);
    assert.doesNotMatch(err.message, /secret-token/);
    return true;
  });
});

test('parseFigmaUrl reads design, file and branch URLs', () => {
  assert.deepEqual(parseFigmaUrl('https://www.figma.com/design/AbCdEfGhIjKl/Name?node-id=12-34&m=dev'), { fileKey: 'AbCdEfGhIjKl', nodeId: '12:34' });
  assert.deepEqual(parseFigmaUrl('https://figma.com/file/AbCdEfGhIjKl/Name'), { fileKey: 'AbCdEfGhIjKl' });
  assert.deepEqual(parseFigmaUrl('https://www.figma.com/design/AbCdEfGhIjKl/branch/BrAnChKeY123/Name?node-id=1-2'), { fileKey: 'BrAnChKeY123', nodeId: '1:2' });
  for (const bad of ['not a url', 'https://example.com/design/AbCdEfGhIjKl/x', 'https://www.figma.com/board/AbCdEfGhIjKl/x', 'https://www.figma.com/design/x', 'https://www.figma.com/design/AbCdEfGhIjKl/x?node-id=abc']) {
    assert.throws(() => parseFigmaUrl(bad), FigmaUrlError, bad);
  }
});
