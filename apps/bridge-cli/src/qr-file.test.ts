import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPairingQrPayload, type PairingInfo } from '@clawket/bridge-core';
import { resolveQrOutputPath, writePairingQrPng } from './qr-file.js';

const PAIRING: PairingInfo = {
  config: {
    serverUrl: 'https://registry.example.com',
    gatewayId: 'gw_test_123',
    relaySecret: 'secret',
    relayUrl: 'wss://relay.example.com/ws',
    instanceId: 'inst_test',
    displayName: 'Lucy',
    createdAt: '2026-03-08T00:00:00.000Z',
    updatedAt: '2026-03-08T00:00:00.000Z',
  },
  accessCode: 'AB7K9Q',
  accessCodeExpiresAt: '2026-03-08T01:00:00.000Z',
  qrPayload: buildPairingQrPayload({
    server: 'https://registry.example.com',
    gatewayId: 'gw_test_123',
    accessCode: 'AB7K9Q',
  }),
  action: 'registered',
};

describe('qr file helpers', () => {
  it('uses the default PNG path under the clawket qr directory', () => {
    const path = resolveQrOutputPath(PAIRING.config.gatewayId);
    expect(path).toMatch(/\.openclaw[/\\]media[/\\]gw_test_123\.png$/);
  });

  it('resolves relative output paths to absolute paths', () => {
    const path = resolveQrOutputPath(PAIRING.config.gatewayId, 'tmp/bridge.png');
    expect(path).toMatch(/tmp[/\\]bridge\.png$/);
    expect(isAbsolute(path)).toBe(true);
  });

  it('writes a PNG QR artifact for an alphanumeric access code payload', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'clawket-qr-'));
    const outputPath = join(tempDir, 'pair.png');

    try {
      const writtenPath = await writePairingQrPng(PAIRING, outputPath);
      const png = readFileSync(writtenPath);

      expect(writtenPath).toBe(outputPath);
      expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(png.length).toBeGreaterThan(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
