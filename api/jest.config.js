/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  // src stays in roots so coverage still reports files no test touches.
  roots: ['<rootDir>/src', '<rootDir>/test/unit'],
  testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
  setupFiles: ['<rootDir>/src/jest.setup.ts'],
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      { tsconfig: '<rootDir>/test/unit/tsconfig.json' },
    ],
  },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: 'coverage',
  testEnvironment: 'node',
};
