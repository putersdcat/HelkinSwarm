// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'warn',
    },
  },
  // Enforce core/skills boundary: src/ must never import from skills/
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../../skills/*', '../skills/*', '*/skills/*'],
          message: 'Core code (src/) must not import from skills/. Skills are loaded dynamically by the capability loader.',
        }],
      }],
    },
  },
  // Enforce skill isolation: skills must not import from other skills
  {
    files: ['skills/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../../skills/*', '../skills/*', '*/skills/*'],
          message: 'Skills must not import from other skills. Each skill domain must be independent.',
        }],
      }],
    },
  },
  {
    ignores: ['dist/', 'node_modules/', '*.js', '*.mjs'],
  },
);
