import { execFileSync } from 'child_process';
import * as path from 'path';
import { findMissingPeers, missingPeerMessage, requireOptionalPeer } from '../optional-peer';

describe('optional peers', () => {
  it('lists only the peers that cannot be resolved', () => {
    expect(findMissingPeers(['ts-morph', 'docfy-not-a-real-package'])).toEqual(['docfy-not-a-real-package']);
  });

  it('builds a message naming the feature and the exact install command', () => {
    const message = missingPeerMessage(['ts-morph', 'commander'], 'The nestjs-docfy CLI');
    expect(message).toContain('The nestjs-docfy CLI needs the optional peer dependencies "ts-morph", "commander"');
    expect(message).toContain('npm install --save-dev ts-morph commander');
  });

  it('omits --save-dev for runtime peers', () => {
    expect(missingPeerMessage(['express'], 'DocfyUiModule', false)).toContain('npm install express\n');
  });

  it('throws the friendly message for a missing peer', () => {
    expect(() => requireOptionalPeer('docfy-not-a-real-package', 'Some feature')).toThrow(
      'npm install --save-dev docfy-not-a-real-package',
    );
  });

  it('loads an installed peer', () => {
    expect(typeof requireOptionalPeer<typeof import('picocolors')>('picocolors', 'x').green).toBe('function');
  });
});

describe('CLI bin', () => {
  it('starts the CLI when the build tooling peers are installed', () => {
    const bin = path.resolve(__dirname, '../../dist/cli/bin.js');
    const out = execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
    expect(out).toContain('Usage:');
  });
});
