import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderSpec } from '../../spec/render.ts';
import type { Conflict, Outcome, UiSpec } from '../../spec/types.ts';

export class SpecFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpecFileError';
  }
}

export function readSpec(file: string, options: { optional?: boolean } = {}): UiSpec | undefined {
  if (!existsSync(file)) {
    if (options.optional) return undefined;
    throw new SpecFileError(`${file} does not exist`);
  }
  let body: unknown;
  try {
    body = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new SpecFileError(`${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof body !== 'object' || body === null || (body as { format?: unknown }).format !== 1) {
    throw new SpecFileError(`${file} is not a ui-spec (format 1)`);
  }
  return body as UiSpec;
}

/** Writes `<name>.json` and the markdown next to it, each through a temporary file. */
export function writeSpec(file: string, spec: UiSpec): { json: string; md: string } {
  mkdirSync(path.dirname(file), { recursive: true });
  const md = file.replace(/\.json$/, '.md');
  atomic(file, `${JSON.stringify(spec, null, 2)}\n`);
  atomic(md, renderSpec(spec));
  return { json: file, md };
}

/** Records a decision on one conflict and re-renders the markdown; the trees change on the next `spec` run. */
export function decide(file: string, id: string, outcome: Outcome, by: string, date: string): Conflict {
  const spec = readSpec(file) as UiSpec;
  const conflict = spec.conflicts.find((c) => c.id === id);
  if (!conflict) throw new SpecFileError(`${file} has no conflict ${id}`);
  if (outcome === 'local-override' && !conflict.override) {
    throw new SpecFileError(`${id} has no exact override to use; pick another outcome`);
  }
  const decided: Conflict = { ...conflict, outcome, decidedBy: by, decided: date };
  writeSpec(file, { ...spec, conflicts: spec.conflicts.map((c) => (c.id === id ? decided : c)) });
  return decided;
}

function atomic(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}

/** An earlier spec only carries over to the same design and project; anything else would apply another design's decisions. */
export function previousFor(file: string, repo: string, fileKey: string, rootId: string): UiSpec | undefined {
  const previous = readSpec(file, { optional: true });
  if (!previous) return undefined;
  const { source } = previous;
  if (previous.repo !== repo || source.fileKey !== fileKey || source.rootId !== rootId) {
    throw new SpecFileError(`${file} is a spec for ${source.file} node ${source.rootId} in ${previous.repo}; use another --name or --out`);
  }
  return previous;
}
