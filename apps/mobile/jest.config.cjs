/** @type {import('jest').Config} */
const config = {
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.jest.json',
      diagnostics: false,
    }],
    // remend ships ESM only; Babel lowers it for the CommonJS test runtime.
    'node_modules/remend/dist/index\\.js$': 'babel-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(tweetnacl|js-sha256|remend)/)',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  setupFiles: ['./jest.setup.ts'],
  testEnvironment: 'node',
  moduleNameMapper: {
    // remend exposes only an `import` export condition, which Jest's CommonJS resolver skips.
    '^remend$': '<rootDir>/node_modules/remend/dist/index.js',
    '^react-native$': '<rootDir>/__mocks__/react-native.ts',
    '^@mattermost/react-native-paste-input$': '<rootDir>/__mocks__/react-native-paste-input.tsx',
  },
};

module.exports = config;
