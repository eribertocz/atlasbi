import eslint from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import svelte from 'eslint-plugin-svelte';
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
const ECHARTS_MESSAGE =
  'ECharts types never cross the adapter boundary (docs/22): only apps/web/src/lib/visualization/echarts/ may import it.';
const ECHARTS = { name: 'echarts', message: ECHARTS_MESSAGE };
const ECHARTS_SUBPATHS = { group: ['echarts/*'], message: ECHARTS_MESSAGE };
const BETTER_AUTH_MESSAGE =
  'better-auth types never cross the adapter boundary (docs/21 §3.2): use IdentityPort from @atlasbi/contracts and @atlasbi/auth.';
const BETTER_AUTH = { name: 'better-auth', message: BETTER_AUTH_MESSAGE };
const BETTER_AUTH_SUBPATHS = {
  group: ['better-auth/*', '@better-auth/*'],
  message: BETTER_AUTH_MESSAGE,
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
      '**/.svelte-kit/**',
      'apps/web/build/**',
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
        {
          paths: [DUCKDB_CLIENT, BETTER_AUTH, INCUBATING_SEMCONV, ECHARTS],
          patterns: [INTERNALS_PATTERN, BETTER_AUTH_SUBPATHS, ECHARTS_SUBPATHS],
        },
      ],
    },
  },
  {
    // The better-auth adapter — and the tests that exercise it — are the only code that may see
    // better-auth.
    files: ['packages/auth/src/adapters/better-auth/**/*.ts', 'packages/auth/test/**/*.ts'],
    rules: {
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
        {
          paths: [BETTER_AUTH, INCUBATING_SEMCONV],
          patterns: [INTERNALS_PATTERN, BETTER_AUTH_SUBPATHS],
        },
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
  // Svelte components (apps/web): the same TypeScript rules inside <script lang="ts">.
  ...svelte.configs.recommended,
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte'],
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Types — unused names included — are svelte-check's job; DOM names are not variables
      // ESLint could resolve.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-restricted-imports': [
        'error',
        {
          paths: [DUCKDB_CLIENT, BETTER_AUTH, INCUBATING_SEMCONV, ECHARTS],
          patterns: [INTERNALS_PATTERN, BETTER_AUTH_SUBPATHS, ECHARTS_SUBPATHS],
        },
      ],
    },
  },
  {
    // Components copied from shadcn-svelte (docs/08 §11.2): `href` arrives as a prop, already
    // resolved by whoever passes it.
    files: ['apps/web/src/lib/components/ui/**'],
    rules: { 'svelte/no-navigation-without-resolve': 'off' },
  },
  {
    // The ECharts adapter — and its tests — are the only code that may see ECharts (docs/22).
    files: ['apps/web/src/lib/visualization/echarts/**', 'apps/web/test/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [DUCKDB_CLIENT, BETTER_AUTH, INCUBATING_SEMCONV],
          patterns: [INTERNALS_PATTERN, BETTER_AUTH_SUBPATHS],
        },
      ],
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Cube's configuration runs inside the Cube container, as CommonJS (docs/04 §6).
    files: ['packages/semantic/cube/**/*.js', 'packages/semantic/cube/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
      },
    },
  },
  prettierConfig,
);
