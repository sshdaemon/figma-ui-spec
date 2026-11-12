#!/usr/bin/env node
import { main } from '../src/cli/main.ts';

// exitCode, not exit(): exit() can cut off output still queued for a pipe.
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);
