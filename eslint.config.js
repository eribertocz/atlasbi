import eslint from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const INTERNALS_PATTERN = {
  group: ['@atlasbi/*/src', '@atlasbi/*/src/**'],
  message:
    'Import another package through its public entry point, never its internals (CLAUDE.md rule 2).',
};
const INCUBATING_SEMCONV = {
  name: '@opentelemetry/semantic-conventions/incubating',
  message:
    'Only stable OpenTelemetry semantic conventions are allowed (docs/01 §6.7): incubating names may change.',
};
const DUCKDB_CLIENT = {
  name: '@duckdb/node-api',
  message:
    'DuckDB types never cross the adapter boundary (docs/21 §3.2): use the lakehouse ports from @atlasbi/contracts and @atlasbi/warehouse.',
};

// Encodes docs/21-engineering-standards.md where a linter can: naming conventions (§8),
// "consume a package's public entry point, never its internals" (CLAUDE.md rule 2) and
// "vendor types stay inside their adapter" (§3.2).
export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/.venv/**',
      '**/.cache/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      'docs/**',
    ],
  },
  eslint.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'] },
        { selector: 'variable', modifiers: ['const'], format: ['camelCase', 'UPPER_CASE'] },
        { selector: 'typeLike', format: ['PascalCase'] },
        // Env var names (ATLASBI_DATABASE_URL) and wire-format keys are external contracts.
        {
          selector: ['objectLiteralProperty', 'typeProperty'],
          format: ['camelCase', 'UPPER_CASE'],
        },
        {
          selector: ['objectLiteralProperty', 'typeProperty'],
          modifiers: ['requiresQuotes'],
          format: null,
        },
        { selector: 'import', format: null },
      ],
      'no-restricted-imports': [
        'error',
        { paths: [DUCKDB_CLIENT, INCUBATING_SEMCONV], patterns: [INTERNALS_PATTERN] },
      ],
    },
  },
  {
    // The DuckDB adapter — and the tests that exercise it — are the only code that may see DuckDB.
    files: ['packages/warehouse/src/adapters/duckdb/**/*.ts', 'packages/warehouse/test/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [INCUBATING_SEMCONV], patterns: [INTERNALS_PATTERN] },
      ],
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'] },
        { selector: 'variable', modifiers: ['const'], format: ['camelCase', 'UPPER_CASE'] },
        { selector: 'typeLike', format: ['PascalCase'] },
        // DuckDB configuration options (extension_directory, …) are the engine's wire format.
        {
          selector: ['objectLiteralProperty', 'typeProperty'],
          format: ['camelCase', 'UPPER_CASE', 'snake_case'],
        },
        {
          selector: ['objectLiteralProperty', 'typeProperty'],
          modifiers: ['requiresQuotes'],
          format: null,
        },
        { selector: 'import', format: null },
      ],
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettierConfig,
);
