#!/usr/bin/env node
import { BUILD_TOOLING_PEERS, findMissingPeers, missingPeerMessage } from '../optional-peer';

const missing = findMissingPeers(BUILD_TOOLING_PEERS);
if (missing.length > 0) {
  console.error(missingPeerMessage(missing, 'The nestjs-docfy CLI'));
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./index');
