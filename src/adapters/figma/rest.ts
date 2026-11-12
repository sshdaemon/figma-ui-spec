import type { FigmaComment, FigmaFileMeta, FigmaNodesResponse } from '../../design/figma-json.ts';
import type { FigmaApi } from '../../ports/figma-api.ts';

export class FigmaApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'FigmaApiError';
    this.status = status;
  }
}

type Fetch = (url: string, init: { headers: Record<string, string> }) => Promise<Response>;
type Sleep = (ms: number) => Promise<void>;

/** Waits this long at most when Figma asks to retry; a longer wait means the plan's limit is used up. */
const MAX_RETRY_WAIT_S = 60;

/** Figma's REST API with a personal access token. */
export class FigmaRest implements FigmaApi {
  private readonly token: string;
  private readonly fetchImpl: Fetch;
  private readonly sleep: Sleep;
  private readonly base: string;

  constructor(token: string, options: { fetch?: Fetch; sleep?: Sleep; base?: string } = {}) {
    this.token = token;
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.base = options.base ?? 'https://api.figma.com';
  }

  async fileMeta(fileKey: string): Promise<FigmaFileMeta> {
    const body = (await this.get(`/v1/files/${fileKey}/meta`)) as { file: { name: string; version: string; last_touched_at: string } };
    return { name: body.file.name, version: body.file.version, lastModified: body.file.last_touched_at };
  }

  async nodes(fileKey: string, ids: readonly string[], depth?: number): Promise<FigmaNodesResponse> {
    const query = new URLSearchParams({ ids: ids.join(',') });
    if (depth !== undefined) query.set('depth', String(depth));
    return (await this.get(`/v1/files/${fileKey}/nodes?${query}`)) as FigmaNodesResponse;
  }

  async comments(fileKey: string): Promise<readonly FigmaComment[]> {
    const body = (await this.get(`/v1/files/${fileKey}/comments`)) as { comments: FigmaComment[] };
    return body.comments;
  }

  private async get(path: string, retried = false): Promise<unknown> {
    const res = await this.fetchImpl(`${this.base}${path}`, { headers: { 'X-Figma-Token': this.token } });
    if (res.ok) return res.json();
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after') ?? 'NaN');
      if (!retried && Number.isFinite(wait) && wait <= MAX_RETRY_WAIT_S) {
        await this.sleep(wait * 1000);
        return this.get(path, true);
      }
      const when = Number.isFinite(wait) ? `in ${wait}s` : 'later';
      throw new FigmaApiError(429, `Figma rate limit reached, retry ${when} (the limit depends on the token owner's seat and plan)`);
    }
    throw new FigmaApiError(res.status, `Figma ${res.status} for ${path.split('?')[0]}: ${await errorText(res)}${hint(res.status)}`);
  }
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { err?: string; message?: string };
    return body.err ?? body.message ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

function hint(status: number): string {
  if (status === 401 || status === 403) return ' (check FIGMA_TOKEN in .env and that its owner can open the file)';
  if (status === 404) return ' (check the file key in the URL)';
  return '';
}
