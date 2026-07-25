import * as fs from 'fs';
import * as path from 'path';
import { SourceMapConsumer, RawSourceMap } from 'source-map';

export interface StackLocation {
  file: string;
  line: number;
  column: number;
}

const STACK_FRAME_RE = /\(?([^()\s]+):(\d+):(\d+)\)?\s*$/;

/**
 * Parses a V8 stack trace string (as captured by `new Error().stack`) and
 * returns the call site of whatever invoked the function that captured it.
 *
 * The first frame (right after the "Error" header line) is always the
 * capturing function's own location — that's a property of how
 * `Error().stack` works, unaffected by bundling — so it's always skipped
 * unconditionally rather than identified by file path: after bundling,
 * both that frame and the real caller's frame report the *same* bundle
 * file (just different line/column), so a filename-based skip can't tell
 * them apart, but a positional one always can.
 *
 * Used as a fallback when `resolveDocsPath`'s require.cache lookup fails —
 * which happens whenever the app is bundled (e.g. NestJS CLI's `webpack:
 * true` build mode, the documented default for monorepos), since bundlers
 * inline every module into one file and never populate Node's require.cache
 * with one entry per original source file.
 */
export function parseCallSite(stack: string | undefined): StackLocation | null {
  if (!stack) return null;
  const lines = stack.split('\n').slice(2); // drop "Error" header + the capturing function's own frame

  for (const rawLine of lines) {
    const match = STACK_FRAME_RE.exec(rawLine.trim());
    if (!match) continue;
    const [, file, lineStr, colStr] = match;
    if (!file) continue;
    if (file.includes(`${path.sep}node_modules${path.sep}`)) continue;
    return { file, line: Number(lineStr), column: Number(colStr) };
  }
  return null;
}

function loadSourceMap(bundleFile: string): RawSourceMap | null {
  const sidecarPath = `${bundleFile}.map`;
  if (fs.existsSync(sidecarPath)) {
    try {
      return JSON.parse(fs.readFileSync(sidecarPath, 'utf8')) as RawSourceMap;
    } catch {
      return null;
    }
  }

  try {
    const contents = fs.readFileSync(bundleFile, 'utf8');
    const match =
      /\/\/[#@]\s*sourceMappingURL=data:application\/json;(?:charset=[^;]+;)?base64,([a-zA-Z0-9+/=]+)\s*$/m.exec(
        contents,
      );
    if (!match) return null;
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    return JSON.parse(decoded) as RawSourceMap;
  } catch {
    return null;
  }
}

/**
 * Given a location inside a (possibly bundled) compiled file, resolves it
 * back to the original source file path using that file's source map, if
 * one is available (sidecar `.map` file or an inlined `sourceMappingURL`
 * data URI — both of which NestJS CLI's webpack build emits by default).
 *
 * Returns the input location's file unchanged if no source map is found or
 * it fails to resolve a source for that position — the caller falls back
 * to its existing behavior in that case.
 */
export function resolveOriginalPath(loc: StackLocation): string {
  // If something in the process already registered automatic stack
  // source-mapping (e.g. ts-node, or webpack/Node's own source-map
  // support), `loc.file` may already be a `webpack://<namespace>/<path>`
  // URI rather than a real bundle file path — Node's resolved it for us,
  // it just left the result in webpack's own URI form. There's no real
  // file to read a `.map` sidecar from in that case (the bundle path is
  // gone), so resolve this directly instead of going through
  // loadSourceMap/SourceMapConsumer below.
  const directWebpackSource = stripWebpackProtocol(loc.file);
  if (directWebpackSource) return path.resolve(process.cwd(), directWebpackSource);

  const map = loadSourceMap(loc.file);
  if (!map) return loc.file;

  try {
    const consumer = new SourceMapConsumer(map);
    const original = consumer.originalPositionFor({ line: loc.line, column: loc.column });
    if (!original.source) return loc.file;

    const webpackSource = stripWebpackProtocol(original.source);
    if (webpackSource) {
      // webpack's own sourceRoot/source values are namespace URIs, not real
      // paths — e.g. "webpack://api-gateway/./apps/api-gateway/src/x.ts" —
      // so for these we resolve relative to the process's cwd (the project
      // root in standard `nest start`/`nest build` usage) instead of mapDir.
      return path.resolve(process.cwd(), webpackSource);
    }

    const mapDir = path.dirname(loc.file);
    const sourceRoot = map.sourceRoot ?? '';
    return path.resolve(mapDir, sourceRoot, original.source);
  } catch {
    return loc.file;
  }
}

/**
 * Strips a `webpack://<namespace>/` prefix from a source-map `source` entry,
 * returning the remaining relative path, or null if it isn't a webpack URI.
 */
function stripWebpackProtocol(source: string): string | null {
  const match = /^webpack:\/\/[^/]*\/(.*)$/.exec(source);
  return match ? match[1] : null;
}
