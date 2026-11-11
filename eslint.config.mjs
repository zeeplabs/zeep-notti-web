import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/', 'dist/', 'coverage/'] },
  js.configs.recommended,
  {
    // The sample is plain browser JS and a Node script, outside the TS project.
    files: ['examples/**/*.js'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        Notification: 'readonly',
        JSON: 'readonly',
      },
    },
  },
  {
    files: ['examples/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly' },
    },
  },
  ...tseslint.configs.recommended,
  prettier
);
