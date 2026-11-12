export class FigmaUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FigmaUrlError';
  }
}

export interface FigmaTarget {
  readonly fileKey: string;
  /** `12:34`, from the URL's `node-id=12-34`. */
  readonly nodeId?: string;
}

/** File key and node id from a Figma design URL. A branch URL reads the branch. */
export function parseFigmaUrl(input: string): FigmaTarget {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new FigmaUrlError(`not a URL: ${input}`);
  }
  if (!/(^|\.)figma\.com$/.test(url.hostname)) throw new FigmaUrlError(`not a figma.com URL: ${input}`);
  const parts = url.pathname.split('/').filter(Boolean);
  const kind = parts[0];
  if (kind !== 'design' && kind !== 'file') throw new FigmaUrlError(`only design file URLs are supported: ${input}`);
  const fileKey = parts[2] === 'branch' && parts[3] ? parts[3] : parts[1];
  if (!fileKey || !/^[0-9a-zA-Z]{10,128}$/.test(fileKey)) throw new FigmaUrlError(`no file key in ${input}`);
  const node = url.searchParams.get('node-id');
  if (node === null) return { fileKey };
  const nodeId = node.replace('-', ':');
  if (!/^\d+:\d+$/.test(nodeId)) throw new FigmaUrlError(`unexpected node-id ${node} in ${input}`);
  return { fileKey, nodeId };
}
