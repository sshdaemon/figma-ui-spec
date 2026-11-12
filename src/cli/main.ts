import { parseArgs } from 'node:util';
import { CvaReadError } from '../adapters/ts/cva-reader.ts';
import { buildCatalogue, renderCatalogue } from './catalogue-command.ts';
import { ConfigError, loadEnv, loadRepoConfig } from './config.ts';

const USAGE = `figma-ui-spec <command> [options]

Commands
  catalogue           print the project's design system as the tool reads it: typography components, tokens, protected paths

Options
  --repo <name>       project config to use, from .repos/<name>/config.json
  --root <dir>        project checkout, instead of the config's root (for a worktree)
  --json              print JSON instead of text
  --all               catalogue: also print breakpoints and other theme variables
`;

export async function main(argv: string[]): Promise<number> {
  try {
    return run(argv);
  } catch (err) {
    if (err instanceof ConfigError || err instanceof CvaReadError) {
      process.stderr.write(`${err.message}\n`);
      return 2;
    }
    throw err;
  }
}

function run(argv: string[]): number {
  loadEnv();
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      repo: { type: 'string' },
      root: { type: 'string' },
      json: { type: 'boolean' },
      all: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command] = positionals;
  if (values.help || !command) {
    process.stdout.write(USAGE);
    return values.help ? 0 : 2;
  }
  if (command !== 'catalogue') {
    process.stderr.write(`unknown command: ${command}\n\n${USAGE}`);
    return 2;
  }
  if (!values.repo) throw new ConfigError('--repo is required');
  const catalogue = buildCatalogue(loadRepoConfig(values.repo, values.root));
  process.stdout.write(values.json ? `${JSON.stringify(catalogue, null, 2)}\n` : renderCatalogue(catalogue, values.all ?? false));
  return 0;
}
