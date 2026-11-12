import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DesignCache } from '../../ports/design-cache.ts';

/** JSON files under `<root>/<fileKey>/<version>/`. A new file version starts an empty folder. */
export class FsDesignCache implements DesignCache {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  /** A file that cannot be parsed (an interrupted write from an older run) counts as missing. */
  get(fileKey: string, version: string, name: string): unknown {
    const file = this.file(fileKey, version, name);
    if (!existsSync(file)) return undefined;
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return undefined;
    }
  }

  /** Written to a temporary file first, so an interrupted run never leaves half a file in place. */
  put(fileKey: string, version: string, name: string, value: unknown): void {
    const file = this.file(fileKey, version, name);
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(value));
    renameSync(tmp, file);
  }

  private file(fileKey: string, version: string, name: string): string {
    const safe = (s: string): string => s.replace(/[^\w.-]/g, '_');
    return path.join(this.root, safe(fileKey), safe(version), `${safe(name)}.json`);
  }
}

/** Ignores everything, for `--no-cache`. */
export const NO_CACHE: DesignCache = { get: () => undefined, put: () => undefined };
