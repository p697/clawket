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

const ENGINES: ReadonlyArray<NonNullable<LocalModelEndpoint['engine']>> = ['llamacpp', 'ollama', 'openai-compatible'];
const SERVER_ADVICE = 'Start llama.cpp, Ollama or another OpenAI-compatible server first, or pass --base-url and --engine for a server on a different address.';

function describeFetchFailure(error: unknown): string {
  const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
  if (cause?.code === 'ECONNREFUSED') return 'connection refused';
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'no response within 10 seconds';
  return error instanceof Error ? error.message : String(error);
}

/**
 * Lists the models a server exposes through the OpenAI-compatible `/v1/models`
 * route. A bare `fetch failed` is what a user sees when nothing is listening,
 * so every failure names the address and what to start or pass instead.
 */
export async function discoverLocalModelEndpoints(baseUrl: string, engine: string, fetchImpl: typeof fetch = fetch): Promise<LocalModelEndpoint[]> {
  if (!ENGINES.includes(engine as LocalModelEndpoint['engine'] & string)) throw new Error(`Unsupported model engine "${engine}". Use --engine llamacpp, ollama or openai-compatible.`);
  const normalized = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  let response: Response;
  try {
    response = await fetchImpl(normalized + '/v1/models', { signal: AbortSignal.timeout(10_000), redirect: 'error' });
  } catch (error) {
    throw new Error(`No model server answered at ${normalized} (${describeFetchFailure(error)}). ${SERVER_ADVICE}`);
  }
  if (!response.ok) throw new Error(`The server at ${normalized} answered HTTP ${response.status} for /v1/models, so it is not an OpenAI-compatible model server. ${SERVER_ADVICE}`);
  let body: { data?: { id?: unknown }[] };
  try { body = await response.json() as typeof body; }
  catch { throw new Error(`The server at ${normalized} did not return a JSON model list. ${SERVER_ADVICE}`); }
  const endpoints = (Array.isArray(body?.data) ? body.data : []).flatMap(model => typeof model?.id === 'string' && model.id.length > 0 ? [{
    id: model.id, name: model.id, model: model.id, baseUrl: normalized, contextWindow: 8192, maxOutputTokens: 1024,
    engine: engine as LocalModelEndpoint['engine'],
  }] : []);
  if (!endpoints.length) throw new Error(`The server at ${normalized} lists no models. Load a model first (for example \`ollama pull <model>\` or a llama.cpp --models-preset), then pair again.`);
  return endpoints;
}

async function post<T>(url: string, body: object): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000), redirect: 'error' });
  if (!response.ok) throw new Error(`Pairing Registry returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

/** One foreground command keeps the Bridge and its secure pairing responder alive. */
export async function handleLocalModelCommand(args: string[]): Promise<void> {
  // A detached supervisor owns only this child. IPC loss must not leave an orphan.
  let requestStop: (() => void) | undefined;
  const supervisorStop = () => { if (requestStop) requestStop(); else process.exit(0); };
  const supervisorMessage = (message: unknown) => {
    if (message && typeof message === 'object' && (message as { type?: string }).type === 'clawket.local-model.stop') supervisorStop();
  };
  if (process.send) { process.once('disconnect', supervisorStop); process.on('message', supervisorMessage); }
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
    else endpoints = await discoverLocalModelEndpoints(flag(args, '--base-url') ?? 'http://127.0.0.1:8080', flag(args, '--engine') ?? 'llamacpp');
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
      requestStop = stop;
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
    });
  } finally {
    process.off('disconnect', supervisorStop); process.off('message', supervisorMessage);
    relay?.stop(); await server.stop();
    if (process.connected) process.disconnect();
  }
}
