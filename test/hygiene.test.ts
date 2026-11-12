import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadEnv } from '../src/cli/config.ts';

const repo = path.join(import.meta.dirname, '..');
const PRIVATE = /^(\.env$|\.repos\/|\.cache\/)/;

test('the token, project configs and cache are ignored and never tracked', () => {
  const ignored = readFileSync(path.join(repo, '.gitignore'), 'utf8').split('\n');
  for (const entry of ['.env', '.repos/', '.cache/']) assert.ok(ignored.includes(entry), `${entry} is in .gitignore`);
  const tracked = execFileSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8' }).split('\n');
  assert.deepEqual(
    tracked.filter((f) => PRIVATE.test(f)),
    [],
  );
});

test('the pre-commit hook refuses a staged .env or .repos file', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'figma-ui-spec-hook-'));
  try {
    const git = (...args: string[]) =>
      spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });
    git('init', '-q');
    mkdirSync(path.join(dir, 'hooks'));
    copyFileSync(path.join(repo, 'scripts/git-hooks/pre-commit'), path.join(dir, 'hooks/pre-commit'));
    git('config', 'core.hooksPath', 'hooks');
    writeFileSync(path.join(dir, 'ok.txt'), 'ok');
    git('add', 'ok.txt');
    assert.equal(git('commit', '-q', '-m', 'ok').status, 0);
    mkdirSync(path.join(dir, '.repos/web'), { recursive: true });
    writeFileSync(path.join(dir, '.repos/web/config.json'), '{}');
    writeFileSync(path.join(dir, '.env'), 'FIGMA_TOKEN=x');
    git('add', '-f', '.env', '.repos/web/config.json');
    const refused = git('commit', '-q', '-m', 'leak');
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /\.env/);
    assert.match(refused.stderr, /\.repos\/web\/config\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the pre-commit hook runs lint and the format check when the tools are installed', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'figma-ui-spec-hook-lint-'));
  try {
    const git = (...args: string[]) =>
      spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });
    git('init', '-q');
    mkdirSync(path.join(dir, 'hooks'));
    copyFileSync(path.join(repo, 'scripts/git-hooks/pre-commit'), path.join(dir, 'hooks/pre-commit'));
    symlinkSync(path.join(repo, 'node_modules'), path.join(dir, 'node_modules'));
    writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
    git('config', 'core.hooksPath', 'hooks');

    writeFileSync(path.join(dir, 'ok.js'), 'export const a = 1;\n');
    git('add', '.gitignore', 'ok.js');
    assert.equal(git('commit', '-q', '-m', 'clean').status, 0);

    writeFileSync(path.join(dir, 'lint.js'), 'debugger;\n');
    git('add', 'lint.js');
    assert.notEqual(git('commit', '-q', '-m', 'lint error').status, 0);
    rmSync(path.join(dir, 'lint.js'));
    git('rm', '-q', '--cached', 'lint.js');

    writeFileSync(path.join(dir, 'format.js'), 'export const   b=2\n');
    git('add', 'format.js');
    const unformatted = git('commit', '-q', '-m', 'unformatted');
    assert.notEqual(unformatted.status, 0);
    assert.match(unformatted.stderr, /npm run format/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadEnv reads the .env file without overriding the environment', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'figma-ui-spec-env-'));
  const keys = ['FUS_TEST_A', 'FUS_TEST_B'] as const;
  try {
    writeFileSync(path.join(dir, '.env'), 'FUS_TEST_A=file\nFUS_TEST_B=file\n');
    process.env['FUS_TEST_A'] = 'env';
    loadEnv(path.join(dir, '.env'));
    assert.equal(process.env['FUS_TEST_A'], 'env');
    assert.equal(process.env['FUS_TEST_B'], 'file');
    loadEnv(path.join(dir, 'missing.env'));
  } finally {
    for (const k of keys) delete process.env[k];
    rmSync(dir, { recursive: true, force: true });
  }
});
