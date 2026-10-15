/** Synthetic compatibility vectors only. Never invoke a service or read local pairing credentials.
 * Run with Node 22.18+: node tests/native-contract/generate-pairing-vectors.mjs
 * An isolated dependency installation may set CLAWKET_FIXTURE_GENERATOR_PACKAGE to its package.json.
 */
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { extractPairingVectorSource } from './pairing-vector-source.mjs';
import { OFFICIAL_RELAY_SERVICES } from '../../packages/bridge-core/src/official-relay.ts';

const require = createRequire(process.env.CLAWKET_FIXTURE_GENERATOR_PACKAGE || new URL('../../apps/mobile/package.json', import.meta.url));
const nacl = require('tweetnacl');
const version = require('tweetnacl/package.json').version;
if (version !== '1.0.3') throw Error('Re-review vectors after TweetNaCl version changes');
const currentPairing = await readFile(new URL('../../apps/mobile/src/services/pairing-session.ts', import.meta.url), 'utf8');
const authSource = await readFile(new URL('../../apps/mobile/src/services/gateway-auth.ts', import.meta.url), 'utf8');
const { startTemplate, resultTemplate, authReturn } = extractPairingVectorSource(currentPairing, authSource);
const b64 = value => Buffer.from(value).toString('base64url');
const hex = value => Buffer.from(value).toString('hex');
const sha = value => createHash('sha256').update(value).digest();
const hmac = (key, value) => createHmac('sha256', key).update(value).digest('hex');
const sequence = (start, count) => Uint8Array.from({ length: count }, (_, index) => (start + index) % 256);
const plaintext = JSON.stringify({ k: 'cp', v: 2, b: 'codex', s: 'https://codex-registry.clawket.ai', g: 'synthetic-gateway', a: 'SYNTHETIC-ACCESS', n: 'Codex · Test device' });
const legacyCode = 'ABCD1234EFGH';
const nonce = sequence(0, 24);
const legacyKey = sha(legacyCode);
const linkKey = sequence(192, 32);
const code = '314159', sessionID = `ps_${'ab'.repeat(32)}`, requestID = 'cd'.repeat(16);
const clientSecret = sequence(32, 32), bridgeSecret = sequence(96, 32);
const client = nacl.box.keyPair.fromSecretKey(clientSecret), bridge = nacl.box.keyPair.fromSecretKey(bridgeSecret);
const secureCipher = nacl.box(Buffer.from(plaintext), nonce, client.publicKey, bridge.secretKey);
const codeKey = sha(code);
const startProof = hmac(codeKey, runInNewContext(startTemplate, { body: { sessionId: sessionID }, requestId: requestID, clientPublicKey: b64(client.publicKey) }));
const resultProof = hmac(codeKey, runInNewContext(resultTemplate, { input: { response: { sessionId: sessionID }, requestId: requestID, clientPublicKey: b64(client.publicKey) },
  result: { bridgePublicKey: b64(bridge.publicKey), nonce: b64(nonce), ciphertext: b64(secureCipher) } }));
const resultFrame = '__clawket_relay_control__:' + JSON.stringify({ type: 'control', event: 'pairing.secure.result', requestId: requestID,
  payload: { protocol: 2, sessionId: sessionID, bridgePublicKey: b64(bridge.publicKey), nonce: b64(nonce), ciphertext: b64(secureCipher), bridgeProof: resultProof } });
const sign = nacl.sign.keyPair.fromSeed(sequence(128, 32));
const deviceID = hex(sha(sign.publicKey));
const signedPayload = runInNewContext(`(() => { ${authReturn} })()`, { params: { deviceId: deviceID, clientId: 'clawket-ios', clientMode: 'ui', role: 'operator', scopes: ['operator.read', 'operator.write'],
  signedAtMs: 1700000000123, token: 'synthetic-token', nonce: 'synthetic-nonce', platform: 'ios', deviceFamily: 'iPhone' } });
const vectors = {
  provenance: { implementation: 'apps/mobile/src/services/pairing-session.ts', algorithm: `tweetnacl@${version}`, synthetic: true },
  plaintext,
  secretBox: { code: legacyCode, codeHash: hex(legacyKey), nonce: b64(nonce), ciphertext: b64(nacl.secretbox(Buffer.from(plaintext), nonce, legacyKey)),
    linkKey: b64(linkKey), linkCiphertext: b64(nacl.secretbox(Buffer.from(plaintext), nonce, linkKey)) },
  secure: { code, codeHash: hex(codeKey), sessionID, requestID, clientSecret: hex(clientSecret), clientPublic: b64(client.publicKey), bridgeSecret: hex(bridgeSecret),
    bridgePublic: b64(bridge.publicKey), nonce: b64(nonce), ciphertext: b64(secureCipher), startProof, resultProof, resultFrame },
  signing: { secretKey: hex(sign.secretKey), publicKey: hex(sign.publicKey), deviceID, signedPayload, signature: hex(nacl.sign.detached(Buffer.from(signedPayload), sign.secretKey)) },
  services: OFFICIAL_RELAY_SERVICES.map(item => ({ backend: item.backend, environment: item.environment,
    registryHost: `${item.registry}.clawket.ai`, relayHost: `${item.relay}.clawket.ai`,
    legacyRegistryHost: `${item.worker}-registry${item.suffix || ''}.clawket.workers.dev`, legacyRelayHost: `${item.worker}-relay${item.suffix || ''}.clawket.workers.dev` })),
};
const target = new URL('../../packages/apple/Tests/ClawketPairingTests/Fixtures/pairing-vectors.json', import.meta.url);
const serialized = JSON.stringify(vectors, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8') !== serialized) throw Error('Native pairing vectors differ from the current mobile contract; regenerate and review');
  console.log(`Verified ${Object.keys(vectors).length - 1} synthetic pairing contract groups`);
} else {
  await writeFile(target, serialized);
  console.log(`Generated ${Object.keys(vectors).length - 1} synthetic pairing contract groups: ${fileURLToPath(target)}`);
}
