import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          target: 'ES2020',
          strict: true,
          esModuleInterop: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          skipLibCheck: true,
          allowJs: true,
        },
      },
    ],
  },
  // @fastify/static 10 require()s the ESM-only content-disposition 3, which Node loads natively
  // (require(esm)) but Jest 29's module runtime can't — transpile just that package to CJS.
  transformIgnorePatterns: ['/node_modules/(?!(.*/)?content-disposition/)'],
  collectCoverageFrom: ['**/*.(t|j)s', '!**/__tests__/**'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};

export default config;
