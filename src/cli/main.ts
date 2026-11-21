import path from 'node:path';
import { parseArgs } from 'node:util';
import { FigmaApiError, FigmaRest } from '../adapters/figma/rest.ts';
import { ComponentMapError, readComponentMap, saveMapping } from '../adapters/fs/component-map.ts';
import { FsDesignCache, NO_CACHE } from '../adapters/fs/design-cache.ts';
import { ComponentScanError, scanComponents, scanIconNames } from '../adapters/ts/component-scan.ts';
import { CvaReadError } from '../adapters/ts/cva-reader.ts';
import { DesignReadError, readDesign } from '../design/read.ts';
import type { SkipRule } from '../design/outline.ts';
import { FigmaUrlError, parseFigmaUrl } from '../design/url.ts';
import { matchComponents, toPascal } from '../mapping/components.ts';
import { buildTable } from '../mapping/table.ts';
import { collectUsage } from '../mapping/usage.ts';
import { buildCatalogue, renderCatalogue } from './catalogue-command.ts';
import { componentMapFile, ConfigError, loadEnv, loadRepoConfig, TOOL_ROOT, type RepoConfig } from './config.ts';
import { renderDesign } from './design-command.ts';
import { renderTable } from './table-command.ts';

const USAGE = `figma-ui-spec <command> [options]

Commands
  catalogue           print the project's design system as the tool reads it: typography components, tokens, protected paths
  design              read a Figma page, section or frame: its design frames, what was skipped and why, styles and components used
  table               every value and component the design uses next to what the project's code has for it
  map                 save which code component a Figma library component maps to (--key, --name, --to)

Options
  --repo <name>       project config to use, from .repos/<name>/config.json (design: optional, for skip rules)
  --root <dir>        catalogue, table, map: project checkout, instead of the config's root (for a worktree)
  --figma <url>       design, table: link to a page, section or frame (with node-id)
  --frames <a,b>      design, table: read only these frame ids in full
  --no-cache          design, table: ignore and do not write .cache/
  --key <key>         map: the Figma component's library key, from the table
  --name <name>       map: the Figma component's name, kept for reading the map
  --to <file#Export>  map: repo-relative file and export, or lucide-react#Icon
  --json              print JSON instead of text
  --all               catalogue: also print breakpoints and other theme variables
`;

/** Errors from what the user passed or configured: exit 2, message only. */
const USAGE_ERRORS = [ConfigError, CvaReadError, FigmaUrlError, ComponentMapError, ComponentScanError];

export async function main(argv: string[]): Promise<number> {
  try {
    return await run(argv);
  } catch (err) {
    if (err instanceof Error && USAGE_ERRORS.some((type) => err instanceof type)) {
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
  key: { type: 'string' },
  name: { type: 'string' },
  to: { type: 'string' },
  json: { type: 'boolean' },
  all: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>['values'];

const COMMANDS: Readonly<Record<string, (values: Values) => Promise<number>>> = {
  catalogue: runCatalogue,
  design: runDesign,
  table: runTable,
  map: runMap,
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
  const skipRules = values.repo ? loadRepoConfig(values.repo).design.skip : [];
  const { snapshot, stats } = await read(values, skipRules);
  process.stdout.write(values.json ? `${JSON.stringify(snapshot, null, 2)}\n` : renderDesign(snapshot, stats));
  return 0;
}

async function runTable(values: Values): Promise<number> {
  if (!values.repo) throw new ConfigError('--repo is required');
  const config = loadRepoConfig(values.repo, values.root);
  const catalogue = buildCatalogue(config);
  const { snapshot } = await read(values, config.design.skip);
  const usage = collectUsage(snapshot);
  const { root, components } = config;
  const icons = {
    lucide: components.lucide ? scanIconNames(path.resolve(root, components.lucide)) : new Set<string>(),
    local: scanComponents(root, components.iconDirs),
  };
  const rows = matchComponents(
    usage.components,
    readComponentMap(componentMapFile(values.repo)),
    scanComponents(root, components.dirs),
    icons,
  );
  const table = buildTable(usage, catalogue, rows);
  const title = `${snapshot.file.name} / ${snapshot.root.name} against ${values.repo} (${Object.keys(snapshot.frames).length} frames)`;
  process.stdout.write(values.json ? `${JSON.stringify(table, null, 2)}\n` : renderTable(table, title));
  return 0;
}

async function runMap(values: Values): Promise<number> {
  if (!values.repo || !values.key || !values.name || !values.to) throw new ConfigError('map needs --repo, --key, --name and --to');
  const config = loadRepoConfig(values.repo, values.root);
  const code = checkTarget(values.to, config);
  const entries = saveMapping(componentMapFile(values.repo), {
    key: values.key,
    name: values.name,
    code,
    decided: new Date().toISOString().slice(0, 10),
  });
  process.stdout.write(`${values.name} → ${code} (${entries.length} mappings)\n`);
  return 0;
}

/** `--to` as `file#Export` with a normalised repo-relative file that exports it, or a lucide icon the project has. */
function checkTarget(to: string, config: RepoConfig): string {
  const parts = to.split('#');
  const [rawFile, exported] = parts;
  if (parts.length !== 2 || !rawFile || !exported) {
    throw new ConfigError('--to must be file#Export, for example src/ui/Button.tsx#Button or lucide-react#Calendar');
  }
  if (rawFile === 'lucide-react') {
    const { lucide } = config.components;
    if (!lucide) throw new ConfigError('lucide-react targets need components.lucide in the repo config');
    if (![...scanIconNames(path.resolve(config.root, lucide))].some((name) => toPascal(name) === exported)) {
      throw new ConfigError(`lucide-react has no ${exported} icon`);
    }
    return to;
  }
  const file = path.normalize(rawFile);
  if (path.isAbsolute(file) || file.startsWith('..')) throw new ConfigError(`--to needs a path inside the project: ${rawFile}`);
  if (!scanComponents(config.root, [path.dirname(file)]).some((c) => c.file === file && c.name === exported)) {
    throw new ConfigError(`${exported} is not exported from ${file} under ${config.root}`);
  }
  return `${file}#${exported}`;
}

async function read(values: Values, skipRules: readonly SkipRule[]): ReturnType<typeof readDesign> {
  if (!values.figma) throw new ConfigError('--figma is required');
  const token = process.env['FIGMA_TOKEN'];
  if (!token) throw new ConfigError('FIGMA_TOKEN is not set: put it in .env (see .env.example) or the environment');
  const frames = values.frames
    ?.split(',')
    .map((f) => f.trim().replace('-', ':'))
    .filter(Boolean);
  const cache = values['no-cache'] ? NO_CACHE : new FsDesignCache(path.join(TOOL_ROOT, '.cache'));
  return readDesign(new FigmaRest(token), cache, parseFigmaUrl(values.figma), { skipRules, ...(frames ? { frames } : {}) });
}
