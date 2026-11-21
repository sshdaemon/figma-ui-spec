import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const bin = path.join(import.meta.dirname, '../bin/figma-ui-spec.js');
const fixture = path.join(import.meta.dirname, '../fixtures/tailwind-v4');

test('map checks its target and saves the decision', () => {
  const repos = mkdtempSync(path.join(os.tmpdir(), 'figma-ui-spec-cli-'));
  try {
    mkdirSync(path.join(repos, 'web'));
    mkdirSync(path.join(repos, 'icons'));
    writeFileSync(path.join(repos, 'icons', 'calendar.js'), '');
    writeFileSync(path.join(repos, 'icons', 'grid-2x2.js'), '');
    writeFileSync(path.join(repos, 'icons', 'a-arrow-down.js'), '');
    const config = {
      root: fixture,
      theme: { files: ['src/styles/globals.css'] },
      components: { lucide: path.relative(fixture, path.join(repos, 'icons')) },
    };
    writeFileSync(path.join(repos, 'web', 'config.json'), JSON.stringify(config));
    const map = (...args: string[]) =>
      spawnSync(process.execPath, [bin, 'map', '--repo', 'web', '--key', 'k1', '--name', 'Action', ...args], {
        encoding: 'utf8',
        env: { ...process.env, FIGMA_UI_SPEC_REPOS: repos },
      });

    const ok = map('--to', './src/ui/Button.tsx#Button');
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /Action → src\/ui\/Button\.tsx#Button \(1 mappings\)/);
    const saved = JSON.parse(readFileSync(path.join(repos, 'web', 'component-map.json'), 'utf8'));
    assert.equal(saved.entries[0].code, 'src/ui/Button.tsx#Button');

    const cases: [string, RegExp][] = [
      ['src/ui/Button.tsx#Missing', /Missing is not exported from src\/ui\/Button\.tsx/],
      ['src/nope/X.tsx#X', /src\/nope does not exist/],
      ['../outside.tsx#X', /needs a path inside the project/],
      ['a#b#c', /--to must be file#Export/],
      ['lucide-react#Calandar', /lucide-react has no Calandar icon/],
    ];
    for (const [to, message] of cases) {
      const r = map('--to', to);
      assert.equal(r.status, 2, to);
      assert.match(r.stderr, message, to);
      assert.doesNotMatch(r.stderr, /\n\s+at /, `${to}: no stack trace`);
    }
    for (const icon of ['Calendar', 'Grid2x2', 'AArrowDown']) assert.equal(map('--to', `lucide-react#${icon}`).status, 0, icon);

    writeFileSync(
      path.join(repos, 'web', 'config.json'),
      JSON.stringify({ ...config, components: { lucide: 'node_modules/no-such-icons' } }),
    );
    const noFolder = map('--to', 'lucide-react#Calendar');
    writeFileSync(path.join(repos, 'web', 'config.json'), JSON.stringify({ ...config, components: {} }));
    const unset = map('--to', 'lucide-react#Calendar');
    assert.equal(unset.status, 2);
    assert.match(unset.stderr, /lucide-react targets need components\.lucide/);
    assert.equal(noFolder.status, 2);
    assert.match(noFolder.stderr, /no-such-icons does not exist \(check components\.lucide/);
  } finally {
    rmSync(repos, { recursive: true, force: true });
  }
});
