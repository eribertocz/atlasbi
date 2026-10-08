import { session } from '../session/index.ts';
import { createApiClient } from './client.ts';

/** The gateway, as this tab's session sees it. */
export const api = createApiClient(session);
