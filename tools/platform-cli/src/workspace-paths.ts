import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const WORKSPACE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export const WORKSPACE_FILES = {
  composeFile: path.join(WORKSPACE_ROOT, 'compose.yaml'),
  envFile: path.join(WORKSPACE_ROOT, '.env'),
  envExampleFile: path.join(WORKSPACE_ROOT, '.env.example'),
  nodeVersionFile: path.join(WORKSPACE_ROOT, '.node-version'),
  rootPackageJson: path.join(WORKSPACE_ROOT, 'package.json'),
} as const;

/** Compose project name, also the word typed to confirm destructive commands. */
export const PROJECT_NAME = 'atlasbi';
