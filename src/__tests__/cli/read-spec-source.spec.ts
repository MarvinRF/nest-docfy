import fs from 'fs';
import os from 'os';
import path from 'path';
import { readSpecSource } from '../../cli/read-spec-source';
import { CliError } from '../../cli/errors';

describe('readSpecSource()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docfy-read-spec-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete (globalThis as any).fetch;
  });

  it('reads and parses a local JSON file', async () => {
    const specPath = path.join(tmpDir, 'openapi.json');
    fs.writeFileSync(specPath, JSON.stringify({ openapi: '3.0.0', info: { title: 'X' } }));

    const doc = await readSpecSource(specPath, tmpDir);
    expect(doc).toEqual({ openapi: '3.0.0', info: { title: 'X' } });
  });

  it('throws a CliError when the local file does not exist', async () => {
    await expect(readSpecSource(path.join(tmpDir, 'missing.json'), tmpDir)).rejects.toThrow(CliError);
  });

  it('throws a CliError when the local file is not valid JSON', async () => {
    const specPath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(specPath, '{not json');
    await expect(readSpecSource(specPath, tmpDir)).rejects.toThrow(/did not contain valid JSON/);
  });

  it('fetches from an http(s) URL instead of reading a local file', async () => {
    (globalThis as any).fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ openapi: '3.0.0', info: { title: 'Remote' } }),
    }));

    const doc = await readSpecSource('https://api.example.com/api-json', tmpDir);
    expect(doc).toEqual({ openapi: '3.0.0', info: { title: 'Remote' } });
    expect(globalThis.fetch).toHaveBeenCalledWith('https://api.example.com/api-json');
  });

  it('throws a CliError when the URL fetch responds with a non-OK status', async () => {
    (globalThis as any).fetch = jest.fn(async () => ({ ok: false, status: 404 }));
    await expect(readSpecSource('https://api.example.com/api-json', tmpDir)).rejects.toThrow(/HTTP 404/);
  });
});
