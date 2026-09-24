// Config commune à toutes les extensions Pulse Suite — garder ce fichier identique d'un repo à
// l'autre (seul le tableau `files` varie si le repo a des .tsx ou un dossier test/).
// Voir HARMONISATION.md, phase 1.
const js = require('@eslint/js');
const tseslintPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');

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
      },
    },
    plugins: {
      '@typescript-eslint': tseslintPlugin,
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
    },
  },
];
