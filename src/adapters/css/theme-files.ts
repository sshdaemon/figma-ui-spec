import { readFileSync } from 'node:fs';
import { parseThemeDeclarations, type Declaration } from '../../catalogue/theme.ts';

/** The framework's default theme first, then the project's own files in the order given, as Tailwind layers them. */
export function readThemeDeclarations(baseFile: string | undefined, projectFiles: readonly string[]): Declaration[] {
  const base = baseFile ? parseThemeDeclarations(readFileSync(baseFile, 'utf8'), 'base') : [];
  return [...base, ...projectFiles.flatMap((f) => parseThemeDeclarations(readFileSync(f, 'utf8'), 'project'))];
}
