import type { FigmaComment, FigmaFileMeta, FigmaNodesResponse } from '../design/figma-json.ts';

/** Read access to one Figma account's files. */
export interface FigmaApi {
  /** Name and current version; cheap, used to key the cache. */
  fileMeta(fileKey: string): Promise<FigmaFileMeta>;
  /** Full trees of the given nodes, or only `depth` levels of them. */
  nodes(fileKey: string, ids: readonly string[], depth?: number): Promise<FigmaNodesResponse>;
  comments(fileKey: string): Promise<readonly FigmaComment[]>;
}
