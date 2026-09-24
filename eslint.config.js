// Config commune à toutes les extensions Pulse Suite — garder ce fichier identique d'un repo à
// l'autre (seul le tableau `files` varie si le repo a des .tsx ou un dossier test/).
// Voir HARMONISATION.md, phase 1.
const js = require('@eslint/js');
const tseslintPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const simpleImportSort = require('eslint-plugin-simple-import-sort');

module.exports = [
  {
    ignores: ['dist/**', 'out/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'test/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        // Type-aware rules (no-floating-promises) need the project graph. tsconfig.json's
        // `include` already covers test/**/*.ts alongside src, so one project serves both.
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslintPlugin,
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      ...js.configs.recommended.rules,
      // Turns off the base rules TypeScript already enforces (no-undef among them — without this
      // every Node/DOM global (process, AbortController, document...) would be flagged, since flat
      // config defines no globals of its own). Same fix as FabricPulse's eslint.config.js.
      ...tseslintPlugin.configs['flat/eslint-recommended'].rules,
      ...tseslintPlugin.configs.recommended.rules,
      // ignoreRestSiblings couvre l'idiome `const { secret: _s, ...rest } = obj` utilisé pour
      // retirer une clé : la variable extraite est volontairement inutilisée.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],

      // Phase 1b hardening (HARMONISATION.md) — all autofixable via `eslint --fix`.
      '@typescript-eslint/consistent-type-imports': 'warn',
      'simple-import-sort/imports': 'warn',
      'simple-import-sort/exports': 'warn',
      // Redundant now that `private` already says it: see HARMONISATION.md decision to drop the
      // `_` prefix from private class members. dbt Forge already has zero such members, so this
      // is a no-op guard rail. Does not touch the unused-parameter idiom (`argsIgnorePattern:
      // '^_'` above), which is a different idiom.
      '@typescript-eslint/naming-convention': [
        'warn',
        {
          selector: ['classProperty', 'classMethod', 'accessor', 'parameterProperty'],
          modifiers: ['private'],
          format: ['camelCase'],
          leadingUnderscore: 'forbid',
        },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
];
