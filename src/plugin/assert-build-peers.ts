import { BUILD_TOOLING_PEERS, findMissingPeers, missingPeerMessage } from '../optional-peer';

// Imported first by the plugin entry, before anything that loads ts-morph, so a missing peer
// fails the Nest build with the install command instead of a bare MODULE_NOT_FOUND.
const missing = findMissingPeers(BUILD_TOOLING_PEERS.filter((name) => name === 'ts-morph'));
if (missing.length > 0) throw new Error(missingPeerMessage(missing, 'The nestjs-docfy compiler plugin'));
