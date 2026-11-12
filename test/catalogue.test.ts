import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildCatalogue, renderCatalogue } from '../src/cli/catalogue-command.ts';
import { ConfigError, loadRepoConfig, parseRepoConfig } from '../src/cli/config.ts';

const root = path.join(import.meta.dirname, '../fixtures/tailwind-v4');
const config = {
  root,
  theme: { base: 'base-theme.css', files: ['src/styles/globals.css'], rootPx: 16, fontFamilies: { display: 'Comfortaa' } },
  typography: [
    { component: 'Heading', file: 'src/ui/heading.tsx', cva: 'headingVariants' },
    { component: 'Body', file: 'src/ui/heading.tsx', cva: 'bodyVariants' },
  ],
  protectedPaths: ['src/ui/**'],
};

test('buildCatalogue layers the project theme over the framework default and resolves typography components', () => {
  const c = buildCatalogue(parseRepoConfig(config, 'test'));
  const token = (name: string) => c.tokens.find((t) => t.name === name);
  assert.equal(token('color-red-500'), undefined, 'the project resets the colour namespace');
  assert.equal(token('color-gray-200')?.value, '#e5e7eb');
  assert.equal(token('color-gray-200')?.origin, 'project');
  assert.equal(token('text-base'), undefined, 'the project resets the text namespace, line heights included');
  assert.equal(token('text-sm--line-height'), undefined);
  assert.equal(token('font-weight-bold')?.origin, 'base');
  assert.equal(token('spacing')?.px, 4);
  assert.equal(token('not-a-token'), undefined);

  const v = (name: string) => c.typography.find((t) => `${t.component} ${t.prop}=${t.value}` === name);
  assert.deepEqual(v('Heading level=1')?.style, { family: 'Comfortaa', sizePx: 30, weight: 700, lineHeightPx: 37.5 });
  assert.deepEqual(v('Heading level=2')?.style, { family: 'Comfortaa', sizePx: 16, weight: 700, letterSpacingPx: 1.2 });
  assert.equal(v('Heading tone=muted'), undefined, 'a colour-only prop is not a typography variant');
  assert.deepEqual(v('Body size=odd')?.unresolved, ['text-[13px]']);
  assert.equal(v('Body truncate=end'), undefined);
  assert.equal(v('Body strong=true')?.style.weight, 400);

  const text = renderCatalogue(c);
  assert.match(text, /Heading level=1 +Comfortaa 30px\/37\.5 700/);
  assert.match(text, /fg +#151b26 +via color-black-900/);
  assert.match(text, /unresolved: text-\[13px\]/);
  assert.match(text, /Protected paths\n {2}src\/ui\/\*\*/);
});

test('buildCatalogue names a missing file', () => {
  assert.throws(
    () => buildCatalogue(parseRepoConfig({ ...config, theme: { ...config.theme, files: ['nope.css'] } }, 'test')),
    (err) => err instanceof ConfigError && /nope\.css does not exist/.test(err.message),
  );
});

test('repo configs come from the repos folder, are validated, and --root replaces the configured root', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'figma-ui-spec-repos-'));
  const previous = process.env['FIGMA_UI_SPEC_REPOS'];
  process.env['FIGMA_UI_SPEC_REPOS'] = dir;
  try {
    mkdirSync(path.join(dir, 'web'));
    writeFileSync(path.join(dir, 'web', 'config.json'), JSON.stringify(config));
    assert.equal(loadRepoConfig('web').root, root);
    assert.equal(loadRepoConfig('web', '/elsewhere').root, '/elsewhere');
    assert.throws(() => loadRepoConfig('other'), (err) => err instanceof ConfigError && /no config for other/.test(err.message));
    assert.throws(() => loadRepoConfig('../web'), ConfigError);
    writeFileSync(path.join(dir, 'web', 'config.json'), JSON.stringify({ ...config, root: 'relative' }));
    assert.throws(() => loadRepoConfig('web'), /root must be an absolute path/);
    writeFileSync(path.join(dir, 'web', 'config.json'), JSON.stringify({ ...config, theme: { files: 'x' } }));
    assert.throws(() => loadRepoConfig('web'), /theme\.files must be an array/);
    writeFileSync(path.join(dir, 'web', 'config.json'), '{ not json');
    assert.throws(() => loadRepoConfig('web'), ConfigError);
  } finally {
    if (previous === undefined) delete process.env['FIGMA_UI_SPEC_REPOS'];
    else process.env['FIGMA_UI_SPEC_REPOS'] = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('design skip rules are validated, and a rule type is upper-cased', () => {
  const withSkip = (skip: unknown) => parseRepoConfig({ ...config, design: { skip } }, 'cfg');
  assert.deepEqual(parseRepoConfig(config, 'cfg').design.skip, []);
  assert.deepEqual(withSkip([{ name: '^Annotation', type: 'frame', reason: 'annotation' }]).design.skip, [{ reason: 'annotation', name: '^Annotation', type: 'FRAME' }]);
  assert.throws(() => withSkip([{ name: '(', reason: 'x' }]), /design\.skip\[0\]\.name is not a valid regular expression/);
  assert.throws(() => withSkip([{ reason: 'x' }]), /design\.skip\[0\] needs a name or a type/);
  assert.throws(() => withSkip([{ name: 'a' }]), /design\.skip\[0\]\.reason must be a non-empty string/);
  assert.throws(() => withSkip('nope'), /design\.skip must be an array/);
});
