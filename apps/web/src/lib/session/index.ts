export type { SessionStatus, SignInOutcome } from './session.svelte.ts';
import { Session } from './session.svelte.ts';

/** The one session of this tab. */
export const session = new Session();
