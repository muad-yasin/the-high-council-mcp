// A preload for a CLI child (`node --import test/helpers/fixed-envelope-id-preload.js src/cli.js ...`): the review_id of the verdict envelope is a constant for that process (the test seam setEnvelopeRandom, src/verdict-envelope.js), so a test that
// compares prompt bytes or prompt hashes between two runs, or pins them, gets the same text each time WITHOUT masking anything in it. The envelope stays ON: the shipped state is what is measured. The id differs from the wrong id the mock
// critic's `w` mode echoes ('ffffffffffff'). Test data only; a constant id is for digests, never for a test of how a reply is matched to its call.
import { setEnvelopeRandom } from '../../src/verdict-envelope.js';

setEnvelopeRandom(() => '0123456789ab');
