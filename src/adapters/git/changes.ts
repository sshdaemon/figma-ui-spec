import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { FileChange } from '../../guard/check.ts';

export class ChangeSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChangeSourceError';
  }
}

/**
 * The files a git range changes, with both sides. `a...b` compares b with where it branched from a, `a..b` compares the
 * two commits, and a single ref compares it with the working tree. A rename shows as a removal and an addition. Only
 * the files `wanted` accepts are read. Against the working tree, untracked files count as added.
 */
export function gitChanges(root: string, range: string, wanted: (file: string) => boolean = () => true): FileChange[] {
  const { base, head } = sides(root, range);
  const listed = git(root, ['diff', '--name-only', '-z', '--no-renames', base, ...(head ? [head] : [])]);
  // Against the working tree, new files git does not track yet are changes too.
  const untracked = head ? '' : git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  const files = [...listed.split('\0'), ...untracked.split('\0')].filter((f) => f && wanted(f));
  return files.map((file) => ({
    file,
    contents: { before: show(root, base, file), after: head ? show(root, head, file) : readOrEmpty(path.join(root, file)) },
  }));
}

function sides(root: string, range: string): { base: string; head?: string } {
  if (range.split('.').some((side) => side.startsWith('-'))) {
    throw new ChangeSourceError(`--diff must be a git range, not an option: ${range}`);
  }
  const three = range.split('...');
  if (three.length === 2) {
    const head = three[1] || 'HEAD';
    return { base: git(root, ['merge-base', three[0] || 'HEAD', head]).trim(), head };
  }
  const two = range.split('..');
  if (two.length === 2) return { base: two[0] || 'HEAD', head: two[1] || 'HEAD' };
  return { base: range };
}

function show(root: string, ref: string, file: string): string {
  try {
    return git(root, ['show', `${ref}:${file}`]);
  } catch {
    return '';
  }
}

function git(root: string, args: readonly string[]): string {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim();
    throw new ChangeSourceError(`git ${args.join(' ')} failed in ${root}${stderr ? `: ${stderr}` : ''}`);
  }
}

function readOrEmpty(file: string): string {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

/**
 * Files about to change, given by path. With `after`, the one file's new contents are known and compared with what is
 * on disk; without it only the paths are.
 */
export function pathChanges(root: string, paths: readonly string[], after?: string): FileChange[] {
  if (after !== undefined && paths.length !== 1) throw new ChangeSourceError('--after needs exactly one --paths entry');
  return paths.map((p) => {
    const abs = path.resolve(root, p);
    const file = path.relative(root, abs);
    if (file.startsWith('..') || path.isAbsolute(file)) throw new ChangeSourceError(`${p} is outside ${root}`);
    return after === undefined ? { file } : { file, contents: { before: readOrEmpty(abs), after } };
  });
}
