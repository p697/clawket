import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import nacl from 'tweetnacl';
import WebSocket from 'ws';
import { refreshAccessCode } from '../../packages/bridge-core/dist/index.js';

const paired = await refreshAccessCode({ environment: 'preview' });
if (!paired.pairingSession) {
  throw new Error('Preview Registry did not create an encrypted pairing invitation');
}
if (paired.pairingSession.protocol !== 2 || !/^\d{6}$/.test(paired.pairingSession.pairingCode)) {
  throw new Error('Preview infrastructure did not negotiate secure six-digit pairing');
}

const invitationUrl = new URL(paired.pairingSession.pairingUrl);
const linkKey = Buffer.from(invitationUrl.hash.slice(1)
  ? new URLSearchParams(invitationUrl.hash.slice(1)).get('k') ?? ''
  : '', 'base64url');
const normalizedCode = paired.pairingSession.pairingCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
const codeKey = createHash('sha256').update(normalizedCode, 'utf8').digest();
const codeHash = codeKey.toString('hex');

const linkResponse = await fetch(
  `${paired.config.serverUrl}/v1/pair/session/${encodeURIComponent(paired.pairingSession.sessionId)}`,
);
if (!linkResponse.ok) {
  throw new Error(`Preview pairing invitation read failed with status ${linkResponse.status}`);
}
const linkPayload = decryptInvitationPayload(await linkResponse.json(), linkKey);

const codeResponse = await fetch(`${paired.config.serverUrl}/v2/pair/session/resolve`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify({ codeHash }),
});
if (!codeResponse.ok) {
  throw new Error(`Preview pairing code resolution failed with status ${codeResponse.status}`);
}
const secureResolution = await codeResponse.json();
const codePayload = await exchangeSecurePairingPayload(secureResolution, codeKey);
if (linkPayload !== paired.qrPayload || codePayload !== paired.qrPayload) {
  throw new Error('Preview pairing invitation did not resolve to the compatibility QR payload');
}

const claimResponse = await fetch(`${paired.config.serverUrl}/v1/pair/claim`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify({
    gatewayId: paired.config.gatewayId,
    accessCode: paired.accessCode,
    clientLabel: 'Preview product smoke test',
  }),
});

if (!claimResponse.ok) {
  throw new Error(`Preview pairing claim failed with status ${claimResponse.status}`);
}

const claimed = await claimResponse.json();
if (!claimed?.relayUrl || !claimed?.clientToken || !claimed?.gatewayId) {
  throw new Error('Preview pairing claim returned an incomplete response');
}

const consumedInvitationResponse = await fetch(
  `${paired.config.serverUrl}/v1/pair/session/${encodeURIComponent(paired.pairingSession.sessionId)}`,
);
if (consumedInvitationResponse.status !== 404) {
  throw new Error('Preview pairing invitation remained readable after its single-use claim');
}

const relayUrl = new URL(claimed.relayUrl);
relayUrl.searchParams.set('gatewayId', claimed.gatewayId);
relayUrl.searchParams.set('role', 'client');
relayUrl.searchParams.set('clientId', `preview-smoke-${randomUUID()}`);
relayUrl.searchParams.set('capabilities', 'relay.client-pong.v1');

const socket = new WebSocket(relayUrl, {
  headers: {
    authorization: `Bearer ${claimed.clientToken}`,
  },
});
let challengeReceived = false;
let pongRequests = 0;

try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Preview Relay challenge timed out')), 15_000);
    socket.on('message', (data) => {
      let frame;
      try {
        frame = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (frame?.type === 'tick' && frame.ack === 'relay.client-pong.v1') {
        pongRequests += 1;
        socket.send(JSON.stringify({ type: 'pong', ts: frame.ts }));
      }
      if (frame?.type === 'event' && frame.event === 'connect.challenge') {
        challengeReceived = true;
        clearTimeout(timeout);
        resolve();
      }
    });
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  process.stdout.write(JSON.stringify({
    ok: true,
    checks: [
      'preview-encrypted-link-decrypt',
      'preview-six-digit-code-resolve',
      'preview-pairing-ticket-auth',
      'preview-ephemeral-payload-decrypt',
      'preview-invitation-single-use',
      'preview-registry-claim',
      'preview-relay-client-auth',
      'preview-bridge-online',
      'openclaw-challenge-through-preview',
    ],
    challengeReceived,
    pongRequests,
  }) + '\n');
} finally {
  socket.close(1000, 'preview_product_smoke_complete');
}

function decryptInvitationPayload(response, key) {
  const encrypted = response?.encryptedPayload;
  if (!encrypted?.nonce || !encrypted?.ciphertext || key.length !== nacl.secretbox.keyLength) {
    throw new Error('Preview pairing invitation response is incomplete');
  }
  const plaintext = nacl.secretbox.open(
    Buffer.from(encrypted.ciphertext, 'base64url'),
    Buffer.from(encrypted.nonce, 'base64url'),
    key,
  );
  if (!plaintext) {
    throw new Error('Preview pairing invitation decryption failed');
  }
  return Buffer.from(plaintext).toString('utf8');
}

async function exchangeSecurePairingPayload(resolution, codeKey) {
  if (resolution?.protocol !== 2
    || typeof resolution.sessionId !== 'string'
    || typeof resolution.gatewayId !== 'string'
    || typeof resolution.relayUrl !== 'string'
    || typeof resolution.relayTicket !== 'string') {
    throw new Error('Preview secure pairing resolution was incomplete');
  }
  const clientKeys = nacl.box.keyPair();
  const clientPublicKey = Buffer.from(clientKeys.publicKey).toString('base64url');
  const requestId = randomBytes(16).toString('hex');
  const clientProof = createHmac('sha256', codeKey)
    .update(`clawket-pair-v2:start:${resolution.sessionId}:${requestId}:${clientPublicKey}`, 'utf8')
    .digest('hex');
  const relayUrl = new URL(resolution.relayUrl);
  relayUrl.searchParams.set('gatewayId', resolution.gatewayId);
  relayUrl.searchParams.set('role', 'client');
  relayUrl.searchParams.set('clientId', `preview-pair-${randomUUID()}`);
  relayUrl.searchParams.set('token', resolution.relayTicket);
  const pairingSocket = new WebSocket(relayUrl);
  try {
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Preview secure pairing handshake timed out')), 15_000);
      pairingSocket.once('open', () => {
        pairingSocket.send(`__clawket_relay_control__:${JSON.stringify({
          type: 'control',
          event: 'pairing.secure.start',
          requestId,
          payload: {
            protocol: 2,
            sessionId: resolution.sessionId,
            clientPublicKey,
            clientProof,
          },
        })}`);
      });
      pairingSocket.on('message', (data) => {
        const text = data.toString();
        if (!text.startsWith('__clawket_relay_control__:')) return;
        let frame;
        try {
          frame = JSON.parse(text.slice('__clawket_relay_control__:'.length));
        } catch {
          return;
        }
        if (frame?.requestId !== requestId) return;
        if (frame?.event === 'pairing.secure.error') {
          clearTimeout(timeout);
          reject(new Error('Preview Bridge rejected the secure pairing handshake'));
          return;
        }
        if (frame?.event !== 'pairing.secure.result') return;
        clearTimeout(timeout);
        resolve(frame.payload);
      });
      pairingSocket.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    const bridgePublicKey = Buffer.from(result?.bridgePublicKey ?? '', 'base64url');
    const nonce = Buffer.from(result?.nonce ?? '', 'base64url');
    const ciphertext = Buffer.from(result?.ciphertext ?? '', 'base64url');
    const expectedProof = createHmac('sha256', codeKey)
      .update(
        `clawket-pair-v2:result:${resolution.sessionId}:${requestId}:${clientPublicKey}:${result?.bridgePublicKey}:${result?.nonce}:${result?.ciphertext}`,
        'utf8',
      )
      .digest('hex');
    if (result?.sessionId !== resolution.sessionId || result?.bridgeProof !== expectedProof) {
      throw new Error('Preview secure pairing response proof was invalid');
    }
    const plaintext = nacl.box.open(ciphertext, nonce, bridgePublicKey, clientKeys.secretKey);
    if (!plaintext) throw new Error('Preview secure pairing payload decryption failed');
    return Buffer.from(plaintext).toString('utf8');
  } finally {
    pairingSocket.close(1000, 'preview_secure_pairing_smoke_complete');
  }
}
