import path from 'node:path';

import { loadConfig } from '@atlasbi/config';
import { describe, expect, it } from 'vitest';

import {
  LOCAL_DATA_DIRECTORIES,
  WORKSPACE_FILES,
  WORKSPACE_ROOT,
} from '../../src/workspace-paths.ts';

describe('what pnpm reset:local deletes besides the volumes', () => {
  it('is the lakehouse and the ingestion state of that lakehouse, both inside .data/', () => {
    const dataRoot = path.join(WORKSPACE_ROOT, '.data') + path.sep;

    expect(LOCAL_DATA_DIRECTORIES).toEqual([
      WORKSPACE_FILES.lakehouseDataDirectory,
      WORKSPACE_FILES.ingestionDataDirectory,
    ]);
    for (const directory of LOCAL_DATA_DIRECTORIES) {
      expect(directory.startsWith(dataRoot), directory).toBe(true);
    }
  });

  it('deletes the ingestion folder the configuration uses by default, whatever that default becomes', () => {
    const config = loadConfig(
      {
        ATLASBI_ENV: 'development',
        ATLASBI_SECRET_PROVIDER: 'env',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
      },
      { baseDirectory: WORKSPACE_ROOT },
    );

    expect(config.ingestion.dataPath).toBe(WORKSPACE_FILES.ingestionDataDirectory);
  });
});
