import { createInterface } from 'node:readline/promises';

import { PROJECT_NAME } from '../workspace-paths.ts';

/** What a script passes instead of typing the confirmation. */
export const CONFIRM_FLAG = `--confirm=${PROJECT_NAME}`;

/** A command that needs a person's explicit yes ran where nobody can type it, and without the flag. */
export class ConfirmationRequiredError extends Error {
  constructor(what: string) {
    super(`${what} Confirm in an interactive terminal, or pass ${CONFIRM_FLAG}.`);
    this.name = 'ConfirmationRequiredError';
  }
}

/**
 * The explicit yes of destructive commands (docs/19 §2): the flag, or the project's name typed at
 * the terminal. Never assumed: outside a terminal and without the flag, the command refuses.
 */
export async function confirmByTyping(args: readonly string[], warning: string): Promise<boolean> {
  if (args.includes(CONFIRM_FLAG)) {
    return true;
  }
  if (!process.stdin.isTTY) {
    throw new ConfirmationRequiredError(warning);
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`${warning}\nType "${PROJECT_NAME}" to confirm: `);
    return answer.trim() === PROJECT_NAME;
  } finally {
    prompt.close();
  }
}
