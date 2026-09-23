import { describe, expect, it } from 'vitest';

import { ConfigurationError, loadConfig } from '../../src/index.ts';

const validEnvironment = {
  ATLASBI_ENV: 'development',
  ATLASBI_SECRET_PROVIDER: 'env',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
};

describe('loadConfig', () => {
  it('maps environment variables to the domain configuration', () => {
    expect(loadConfig(validEnvironment)).toEqual({
      environment: 'development',
      secretProvider: 'env',
      telemetry: { otlpEndpoint: 'http://127.0.0.1:4318' },
    });
  });

  it('applies defaults to optional variables, including ones left empty', () => {
    const config = loadConfig({
      ATLASBI_ENV: '',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
    });

    expect(config.environment).toBe('development');
    expect(config.secretProvider).toBe('env');
  });

  it('reports every invalid variable by name in a single error', () => {
    const error: unknown = (() => {
      try {
        return loadConfig({ ATLASBI_ENV: 'staging', OTEL_EXPORTER_OTLP_ENDPOINT: '' });
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(ConfigurationError);
    const issues = (error as ConfigurationError).issues.join('\n');
    expect(issues).toContain('ATLASBI_ENV');
    expect(issues).toContain('OTEL_EXPORTER_OTLP_ENDPOINT');
  });
});
