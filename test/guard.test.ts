import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after as afterAll, before, test } from 'node:test';
import { gitChanges, pathChanges } from '../src/adapters/git/changes.ts';
import { themeResidue } from '../src/catalogue/theme.ts';
import { buildCatalogue } from '../src/cli/catalogue-command.ts';
import { parseRepoConfig, type RepoConfig } from '../src/cli/config.ts';
import { guardChanges } from '../src/cli/guard-command.ts';
import { proposed } from '../src/cli/hook-command.ts';
import { matchesPaths, tokenDiff, tokensOf } from '../src/guard/check.ts';
import type { Conflict, Outcome, UiSpec } from '../src/spec/types.ts';

const fixture = path.join(import.meta.dirname, '../fixtures/tailwind-v4');
const bin = path.join(import.meta.dirname, '../bin/figma-ui-spec.js');
const THEME = 'src/styles/globals.css';
const HEADING = 'src/ui/heading.tsx';

let dir: string;
let root: string;
let config: RepoConfig;

const git = (...args: string[]) => {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', root, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};

function rawConfig(specs: string[] = []) {
  return {
    root,
    theme: { base: 'base-theme.css', files: [THEME], rootPx: 16, fontFamilies: { display: 'Lexend' } },
    typography: [
      { component: 'Heading', file: HEADING, cva: 'headingVariants' },
      { component: 'Body', file: HEADING, cva: 'bodyVariants' },
    ],
    protectedPaths: ['src/ui/**', THEME],
    specs,
  };
}

before(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'figma-ui-spec-guard-'));
  root = path.join(dir, 'project');
  cpSync(fixture, root, { recursive: true });
  config = parseRepoConfig(rawConfig(), 'test');
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-qm', 'base');
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function conflict(id: string, nearest: string, outcome: Outcome): Conflict {
  return {
    id,
    key: `k:${id}`,
    kind: 'text',
    design: 'x',
    nearest,
    uses: 1,
    examples: [],
    outcome,
    decidedBy: 'Sam',
    decided: '2026-11-21',
  };
}

function writeSpecWith(name: string, conflicts: Conflict[]): string {
  const file = path.join(dir, 'specs', `${name}.json`);
  mkdirSync(path.dirname(file), { recursive: true });
  const spec = { format: 1, repo: 'web', conflicts } as unknown as UiSpec;
  writeFileSync(file, JSON.stringify(spec));
  return file;
}

const original = (file: string) => readFileSync(path.join(fixture, file), 'utf8');

test('a change to a protected component file is a finding unless a new-variant decision names one of its variants', () => {
  const after = original(HEADING).replace('text-h1 leading-tight', 'text-h1 leading-snug');
  const changes = pathChanges(root, [HEADING], after);
  const bare = guardChanges('web', config, changes, []);
  assert.deepEqual(
    bare.findings.map((f) => [f.file, f.kind]),
    [[HEADING, 'file']],
  );

  const nearestOnly = writeSpecWith('nearest', [conflict('K1', 'Heading level=1', 'nearest')]);
  assert.equal(guardChanges('web', config, changes, [nearestOnly]).findings.length, 1, 'the default outcome allows nothing');

  const elsewhere = writeSpecWith('elsewhere', [conflict('K9', 'Heading level=1', 'new-variant')]);
  writeFileSync(elsewhere, readFileSync(elsewhere, 'utf8').replace('"repo":"web"', '"repo":"other"'));
  assert.equal(guardChanges('web', config, changes, [elsewhere]).findings.length, 1, "another project's spec allows nothing here");

  const broken = path.join(dir, 'specs', 'broken.json');
  writeFileSync(broken, '{');
  const decided = writeSpecWith('decided', [conflict('K2', 'Heading level=1', 'new-variant')]);
  const result = guardChanges('web', config, changes, [broken, decided]);
  assert.deepEqual(result.findings, []);
  assert.equal(result.unreadable.length, 1, 'an unreadable spec is skipped, not fatal');
  assert.deepEqual(result.covered[0]?.coveredBy, ['decided K2 new-variant (Sam, 2026-11-21)']);
});

test('a new-variant decision allows changing its own variant and adding variants, not changing the others or the base', () => {
  const spec = writeSpecWith('level2', [conflict('K1', 'Heading level=2', 'new-variant')]);
  const check = (after: string) => guardChanges('web', config, pathChanges(root, [HEADING], after), [spec]).findings.length;
  const text = original(HEADING);
  assert.equal(check(text.replace('text-body tracking-wider', 'text-body tracking-wide')), 0, 'the named variant changes');
  assert.equal(
    check(text.replace('2: "text-body tracking-wider",', '2: "text-body tracking-wider",\n      3: "text-body",')),
    0,
    'a variant is added',
  );
  assert.equal(check(text.replace('text-h1 leading-tight', 'text-h1 leading-snug')), 1, 'another variant changes');
  assert.equal(check(text.replace('["font-display", "font-bold"]', '["font-display", "font-semibold"]')), 1, 'the base changes');
  assert.equal(check(text.replace('muted: "text-gray-200"', 'muted: "text-fg"')), 1, 'a non-typography prop of the component changes');
  assert.equal(check(text.replace('1: "text-h1 leading-tight",\n', '')), 1, 'a variant is removed');
  assert.equal(check('export const headingVariants = 1;'), 1, 'a file it cannot read is not allowed');
  assert.equal(check(`${text}export const extra = 1;\n`), 1, 'code outside the variant tables changes');
  assert.equal(check(text.replace('defaultVariants: { level: 1 }', 'defaultVariants: { level: 2 }')), 1, 'the defaults change');
});

test('files outside the protected paths are not findings, and a path-only change to a protected file is', () => {
  assert.deepEqual(guardChanges('web', config, pathChanges(root, ['src/feature/page.tsx']), []).findings, []);
  assert.equal(guardChanges('web', config, pathChanges(root, [HEADING]), []).findings.length, 1);
  const theme = guardChanges('web', config, pathChanges(root, [THEME]), [
    writeSpecWith('any', [conflict('K1', 'text-fg', 'token-change')]),
  ]);
  assert.deepEqual(
    theme.findings.map((f) => f.kind),
    ['file'],
    'without the new contents no token decision can allow a theme change',
  );
});

test('theme variable changes are findings one by one, allowed by a token-change decision on the class that reads them', () => {
  const after = original(THEME)
    .replace('--color-gray-200: #e5e7eb;', '--color-gray-200: #e4e4e7;')
    .replace('--text-body: 1rem;', '--text-body: 1rem;\n  --text-body--line-height: 1.5;')
    .replace('  --tracking-wider: 1.4px;\n', '');
  const spec = writeSpecWith('tokens', [
    conflict('K1', 'border-gray-200', 'token-change'),
    conflict('K2', 'Body size=md', 'token-change'),
    conflict('K3', 'Heading level=2', 'new-variant'),
  ]);
  const result = guardChanges('web', config, pathChanges(root, [THEME], after), [spec]);
  assert.deepEqual(
    result.covered.map((f) => [f.token, f.change, f.coveredBy.map((c) => c.split(' ')[1])]),
    [
      ['color-gray-200', 'changed', ['K1']],
      ['text-body--line-height', 'added', ['K2']],
    ],
  );
  assert.deepEqual(
    result.findings.map((f) => [f.kind, f.token, f.change, f.before]),
    [['token', 'tracking-wider', 'removed', '1.4px']],
    'a new-variant decision does not allow token changes, and nothing outside the variables changed',
  );
});

test('a theme file change outside its variables is a file finding', () => {
  const after = original(THEME).replace('h1 {', 'h2 {');
  const result = guardChanges('web', config, pathChanges(root, [THEME], after), []);
  assert.deepEqual(
    result.findings.map((f) => f.kind),
    ['file'],
  );
});

test('matchesPaths applies !globs after the globs they follow', () => {
  const globs = ['src/ui/**', '!**/*.test.tsx', 'src/ui/keep/**'];
  assert.equal(matchesPaths('src/ui/Button.tsx', globs), true);
  assert.equal(matchesPaths('src/ui/Button.test.tsx', globs), false);
  assert.equal(matchesPaths('src/ui/keep/Button.test.tsx', globs), true, 'a later glob brings a file back');
  assert.equal(matchesPaths('src/other/Button.tsx', globs), false);
});

test('themeResidue drops only the top-level variables of @theme blocks', () => {
  const css = '@theme { --a: 1; --b: 2; @keyframes x { to { --c: 3; } } }\n:root { --d: 4; }';
  assert.equal(themeResidue(css), '@theme { @keyframes x { to { --c: 3; } } } :root { --d: 4; }');
  assert.equal(themeResidue(css.replace('--a: 1;', '--a: 9; --e: 5;')), themeResidue(css));
  assert.notEqual(themeResidue(css.replace('--d: 4', '--d: 5')), themeResidue(css));
  assert.notEqual(themeResidue(css.replace('--c: 3', '--c: 4')), themeResidue(css));
});

test('tokenDiff keeps the last declaration of a name', () => {
  assert.deepEqual(tokenDiff('@theme { --a: 1; --a: 2; }', '@theme { --a: 2; }'), []);
  assert.deepEqual(tokenDiff('@theme { --a: 1; }', '@theme { --a: 1; --a: 3; }'), [
    { token: 'a', change: 'changed', before: '1', after: '3' },
  ]);
});

test('tokensOf reads the variable a class names, by the kinds its prefix allows', () => {
  const { tokens } = buildCatalogue(config);
  assert.deepEqual(tokensOf('hover:bg-gray-200/50', tokens), ['color-gray-200']);
  assert.deepEqual(tokensOf('text-body', tokens), ['text-body']);
  assert.deepEqual(tokensOf('text-fg', tokens), ['color-fg']);
  assert.deepEqual(tokensOf('rounded-tl-md', tokens), ['radius-md']);
  assert.deepEqual(tokensOf('p-4', tokens), [], 'spacing steps read one shared variable, which no decision should change');
});

test('gitChanges gives both sides of every file in a range, and a single ref compares with the working tree', () => {
  git('checkout', '-qb', 'feature');
  writeFileSync(path.join(root, HEADING), original(HEADING).replace('font-bold', 'font-semibold'));
  writeFileSync(path.join(root, 'src/new.ts'), 'export {};\n');
  git('rm', '-q', 'src/ui/Button.test.tsx');
  git('add', '.');
  git('commit', '-qm', 'feature');
  try {
    const changes = gitChanges(root, 'main...feature');
    assert.deepEqual(changes.map((c) => c.file).toSorted(), ['src/new.ts', 'src/ui/Button.test.tsx', HEADING]);
    const removed = changes.find((c) => c.file === 'src/ui/Button.test.tsx');
    assert.equal(removed?.contents?.after, '');
    assert.equal(changes.find((c) => c.file === 'src/new.ts')?.contents?.before, '');

    writeFileSync(path.join(root, THEME), original(THEME).replace('#fff', '#fefefe'));
    assert.deepEqual(
      gitChanges(root, 'main..feature', (f) => f.startsWith('src/ui/')).map((c) => c.file),
      ['src/ui/Button.test.tsx', HEADING],
    );
    const working = gitChanges(root, 'HEAD');
    assert.deepEqual(
      working.map((c) => c.file),
      [THEME],
    );
    assert.deepEqual(
      guardChanges('web', config, working, []).findings.map((f) => f.token),
      ['color-white'],
    );
  } finally {
    git('checkout', '-q', '--', '.');
    git('checkout', '-q', 'main');
  }
});

test('proposed applies Write, Edit and MultiEdit calls, and gives up when the old text is not there', () => {
  const file = path.join(root, HEADING);
  const text = readFileSync(file, 'utf8');
  assert.equal(proposed({ tool_name: 'Write', tool_input: { file_path: file, content: 'x' } }, file), 'x');
  assert.equal(
    proposed(
      { tool_name: 'Edit', tool_input: { file_path: file, old_string: 'font-light', new_string: 'font-thin', replace_all: true } },
      file,
    ),
    text.replaceAll('font-light', 'font-thin'),
  );
  const multi = proposed(
    {
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: file,
        edits: [
          { old_string: 'level: 1', new_string: 'level: 2' },
          { old_string: '$&', new_string: '' },
        ],
      },
    },
    file,
  );
  assert.equal(multi, undefined);
  assert.equal(
    proposed({ tool_name: 'Edit', tool_input: { file_path: file, old_string: 'level: 1', new_string: '$&' } }, file),
    text.replace('level: 1', () => '$&'),
  );
  assert.equal(proposed({ tool_name: 'Read', tool_input: { file_path: file } }, file), undefined);
});

const edit = (file: string) => ({
  tool_name: 'Edit',
  tool_input: { file_path: file, old_string: 'leading-tight', new_string: 'leading-snug' },
});

function hook(input: object, repos: string): string {
  const r = spawnSync(process.execPath, [bin, 'hook'], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, FIGMA_UI_SPEC_REPOS: repos },
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test('the hook asks before an edit to shared code, in the project or a worktree of it, unless a spec decision allows it', () => {
  const repos = path.join(dir, 'repos');
  mkdirSync(path.join(repos, 'web'), { recursive: true });
  const specGlob = path.join(dir, 'hook-specs', '*.json');
  writeFileSync(path.join(repos, 'web', 'config.json'), JSON.stringify(rawConfig([specGlob])));

  const answer = JSON.parse(hook(edit(path.join(root, HEADING)), repos));
  assert.equal(answer.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(answer.hookSpecificOutput.permissionDecisionReason, /src\/ui\/heading\.tsx changes/);

  const worktree = path.join(dir, 'project-wt');
  git('worktree', 'add', '-q', worktree, '-b', 'wt');
  assert.match(hook(edit(path.join(worktree, HEADING)), repos), /"ask"/);

  const nested = path.join(root, '.claude/worktrees/a');
  git('worktree', 'add', '-q', nested, '-b', 'nested');
  assert.match(hook(edit(path.join(nested, HEADING)), repos), /"ask"/, 'a worktree inside the checkout is rooted at itself');

  const unmatched = {
    tool_name: 'Edit',
    tool_input: { file_path: path.join(root, HEADING), old_string: 'not in the file', new_string: 'x' },
  };
  assert.match(hook(unmatched, repos), /heading\.tsx changes/, 'an edit it cannot replay is checked by path');
  assert.equal(hook({ tool_name: 'Read', tool_input: { file_path: path.join(root, HEADING) } }, repos), '');

  assert.equal(hook({ tool_name: 'Write', tool_input: { file_path: path.join(root, 'src/feature/page.tsx'), content: 'x' } }, repos), '');
  const brokenRepos = path.join(dir, 'repos-broken');
  mkdirSync(path.join(brokenRepos, 'web'), { recursive: true });
  writeFileSync(
    path.join(brokenRepos, 'web', 'config.json'),
    JSON.stringify({ ...rawConfig(), theme: { ...rawConfig().theme, base: 'missing.css' } }),
  );
  const page = { tool_name: 'Write', tool_input: { file_path: path.join(root, 'src/feature/page.tsx'), content: 'x' } };
  assert.equal(hook(page, brokenRepos), '', 'a broken theme only matters to edits of shared code');
  assert.match(hook(edit(path.join(root, HEADING)), brokenRepos), /could not check/);
  assert.equal(hook({ tool_name: 'Write', tool_input: { file_path: path.join(dir, 'elsewhere.ts'), content: 'x' } }, repos), '');

  mkdirSync(path.dirname(specGlob), { recursive: true });
  writeFileSync(
    path.join(path.dirname(specGlob), 'ticket.json'),
    JSON.stringify({ format: 1, repo: 'web', conflicts: [conflict('K1', 'Heading level=1', 'new-variant')] }),
  );
  assert.equal(hook(edit(path.join(root, HEADING)), repos), '');
});

test('guard exits 1 with findings and 0 without', () => {
  const repos = path.join(dir, 'repos-cli');
  mkdirSync(path.join(repos, 'web'), { recursive: true });
  writeFileSync(path.join(repos, 'web', 'config.json'), JSON.stringify(rawConfig()));
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [bin, 'guard', '--repo', 'web', ...args], {
      encoding: 'utf8',
      env: { ...process.env, FIGMA_UI_SPEC_REPOS: repos },
    });
  const found = run('--paths', HEADING);
  assert.equal(found.status, 1, found.stderr);
  assert.match(found.stdout, /1 change\(s\) to shared code that no decision allows:\n- src\/ui\/heading\.tsx changes/);
  assert.equal(run('--paths', 'src/feature/page.tsx').status, 0);
  assert.equal(run('--diff=--output=x').status, 2);
  assert.equal(run('--diff=main..--output=x').status, 2);
  assert.equal(run('--diff=main...--output=x').status, 2);
  assert.equal(run('--paths', '../outside.ts').status, 2);
});
