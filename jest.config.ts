import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        moduleResolution: 'node',
        target: 'ES2020',
        strict: true,
        esModuleInterop: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        skipLibCheck: true,
      },
    }],
  },
  collectCoverageFrom: ['**/*.(t|j)s', '!**/__tests__/**'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};

export default config;
