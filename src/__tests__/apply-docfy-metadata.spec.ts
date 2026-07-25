import fs from 'fs';
import os from 'os';
import path from 'path';
import { applyDocfyMetadata } from '../apply-docfy-metadata';
import type { OpenApiDocument } from '../cli/merge-spec-patch';

describe('applyDocfyMetadata()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docfy-apply-metadata-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const baseDocument: OpenApiDocument = {
    paths: {
      '/users': {
        get: { operationId: 'findAll', tags: ['Users'] },
      },
    },
  };

  it('merges the patch found at metadataPath into the document', () => {
    const metadataPath = path.join(tmpDir, 'docfy-metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify({ '/users': { get: { summary: 'List users' } } }), 'utf8');

    const result = applyDocfyMetadata(baseDocument, { metadataPath });
    expect((result.paths!['/users'].get as { summary?: string }).summary).toBe('List users');
    expect(result.paths!['/users'].get.operationId).toBe('findAll');
  });

  it('warns and returns the document unchanged when the metadata file is missing', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = applyDocfyMetadata(baseDocument, { metadataPath: path.join(tmpDir, 'missing.json') });

    expect(result).toEqual(baseDocument);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No build-time metadata found'));
    warnSpy.mockRestore();
  });

  it('throws when the metadata file is missing and strict is true', () => {
    expect(() =>
      applyDocfyMetadata(baseDocument, { metadataPath: path.join(tmpDir, 'missing.json'), strict: true }),
    ).toThrow(/No build-time metadata found/);
  });

  it('warns and returns the document unchanged when the metadata file has invalid JSON', () => {
    const metadataPath = path.join(tmpDir, 'docfy-metadata.json');
    fs.writeFileSync(metadataPath, '{ not valid json', 'utf8');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = applyDocfyMetadata(baseDocument, { metadataPath });
    expect(result).toEqual(baseDocument);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to parse build-time metadata'));
    warnSpy.mockRestore();
  });

  it('throws when the metadata file has invalid JSON and strict is true', () => {
    const metadataPath = path.join(tmpDir, 'docfy-metadata.json');
    fs.writeFileSync(metadataPath, '{ not valid json', 'utf8');

    expect(() => applyDocfyMetadata(baseDocument, { metadataPath, strict: true })).toThrow(
      /Failed to parse build-time metadata/,
    );
  });
});
