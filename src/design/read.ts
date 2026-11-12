import type { DesignCache } from '../ports/design-cache.ts';
import type { FigmaApi } from '../ports/figma-api.ts';
import type { FigmaComment, FigmaNode, FigmaNodeEntry } from './figma-json.ts';
import { normalizeFrame } from './normalize.ts';
import { cutOff, graft, outline, type SkipRule } from './outline.ts';
import type { DesignComment, DesignNode, DesignSnapshot } from './types.ts';
import type { FigmaTarget } from './url.ts';

export class DesignReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesignReadError';
  }
}

export interface ReadOptions {
  /** Frame ids to read in full; every design frame and component under the root when not given. */
  readonly frames?: readonly string[];
  readonly skipRules?: readonly SkipRule[];
  /** Frames per nodes request: fewer calls against Figma's rate limit, each response a few hundred KB per frame. */
  readonly batchSize?: number;
}

export interface ReadStats {
  /** API calls made, by kind. */
  readonly calls: { meta: number; outline: number; nodes: number; comments: number };
  readonly cachedFrames: number;
}

/** Outline of the root (page, section or frame) and the full trees of its design frames, read section by section and cached per file version. */
export async function readDesign(
  api: FigmaApi,
  cache: DesignCache,
  target: FigmaTarget,
  options: ReadOptions = {},
): Promise<{ snapshot: DesignSnapshot; stats: ReadStats }> {
  if (!target.nodeId) throw new DesignReadError('the Figma URL needs a node-id: open the page, section or frame and copy its link');
  const rootId = target.nodeId;
  const calls = { meta: 1, outline: 0, nodes: 0, comments: 0 };
  const meta = await api.fileMeta(target.fileKey);
  const { fileKey } = target;
  const { version } = meta;

  let rootDoc = cache.get(fileKey, version, `outline-${rootId}`) as FigmaNode | undefined;
  if (!rootDoc) {
    rootDoc = await readOutline(api, fileKey, rootId, calls);
    cache.put(fileKey, version, `outline-${rootId}`, rootDoc);
  }
  const { items, skipped } = outline(rootDoc, options.skipRules);

  const wanted = options.frames ?? items.map((i) => i.id);
  const entries = new Map<string, FigmaNodeEntry>();
  const missing: string[] = [];
  for (const id of wanted) {
    const cached = cache.get(fileKey, version, `node-${id}`) as FigmaNodeEntry | undefined;
    if (cached) entries.set(id, cached);
    else missing.push(id);
  }
  const cachedFrames = entries.size;
  const batchSize = Math.max(1, options.batchSize ?? 4);
  for (let i = 0; i < missing.length; i += batchSize) {
    const batch = missing.slice(i, i + batchSize);
    const response = await api.nodes(fileKey, batch);
    calls.nodes++;
    for (const id of batch) {
      const entry = response.nodes[id];
      if (!entry) throw new DesignReadError(`frame ${id} is not in file ${fileKey}`);
      cache.put(fileKey, version, `node-${id}`, entry);
      entries.set(id, entry);
    }
  }

  const frames: Record<string, DesignNode> = {};
  let hiddenNodes = 0;
  for (const id of wanted) {
    const { node, hidden } = normalizeFrame(entries.get(id) as FigmaNodeEntry);
    frames[id] = node;
    hiddenNodes += hidden;
  }

  const rawComments = await api.comments(fileKey);
  calls.comments++;
  const snapshot: DesignSnapshot = {
    file: { fileKey, name: meta.name, version, lastModified: meta.lastModified },
    root: { id: rootId, name: rootDoc.name, type: rootDoc.type },
    items,
    skipped,
    frames,
    hiddenNodes,
    comments: commentsFor(rawComments, frames, rootDoc.id, collectIds(rootDoc)),
  };
  return { snapshot, stats: { calls, cachedFrames } };
}

/** Levels read for the outline: root, sections, frames, and the frames' direct children. */
const OUTLINE_DEPTH = 3;
/** Levels read for each node the outline read cut off: enough for a section's frames and their children. */
const DEEPEN_DEPTH = 2;
const DEEPEN_ROUNDS = 6;
const DEEPEN_BATCH = 20;

async function readCut(
  api: FigmaApi,
  fileKey: string,
  ids: readonly string[],
  calls: { outline: number },
): Promise<Map<string, FigmaNode>> {
  const read = new Map<string, FigmaNode>();
  for (let i = 0; i < ids.length; i += DEEPEN_BATCH) {
    const more = await api.nodes(fileKey, ids.slice(i, i + DEEPEN_BATCH), DEEPEN_DEPTH);
    calls.outline++;
    for (const [id, entry] of Object.entries(more.nodes)) if (entry) read.set(id, entry.document);
  }
  return read;
}

/** The root read to OUTLINE_DEPTH, then whatever that cut off (sections nested deeper) read in further rounds. */
async function readOutline(api: FigmaApi, fileKey: string, rootId: string, calls: { outline: number }): Promise<FigmaNode> {
  const response = await api.nodes(fileKey, [rootId], OUTLINE_DEPTH);
  calls.outline++;
  let doc = response.nodes[rootId]?.document;
  if (!doc) throw new DesignReadError(`node ${rootId} is not in file ${fileKey} (deleted, or no access)`);
  let limit = OUTLINE_DEPTH;
  for (let round = 0; round < DEEPEN_ROUNDS; round++) {
    const cut = cutOff(doc, limit);
    if (cut.length === 0) return doc;
    doc = graft(doc, await readCut(api, fileKey, cut, calls));
    limit += DEEPEN_DEPTH;
  }
  throw new DesignReadError(`sections under ${rootId} nest deeper than this tool reads; open a deeper section's link instead`);
}

/** Comments pinned inside the read frames or anywhere under the root, with the frame each sits in. */
function commentsFor(
  raw: readonly FigmaComment[],
  frames: Readonly<Record<string, DesignNode>>,
  rootId: string,
  underRoot: ReadonlySet<string>,
): DesignComment[] {
  const frameOf = new Map<string, string>();
  for (const [frameId, node] of Object.entries(frames)) for (const id of collectNodeIds(node)) frameOf.set(id, frameId);
  const byId = new Map(raw.map((c) => [c.id, c]));
  const nodeOf = (c: FigmaComment): string | undefined =>
    c.client_meta?.node_id ?? (c.parent_id ? byId.get(c.parent_id)?.client_meta?.node_id : undefined);
  return raw
    .filter((c) => {
      const node = nodeOf(c);
      return node !== undefined && (node === rootId || underRoot.has(node) || frameOf.has(node));
    })
    .map((c) => {
      const nodeId = nodeOf(c);
      const frameId = nodeId ? frameOf.get(nodeId) : undefined;
      return {
        id: c.id,
        message: c.message,
        resolved: Boolean(c.resolved_at),
        createdAt: c.created_at,
        ...(nodeId ? { nodeId } : {}),
        ...(frameId ? { frameId } : {}),
        ...(c.parent_id ? { parentId: c.parent_id } : {}),
      };
    });
}

function collectNodeIds(n: DesignNode, out: string[] = []): string[] {
  out.push(n.id);
  for (const c of n.children ?? []) collectNodeIds(c, out);
  return out;
}

function collectIds(n: FigmaNode, ids = new Set<string>()): Set<string> {
  ids.add(n.id);
  for (const c of n.children ?? []) collectIds(c, ids);
  return ids;
}
