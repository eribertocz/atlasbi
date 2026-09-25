import { styleText } from 'node:util';

import { runBootstrap } from './commands/bootstrap.ts';
import { runDev } from './commands/dev.ts';
import { runPreflight } from './commands/preflight.ts';
import { runResetLocal } from './commands/reset-local.ts';
import { runSeed } from './commands/seed.ts';
import { runStackDown, runStackLogs, runStackUp } from './commands/stack.ts';
import { describeFailure } from './lakehouse-environment.ts';

const COMMANDS: Record<string, (args: readonly string[]) => Promise<void>> = {
  preflight: runPreflight,
  bootstrap: runBootstrap,
  dev: runDev,
  seed: runSeed,
  'stack:up': runStackUp,
  'stack:down': runStackDown,
  'stack:logs': runStackLogs,
  'reset:local': runResetLocal,
};

const [commandName, ...args] = process.argv.slice(2);
const command = commandName === undefined ? undefined : COMMANDS[commandName];

if (command === undefined) {
  console.error(`Usage: pnpm <${Object.keys(COMMANDS).join(' | ')}>`);
  process.exitCode = 1;
} else {
  try {
    await command(args);
  } catch (error) {
    console.error(`\n${styleText('red', describeFailure(error))}`);
    process.exitCode = 1;
  }
}
