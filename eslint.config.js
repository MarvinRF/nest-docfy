const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const eslintPluginPrettier = require('eslint-plugin-prettier/recommended');
const globals = require('globals');

module.exports = tseslint.config(
  {
    ignores: ['dist', 'coverage', 'src/__tests__/cli/fixtures/**'],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  eslintPluginPrettier,
);
