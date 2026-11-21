import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { MapEntry } from '../../mapping/components.ts';

export class ComponentMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComponentMapError';
  }
}

/** The decided Figma-to-code component mappings of one project, kept as `{ "entries": [...] }`. */
export function readComponentMap(file: string): MapEntry[] {
  if (!existsSync(file)) return [];
  let body: unknown;
  try {
    body = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new ComponentMapError(`${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const entries = typeof body === 'object' && body !== null ? (body as { entries?: unknown }).entries : undefined;
  if (!Array.isArray(entries)) throw new ComponentMapError(`${file}: expected { "entries": [...] }`);
  return entries.map((e, i) => {
    if (typeof e !== 'object' || e === null || Array.isArray(e)) throw new ComponentMapError(`${file}: entries[${i}] must be an object`);
    const entry = e as Record<string, unknown>;
    for (const field of ['key', 'name', 'code', 'decided']) {
      if (typeof entry[field] !== 'string' || entry[field] === '') {
        throw new ComponentMapError(`${file}: entries[${i}].${field} must be a non-empty string`);
      }
    }
    if (entry['props'] !== undefined && !isStringRecord(entry['props'])) {
      throw new ComponentMapError(`${file}: entries[${i}].props must map property values to strings`);
    }
    return entry as unknown as MapEntry;
  });
}

/** Adds or replaces the entry with the same key. */
export function saveMapping(file: string, entry: MapEntry): MapEntry[] {
  const entries = [...readComponentMap(file).filter((e) => e.key !== entry.key), entry].toSorted((a, b) => a.name.localeCompare(b.name));
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ entries }, null, 2)}\n`);
  renameSync(tmp, file);
  return entries;
}

function isStringRecord(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === 'string');
}
