module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
    sourceType: 'module',
    ecmaVersion: 2022,
  },
  env: {
    node: true,
    es2022: true,
    jest: true,
  },
  plugins: [
    '@typescript-eslint',
    'import',
    'node',
    'prettier'
  ],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/errors',
    'plugin:import/warnings',
    'plugin:node/recommended',
    'plugin:prettier/recommended',
    'prettier',
  ],
  rules: {
    'prettier/prettier': ['error'],
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'off',
    'no-console': 'warn',
    'import/order': ['error', {
      'groups': [['builtin', 'external'], ['internal']],
      'newlines-between': 'always',
      'alphabetize': { order: 'asc', caseInsensitive: true }
    }],
    'node/no-unsupported-features/es-syntax': ['error', { ignores: ['modules'] }],
  },
  settings: {
    'import/resolver': {
      typescript: {}
    }
  },
  ignorePatterns: ['dist/', 'node_modules/', '*.js'],
};


