import globals from 'globals';
import stylistic from '@stylistic/eslint-plugin';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', '**/*.d.ts'],
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      '@stylistic': stylistic,
      '@typescript-eslint': typescript,
    },
    rules: {
      'prefer-const': 'error',
      'no-var': 'error',
      'no-unused-vars': 'off',
      'one-var': ['error', 'never'],
      'func-style': ['error', 'declaration'],
      'no-console': ['warn'],
      'id-length': ['error', {
        min: 2,
        exceptions: ['i', 'j', 'k', 'x', 'y', 'z', 'id', 'ok', 'no'],
        properties: 'never',
      }],
      '@typescript-eslint/no-unused-vars': ['error', {
        ignoreRestSiblings: true,
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/ban-ts-comment': ['warn'],
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/indent': ['error', 2, { SwitchCase: 1 }],
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@stylistic/space-before-function-paren': ['error', 'never'],
      '@stylistic/nonblock-statement-body-position': ['error', 'beside'],
      '@stylistic/brace-style': ['error', 'stroustrup'],
      '@stylistic/no-multiple-empty-lines': ['error', { max: 3 }],
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: 'import', next: '*' },
        { blankLine: 'never', prev: 'import', next: 'import' },
        { blankLine: 'always', prev: 'type', next: 'export' },
        { blankLine: 'always', prev: 'interface', next: 'export' },
        { blankLine: 'always', prev: 'const', next: 'export' },
        { blankLine: 'always', prev: 'let', next: 'export' },
        { blankLine: 'always', prev: 'function', next: 'export' },
      ],
    },
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './.config/tsconfig.json',
      },
    },
    rules: {
      '@typescript-eslint/no-magic-numbers': ['error', {
        ignore: [-1, 0, 1],
        ignoreArrayIndexes: true,
        ignoreDefaultValues: true,
        ignoreNumericLiteralTypes: true,
        ignoreReadonlyClassProperties: true,
        ignoreTypeIndexes: true,
        ignoreEnums: true,
      }],
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'default',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'parameter',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'function',
          format: ['camelCase'],
        },
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
        {
          selector: 'interface',
          format: ['PascalCase'],
          custom: {
            regex: '^I[A-Z]',
            match: false,
          },
        },
        {
          selector: 'enumMember',
          format: ['UPPER_CASE', 'PascalCase'],
        },
        {
          selector: 'classProperty',
          format: ['camelCase', 'UPPER_CASE'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'objectLiteralProperty',
          format: ['camelCase', 'UPPER_CASE', 'snake_case'],
        },
      ],
      '@typescript-eslint/prefer-readonly': ['warn'],
    },
  },
];