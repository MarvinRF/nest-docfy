import path from 'path';

jest.mock('../../plugin/generate-metadata', () => ({
  ...jest.requireActual('../../plugin/generate-metadata'),
  generateDocfyMetadata: jest.fn(),
}));

import { before } from '../../plugin';
import { generateDocfyMetadata } from '../../plugin/generate-metadata';

const mockedGenerate = generateDocfyMetadata as jest.Mock;

function fakeProgram(compilerOptions: Record<string, unknown>): any {
  return { getCompilerOptions: () => compilerOptions };
}

describe('before() — nestjs-docfy CLI plugin entry', () => {
  beforeEach(() => {
    mockedGenerate.mockReset();
    mockedGenerate.mockReturnValue({
      outFile: '/x/docfy-metadata.json',
      patchedOperationCount: 0,
      controllersWithoutDocs: [],
      unparseableDocsFiles: [],
      scanErrors: [],
    });
  });

  it('throws when no program reference is provided', () => {
    expect(() => before({}, undefined)).toThrow(/program.*must be provided/i);
  });

  it('throws when the program has no resolvable tsconfig path', () => {
    const program = fakeProgram({});
    expect(() => before({}, program)).toThrow(/could not determine the tsconfig path/i);
  });

  it('derives projectRoot from the tsconfig directory and calls generateDocfyMetadata', () => {
    const program = fakeProgram({ configFilePath: '/project/tsconfig.json', outDir: '/project/dist' });
    before({}, program);

    expect(mockedGenerate).toHaveBeenCalledWith({
      tsConfigFilePath: '/project/tsconfig.json',
      projectRoot: '/project',
      outDir: '/project/dist',
      controllerGlob: undefined,
    });
  });

  it('falls back to <projectRoot>/dist when compilerOptions has no outDir', () => {
    const program = fakeProgram({ configFilePath: '/project/tsconfig.json' });
    before({}, program);

    expect(mockedGenerate).toHaveBeenCalledWith(expect.objectContaining({ outDir: path.join('/project', 'dist') }));
  });

  it('respects an explicit projectRoot/controllerGlob override', () => {
    const program = fakeProgram({ configFilePath: '/project/tsconfig.json', outDir: '/project/dist' });
    before({ projectRoot: '/custom/root', controllerGlob: '**/*.ctrl.ts' }, program);

    expect(mockedGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ projectRoot: '/custom/root', controllerGlob: '**/*.ctrl.ts' }),
    );
  });

  it('returns an identity transformer that leaves the source file untouched', () => {
    const program = fakeProgram({ configFilePath: '/project/tsconfig.json', outDir: '/project/dist' });
    const transformerFactory = before({}, program);
    const identity = transformerFactory({} as any);
    const sourceFile = { kind: 'fake-source-file' } as any;
    expect(identity(sourceFile)).toBe(sourceFile);
  });

  it('warns instead of throwing when generateDocfyMetadata itself fails', () => {
    mockedGenerate.mockImplementation(() => {
      throw new Error('scan blew up');
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const program = fakeProgram({ configFilePath: '/project/tsconfig.json', outDir: '/project/dist' });

    expect(() => before({}, program)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('scan blew up'));
    warnSpy.mockRestore();
  });
});
