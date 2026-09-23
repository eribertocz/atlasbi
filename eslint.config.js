import eslint from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

// Encodes docs/21-engineering-standards.md where a linter can: naming conventions (§8)
// and "consume a package's public entry point, never its internals" (CLAUDE.md rule 2).
export default defineConfig(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.turbo/**', '**/coverage/**', 'docs/**'],
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
          patterns: [
            {
              group: ['@atlasbi/*/src', '@atlasbi/*/src/**'],
              message:
                'Import another package through its public entry point, never its internals (CLAUDE.md rule 2).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettierConfig,
);
