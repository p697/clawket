import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { buildPairingSessionDraft, securePairingCodeKeyHex } from '@clawket/bridge-core';
import { LocalModelConversation, LocalModelServer, LocalModelService, LocalModelRelay, type LocalModelEndpoint, type LocalModelRelayConfig } from '@clawket/bridge-runtime';
import QRCode from 'qrcode';
import { ensureLocalModelRouter, type LocalModelLauncher } from './local-model-launcher.js';

const PREVIEW = 'https://clawket-local-model-registry-preview.clawket.workers.dev';
interface RuntimeConfig { endpoints: LocalModelEndpoint[]; token: string; relay?: LocalModelRelayConfig; launcher?: LocalModelLauncher }

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

async function post<T>(url: string, body: object): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000), redirect: 'error' });
  if (!response.ok) throw new Error(`Pairing Registry returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

/** One foreground command keeps the Bridge and its secure pairing responder alive. */
export async function handleLocalModelCommand(args: string[]): Promise<void> {
  const command = args[0] ?? 'pair';
  if (!['pair', 'run'].includes(command)) throw new Error('Use local-model pair or local-model run');
  const directory = join(homedir(), '.clawket', 'local-model-preview');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const configPath = resolve(flag(args, '--config') ?? join(directory, 'runtime.json'));
  const save = (config: RuntimeConfig) => {
    mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
    writeFileSync(configPath + '.pending', JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(configPath + '.pending', configPath);
  };
  let config: RuntimeConfig;
  if (command === 'run') {
    config = JSON.parse(readFileSync(configPath, 'utf8')) as RuntimeConfig;
    if (config.launcher) await ensureLocalModelRouter(config.launcher, dirname(configPath));
  } else {
    const executable = flag(args, '--llama-server');
    const preset = flag(args, '--models-preset');
    if (Boolean(executable) !== Boolean(preset)) throw new Error('Provide both --llama-server and --models-preset');
    const launcher = executable && preset ? { executable: resolve(executable), preset: resolve(preset), baseUrl: flag(args, '--base-url') ?? 'http://127.0.0.1:8080' } : undefined;
    if (launcher) await ensureLocalModelRouter(launcher, dirname(configPath));
    const endpointFile = flag(args, '--endpoints');
    let endpoints: LocalModelEndpoint[];
    if (endpointFile) endpoints = JSON.parse(readFileSync(resolve(endpointFile), 'utf8'));
    else {
      const baseUrl = (flag(args, '--base-url') ?? 'http://127.0.0.1:8080').replace(/\/+$/, '').replace(/\/v1$/, '');
      const engine = flag(args, '--engine') ?? 'llamacpp';
      if (!['llamacpp', 'ollama', 'openai-compatible'].includes(engine)) throw new Error('Unsupported model engine');
      const response = await fetch(baseUrl + '/v1/models', { signal: AbortSignal.timeout(10_000), redirect: 'error' });
      if (!response.ok) throw new Error(`Cannot discover local models: HTTP ${response.status}`);
      const body = await response.json() as { data?: { id: string }[] };
      endpoints = (body.data ?? []).filter(model => typeof model.id === 'string' && model.id.length > 0).map(model => ({
        id: model.id, name: model.id, model: model.id, baseUrl, contextWindow: 8192, maxOutputTokens: 1024,
        engine: engine as LocalModelEndpoint['engine'],
      }));
    }
    config = { endpoints, token: randomBytes(32).toString('hex'), launcher };
  }
  const conversation = new LocalModelConversation(config.endpoints, join(dirname(configPath), 'conversation.json'));
  await conversation.select(conversation.selection);
  const server = new LocalModelServer(conversation, config.token);
  const port = Number(flag(args, '--port') ?? 17880);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid Bridge port');
  await server.start(port);
  let relay: LocalModelRelay | undefined;
  try {
    let code: string | undefined;
    let qrPayload: string | undefined;
    if (command === 'pair') {
      const registryUrl = flag(args, '--registry') ?? PREVIEW;
      const origin = new URL(registryUrl);
      if (origin.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(origin.hostname)) throw new Error('Registry requires HTTPS');
      const registered = await post<{ gatewayId: string; relaySecret: string; relayUrl: string; accessCode: string }>(registryUrl.replace(/\/$/, '') + '/v1/pair/register', { displayName: flag(args, '--name') ?? 'Local model' });
      if (!registered.gatewayId || !registered.relaySecret || !registered.relayUrl || !registered.accessCode) throw new Error('Invalid registration response');
      qrPayload = JSON.stringify({ v: 2, k: 'cp', b: 'local-model', s: registryUrl, g: registered.gatewayId, a: registered.accessCode, n: flag(args, '--name') ?? 'Local model' });
      const draft = buildPairingSessionDraft({ ...registered, qrPayload });
      const invitation = await post<{ sessionId: string; expiresAt: string; capabilities?: string[] }>(registryUrl.replace(/\/$/, '') + '/v1/pair/session', draft.request);
      if (!invitation.capabilities?.includes('pairing.secure-short-code.v2') || !/^ps_[a-f0-9]{64}$/.test(invitation.sessionId) || !Number.isFinite(Date.parse(invitation.expiresAt))) throw new Error('Registry does not support secure six-digit pairing');
      config.relay = { relayUrl: registered.relayUrl, gatewayId: registered.gatewayId, relaySecret: registered.relaySecret,
        invitation: { sessionId: invitation.sessionId, expiresAt: invitation.expiresAt, codeKeyHex: securePairingCodeKeyHex(draft.shortPairingCode), qrPayload, attempts: 0 } };
      code = draft.shortPairingCode; save(config);
    }
    if (!config.relay) throw new Error('Pair the local model Bridge before running it');
    relay = new LocalModelRelay(new LocalModelService(conversation), config.relay, invitation => { config.relay!.invitation = invitation; save(config); }, message => console.error(message));
    relay.start();
    await relay.waitUntilReady();
    if (code && qrPayload) {
      console.log(`Pairing code: ${code}`);
      console.log(await QRCode.toString(qrPayload, { type: 'terminal', small: true }));
      const output = flag(args, '--qr-file');
      if (output) await QRCode.toFile(resolve(output), qrPayload);
    }
    console.log('Local model Bridge is running. Keep this process open; press Ctrl+C to stop.');
    await new Promise<void>(resolve => {
      const stop = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); resolve(); };
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
    });
  } finally { relay?.stop(); await server.stop(); }
}
