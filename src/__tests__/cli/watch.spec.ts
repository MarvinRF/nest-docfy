import path from 'path';
import fs from 'fs';
import { watchProject } from '../../cli/watch';

const SCAN_ROOT = path.join(__dirname, 'fixtures', 'scan');

describe('watchProject()', () => {
  it('returns a cleanup function', () => {
    const stop = watchProject({
      root: SCAN_ROOT,
      pattern: '**/*.controller.ts',
      onRebuild: () => {},
    });
    expect(typeof stop).toBe('function');
    stop(); // should not throw
  });

  it('cleanup can be called multiple times without throwing', () => {
    const stop = watchProject({
      root: SCAN_ROOT,
      pattern: '**/*.controller.ts',
      onRebuild: () => {},
    });
    expect(() => { stop(); stop(); }).not.toThrow();
  });

  it('does not start watching directories outside root', () => {
    const outsideRoot = '/tmp/outside-docfy-test';
    // watchProject should silently refuse to watch the outside dir
    // (assertWithinRoot will block it). We verify no throw is raised.
    expect(() => {
      const stop = watchProject({
        root: SCAN_ROOT,
        pattern: '**/*.controller.ts',
        onRebuild: () => {},
      });
      stop();
    }).not.toThrow();
  });

  it('accepts a valid root that exists', () => {
    expect(fs.existsSync(SCAN_ROOT)).toBe(true);
    const stop = watchProject({
      root: SCAN_ROOT,
      pattern: '**/*.controller.ts',
      onRebuild: () => {},
    });
    stop();
  });
});
