import path from 'node:path';
import { parseArgs } from 'node:util';
import { FigmaApiError, FigmaRest } from '../adapters/figma/rest.ts';
import { FsDesignCache, NO_CACHE } from '../adapters/fs/design-cache.ts';
import { CvaReadError } from '../adapters/ts/cva-reader.ts';
import { DesignReadError, readDesign } from '../design/read.ts';
import { FigmaUrlError, parseFigmaUrl } from '../design/url.ts';
import { buildCatalogue, renderCatalogue } from './catalogue-command.ts';
import { ConfigError, loadEnv, loadRepoConfig, TOOL_ROOT } from './config.ts';
import { renderDesign } from './design-command.ts';

const USAGE = `figma-ui-spec <command> [options]

Commands
  catalogue           print the project's design system as the tool reads it: typography components, tokens, protected paths
  design              read a Figma page, section or frame: its design frames, what was skipped and why, styles and components used

Options
  --repo <name>       project config to use, from .repos/<name>/config.json (design: optional, for skip rules)
  --root <dir>        catalogue: project checkout, instead of the config's root (for a worktree)
  --figma <url>       design: link to a page, section or frame (with node-id)
  --frames <a,b>      design: read only these frame ids in full
  --no-cache          design: ignore and do not write .cache/
  --json              print JSON instead of text
  --all               catalogue: also print breakpoints and other theme variables
`;

export async function main(argv: string[]): Promise<number> {
  try {
    return await run(argv);
  } catch (err) {
    if (err instanceof ConfigError || err instanceof CvaReadError || err instanceof FigmaUrlError) {
      process.stderr.write(`${err.message}\n`);
      return 2;
    }
    if (err instanceof FigmaApiError || err instanceof DesignReadError) {
      process.stderr.write(`${err.message}\n`);
      return 1;
    }
    if (err instanceof TypeError && 'code' in err && String(err.code).startsWith('ERR_PARSE_ARGS')) {
      process.stderr.write(`${err.message}\n\n${USAGE}`);
      return 2;
    }
    throw err;
  }
}

const OPTIONS = {
  repo: { type: 'string' },
  root: { type: 'string' },
  figma: { type: 'string' },
  frames: { type: 'string' },
  'no-cache': { type: 'boolean' },
  json: { type: 'boolean' },
  all: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>['values'];

const COMMANDS: Readonly<Record<string, (values: Values) => Promise<number>>> = {
  catalogue: runCatalogue,
  design: runDesign,
};

async function run(argv: string[]): Promise<number> {
  loadEnv();
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
  const [command] = positionals;
  if (values.help || !command) {
    process.stdout.write(USAGE);
    return values.help ? 0 : 2;
  }
  const handler = COMMANDS[command];
  if (!handler) {
    process.stderr.write(`unknown command: ${command}\n\n${USAGE}`);
    return 2;
  }
  return handler(values);
}

async function runCatalogue(values: Values): Promise<number> {
  if (!values.repo) throw new ConfigError('--repo is required');
  const catalogue = buildCatalogue(loadRepoConfig(values.repo, values.root));
  process.stdout.write(values.json ? `${JSON.stringify(catalogue, null, 2)}\n` : renderCatalogue(catalogue, values.all ?? false));
  return 0;
}

async function runDesign(values: Values): Promise<number> {
  if (!values.figma) throw new ConfigError('--figma is required');
  const token = process.env['FIGMA_TOKEN'];
  if (!token) throw new ConfigError('FIGMA_TOKEN is not set: put it in .env (see .env.example) or the environment');
  const skipRules = values.repo ? loadRepoConfig(values.repo).design.skip : [];
  const frames = values.frames?.split(',').map((f) => f.trim().replace('-', ':')).filter(Boolean);
  const cache = values['no-cache'] ? NO_CACHE : new FsDesignCache(path.join(TOOL_ROOT, '.cache'));
  const { snapshot, stats } = await readDesign(new FigmaRest(token), cache, parseFigmaUrl(values.figma), {
    skipRules,
    ...(frames ? { frames } : {}),
  });
  process.stdout.write(values.json ? `${JSON.stringify(snapshot, null, 2)}\n` : renderDesign(snapshot, stats));
  return 0;
}
