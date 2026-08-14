import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import { createRequire } from 'node:module';
import tseslint from 'typescript-eslint';

const require = createRequire(import.meta.url);

/** @type {import('eslint').Linter.Config[]} */
const reactHooksConfigs = (() => {
  try {
    const reactHooks = require('eslint-plugin-react-hooks');
    return [
      {
        files: ['apps/web/**/*.{ts,tsx}'],
        ignores: ['**/*.{spec,test}.{ts,tsx}'],
        plugins: { 'react-hooks': reactHooks },
        rules: {
          ...reactHooks.configs.recommended.rules,
        },
      },
    ];
  } catch {
    return [];
  }
})();

/** @type {import('eslint').Linter.Config[]} */
const jsxA11yConfigs = (() => {
  // Required for apps/web — do not soft-fail. Upstream still peers on eslint ^3–9 while
  // this repo is on eslint 10; package.json pnpm.peerDependencyRules.allowedVersions
  // documents that until eslint-plugin-jsx-a11y ships an eslint-10-compatible release.
  const jsxA11y = require('eslint-plugin-jsx-a11y');
  const recommended = jsxA11y.flatConfigs.recommended;
  return [
    {
      ...recommended,
      name: 'kurultay/jsx-a11y',
      files: ['apps/web/**/*.tsx'],
    },
  ];
})();

/** @type {import('eslint').Linter.Config[]} */
const nextConfigs = (() => {
  try {
    const nextPlugin = require('@next/eslint-plugin-next');
    return [
      {
        files: ['apps/web/**/*.{ts,tsx}'],
        ignores: ['**/*.{spec,test}.{ts,tsx}'],
        plugins: { '@next/next': nextPlugin },
        rules: {
          ...nextPlugin.configs.recommended.rules,
          ...nextPlugin.configs['core-web-vitals'].rules,
        },
      },
    ];
  } catch {
    return [];
  }
})();

const typeAwareSourceFiles = [
  'apps/api/src/**/*.ts',
  'apps/web/**/*.{ts,tsx}',
  'packages/*/src/**/*.ts',
];

const typeAwareIgnores = [
  '**/*.{spec,test}.{ts,tsx}',
  'apps/api/src/generated/**',
  '**/*.config.ts',
  '**/vitest.config.ts',
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      'apps/api/src/generated/**',
      // Playwright's generated output. `e2e/playwright-report` in particular is a bundled
      // HTML app with its own JavaScript, which ESLint would happily spend a minute parsing.
      'e2e/test-results/**',
      'e2e/playwright-report/**',
      'e2e/blob-report/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ['**/*.{ts,tsx,mjs}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // Type-aware rules only on production sources (specs/e2e are excluded from app tsconfigs).
  {
    files: typeAwareSourceFiles,
    ignores: typeAwareIgnores,
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },
  ...reactHooksConfigs,
  ...nextConfigs,
  ...jsxA11yConfigs,
);
