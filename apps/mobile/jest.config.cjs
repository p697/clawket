/** @type {import('jest').Config} */
const config = {
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.jest.json',
      diagnostics: false,
    }],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(tweetnacl|js-sha256)/)',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  setupFiles: ['./jest.setup.ts'],
  testEnvironment: 'node',
  moduleNameMapper: {
    '^react-native$': '<rootDir>/__mocks__/react-native.ts',
    '^@mattermost/react-native-paste-input$': '<rootDir>/__mocks__/react-native-paste-input.tsx',
  },
};

module.exports = config;
