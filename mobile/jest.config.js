module.exports = {
  preset: 'ts-jest',
  watchman: false,
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.ts?(x)', '**/?(*.)+(spec|test).ts?(x)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        jsx: 'react',
      },
    }],
  },
  // Binary asset extensions are resolved to a numeric handle by Metro.
  // In Jest (non-Metro), return a stub number so require('./model.tflite') works.
  moduleNameMapper: {
    '\\.tflite$': '<rootDir>/src/__mocks__/fileMock.js',
    '\\.onnx$': '<rootDir>/src/__mocks__/fileMock.js',
    '\\.(png|jpe?g)$': '<rootDir>/src/__mocks__/fileMock.js',
  },
};
