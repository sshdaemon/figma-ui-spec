import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathChanges } from '../adapters/git/changes.ts';
import { loadRepoConfig, reposDir, type RepoConfig } from './config.ts';
import { describe, guardChanges, specFilesFor } from './guard-command.ts';

/** What Claude Code sends a PreToolUse hook, as far as the guard needs it. */
interface ToolCall {
  readonly tool_name?: string;
  readonly tool_input?: {
    readonly file_path?: string;
    readonly content?: string;
    readonly old_string?: string;
    readonly new_string?: string;
    readonly replace_all?: boolean;
    readonly edits?: readonly { readonly old_string?: string; readonly new_string?: string; readonly replace_all?: boolean }[];
  };
}

/**
 * A Claude Code PreToolUse hook for Write, Edit and MultiEdit: when the file belongs to a configured project (or one
 * of its git worktrees) and the new contents change shared code no decision allows, it answers "ask" so a person
 * confirms the edit. Anything else gets no answer, which leaves the normal permission flow alone.
 */
export function runHook(stdin: string): string {
  const call = JSON.parse(stdin) as ToolCall;
  const file = call.tool_input?.file_path;
  if (!file || !path.isAbsolute(file) || !EDIT_TOOLS.has(call.tool_name ?? '')) return '';
  const project = projectOf(file);
  if (!project) return '';
  // An edit this cannot replay (the tool also matches with normalised quotes) is checked by path, so a shared file still asks.
  const after = proposed(call, file);
  try {
    const specs = specFilesFor(project.config, undefined);
    const result = guardChanges(project.name, project.config, pathChanges(project.config.root, [real(file)], after), specs);
    if (result.findings.length === 0) return '';
    return ask(
      `This edit changes shared code in ${project.name} that no ui-spec decision allows: ${result.findings.map(describe).join('; ')}. ` +
        'Confirm only if this shared change is intended.',
    );
  } catch (err) {
    return ask(`figma-ui-spec could not check this edit to ${project.name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);

function ask(reason: string): string {
  return `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } })}\n`;
}

/** The file's contents after the call, or undefined for another tool or an edit whose old text is not in the file. */
export function proposed(call: ToolCall, file: string): string | undefined {
  const input = call.tool_input ?? {};
  if (call.tool_name === 'Write') return input.content;
  const edits = call.tool_name === 'Edit' ? [input] : call.tool_name === 'MultiEdit' ? (input.edits ?? []) : undefined;
  if (!edits) return undefined;
  let text: string | undefined = existsSync(file) ? readFileSync(file, 'utf8') : '';
  for (const e of edits) text = applyEdit(text, e);
  return text;
}

function applyEdit(text: string | undefined, e: { old_string?: string; new_string?: string; replace_all?: boolean }): string | undefined {
  if (text === undefined || e.old_string === undefined || e.new_string === undefined) return undefined;
  if (e.old_string === '') return text === '' ? e.new_string : undefined;
  if (!text.includes(e.old_string)) return undefined;
  return e.replace_all ? text.replaceAll(e.old_string, () => e.new_string ?? '') : text.replace(e.old_string, () => e.new_string ?? '');
}

/** The configured project the file is in: under a config's root, or in a git worktree of it (then rooted at the worktree). */
function projectOf(file: string): { name: string; config: RepoConfig } | undefined {
  const dir = reposDir();
  if (!existsSync(dir)) return undefined;
  const git = gitOf(file);
  for (const name of readdirSync(dir)) {
    if (!existsSync(path.join(dir, name, 'config.json'))) continue;
    const config = tryLoad(name);
    if (!config) continue;
    const root = real(config.root);
    // The worktree check comes first: a worktree can sit inside the main checkout (`.claude/worktrees/<name>`).
    if (git && git.common === path.join(root, '.git')) return { name, config: loadRepoConfig(name, git.top) };
    if (inside(real(file), root)) return { name, config: loadRepoConfig(name, root) };
  }
  return undefined;
}

function tryLoad(name: string): RepoConfig | undefined {
  try {
    return loadRepoConfig(name);
  } catch {
    // A broken config for one project must not block edits everywhere; `catalogue --repo` reports it.
    return undefined;
  }
}

function gitOf(file: string): { top: string; common: string } | undefined {
  let dir = path.dirname(file);
  while (!existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  try {
    const out = execFileSync('git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const [top, common] = out.trim().split('\n');
    return top && common ? { top: real(top), common: real(common) } : undefined;
  } catch {
    return undefined;
  }
}

function inside(file: string, root: string): boolean {
  const rel = path.relative(root, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** The real path, or for a file not written yet, its nearest existing parent's real path joined with the rest. */
function real(p: string): string {
  if (existsSync(p)) return realpathSync(p);
  const parent = path.dirname(p);
  return parent === p ? p : path.join(real(parent), path.basename(p));
}
