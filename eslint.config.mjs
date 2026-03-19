import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'build/',
      '**/dist/**',
      '**/build/**',
      'coverage/',
      '**/coverage/**',
      'node_modules/',
      '**/node_modules/**',
      '.wrangler/',
      '**/.wrangler/**',
      'packages/game/src/**/*.js',
      'packages/game/src/**/*.jsx',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'no-console': 'warn',
      'no-debugger': 'error',
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-template': 'warn',
    },
  },
  {
    files: ['*.config.{js,mjs,cjs,ts}', 'scripts/**/*.{js,ts}', 'packages/manual/build.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  prettierConfig
)
