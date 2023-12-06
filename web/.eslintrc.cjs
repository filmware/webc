const path = require('path');

module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
    'prettier',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  overrides: [
    {
      files: ['**/*.ts', '**/*.tsx'],
      parserOptions: {
        project: true,
        tsconfigRootDir: path.resolve(__dirname, '../../../'),
      },
      rules: {
        '@typescript-eslint/switch-exhaustiveness-check': 'error',
        'no-fallthrough': 'off',
      },
    },
    {
      files: ['**/*.tsx'],
      rules: {
        '@typescript-eslint/explicit-module-boundary-types': 'off',
      }
    }
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaFeatures: { jsx: true },
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  plugins: ['import', 'react', 'react-hooks', 'react-refresh', 'sort-keys-fix'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    // Can disagree with @typescript-eslint/member-ordering.
    '@typescript-eslint/adjacent-overload-signatures': 'off',
    '@typescript-eslint/explicit-module-boundary-types': [
      'error',
      { allowArgumentsExplicitlyTypedAsAny: true },
    ],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { args: 'after-used', ignoreRestSiblings: true },
    ],
    '@typescript-eslint/prefer-optional-chain': ['error'],
    'array-element-newline': ['error', 'consistent'],
    'arrow-parens': ['error', 'always'],
    'arrow-spacing': ['error', { after: true, before: true }],
    'block-spacing': ['error', 'always'],
    'brace-style': ['error', '1tbs', { allowSingleLine: true }],
    'comma-dangle': ['error', 'always-multiline'],
    'comma-spacing': ['error', { after: true, before: false }],
    'eol-last': ['error', 'always'],
    'eqeqeq': ['error', 'smart'],
    'import/extensions': ['warn', { ts: 'never', tsx: 'never', css: 'always' }],
    'import/order': [
      'error',
      {
        'alphabetize': { caseInsensitive: true, order: 'asc' },
        'groups': ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        'newlines-between': 'always',
      },
    ],
    'indent': 'off',
    'jsx-quotes': ['error', 'prefer-double'],
    'key-spacing': [
      'error',
      {
        multiLine: {
          afterColon: true,
          beforeColon: false,
          mode: 'strict',
        },
        singleLine: {
          afterColon: true,
          beforeColon: false,
        },
      },
    ],
    'keyword-spacing': ['error'],
    'no-console': ['error', { allow: ['error'] }],
    'no-duplicate-imports': 'error',
    'no-empty': ['error', { allowEmptyCatch: false }],
    'no-multi-spaces': ['error', { ignoreEOLComments: true }],
    'no-multiple-empty-lines': ['error', { max: 1, maxBOF: 0, maxEOF: 0 }],
    'no-restricted-imports': ['error', { patterns: ['..*'] }],
    'no-throw-literal': 'error',
    'no-trailing-spaces': ['error', {}],
    'no-unused-vars': 'off',
    'object-curly-spacing': ['error', 'always'],
    'object-property-newline': ['error', { allowAllPropertiesOnSameLine: true }],
    'quote-props': ['error', 'consistent-as-needed'],
    'quotes': ['error', 'single', { avoidEscape: true }],
    'react/display-name': 'off',
    'react/jsx-closing-bracket-location': [
      'error',
      {
        nonEmpty: 'after-props',
        selfClosing: 'tag-aligned',
      },
    ],
    'react/jsx-closing-tag-location': ['error'],
    'react/jsx-curly-spacing': ['error', { children: false, when: 'never' }],
    'react/jsx-equals-spacing': ['error', 'never'],
    'react/jsx-first-prop-new-line': ['error', 'multiline-multiprop'],
    'react/jsx-indent': ['error', 2],
    'react/jsx-max-props-per-line': ['error', { when: 'multiline' }],
    'react/jsx-newline': ['error', { prevent: true }],
    'react/jsx-sort-props': [
      'error',
      {
        callbacksLast: true,
        ignoreCase: true,
      },
    ],
    'react/jsx-tag-spacing': [
      'error',
      {
        afterOpening: 'never',
        beforeClosing: 'never',
        beforeSelfClosing: 'always',
        closingSlash: 'never',
      },
    ],
    'react/jsx-uses-react': 'off',
    'react/jsx-wrap-multilines': ['error', { assignment: false, declaration: false }],
    'react/prop-types': 'off',
    'react/react-in-jsx-scope': 'off',
    'react/self-closing-comp': [
      'error',
      {
        component: true,
        html: true,
      },
    ],
    'react-hooks/exhaustive-deps': 'error',
    'require-await': 'error',
    'semi': ['error', 'never'],
    'sort-imports': [
      'error',
      {
        ignoreCase: true,
        ignoreDeclarationSort: true,
        ignoreMemberSort: false,
      },
    ],
    'sort-keys-fix/sort-keys-fix': [
      'error',
      'asc',
      {
        caseSensitive: false,
        natural: true,
      },
    ],
    'space-in-parens': ['error', 'never'],
    'space-infix-ops': ['error', { int32Hint: true }],
  },
  settings: {
    'import/resolver': { typescript: {} }, // This loads <rootdir>/tsconfig.json to eslint
    'react': { version: 'detect' },
  },
}