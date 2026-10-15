import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { extractPairingVectorSource } from './pairing-vector-source.mjs';

const pairing = await readFile(new URL('../../apps/mobile/src/services/pairing-session.ts', import.meta.url), 'utf8');
const auth = await readFile(new URL('../../apps/mobile/src/services/gateway-auth.ts', import.meta.url), 'utf8');

test('extracts the three current consumer expressions for native golden vectors', () => {
  const result = extractPairingVectorSource(pairing, auth);
  assert.equal(Object.keys(result).length, 3);
  assert.match(result.startTemplate, /body\.sessionId/);
  assert.match(result.resultTemplate, /result\.ciphertext/);
  assert.match(result.authReturn, /params\.deviceFamily/);
});

test('missing empty malformed and ambiguous consumer source fail closed', () => {
  for (const [left, right] of [[null, auth], ['', auth], [pairing, ''], [pairing, null],
    [pairing.replace('nacl.box.open(', 'removed('), auth], [pairing.replace('nacl.secretbox.open(', 'removed('), auth],
    [pairing.replace('clawket-pair-v2:start:', 'retired:'), auth], [pairing + '\n`clawket-pair-v2:start:duplicate`', auth],
    [pairing, auth.replace('export function buildDeviceAuthPayload', 'function removed')],
    [pairing, auth.replace("].join('|');", '].join(\",\");')]]) {
    assert.throws(() => extractPairingVectorSource(left, right));
  }
});
