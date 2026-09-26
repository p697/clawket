import { piControl, startPiBackground } from './pi-lifecycle.js';
import { openSync, readSync, closeSync, fstatSync, mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, unlinkSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { buildPairingSessionDraft, securePairingCodeKeyHex } from '@clawket/bridge-core';
import { PiService, PiServer, PiRelay, inspectPiInstallation, type PiRelayConfig } from '@clawket/bridge-runtime';
import QRCode from 'qrcode';

interface Config { agentDirectory?: string; nativeSessionDirectory?: string; project: string; token: string; command: string; port: number; host: string; relay?: PiRelayConfig }
function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name); if (i < 0) return undefined;
  const value = args[i + 1]; if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`); return value;
}
async function post<T>(url: string, body: object): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000), redirect: 'error' });
  if (!response.ok) throw new Error(`Pi Registry returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
export async function handlePiCommand(args: string[]): Promise<void> {
  const command = args[0] ?? 'pair';
  if (!['pair', 'run', 'doctor', 'status', 'start', 'restart', 'stop', 'logs', 'reset'].includes(command)) throw new Error('Use pi pair, run, start, restart, stop, status, doctor, logs or reset');
  const project = realpathSync(resolve(flag(args, '--project') ?? process.cwd()));
  const projectId = createHash('sha256').update(project).digest('hex').slice(0, 16);
  const configPath = resolve(flag(args, '--config') ?? join(homedir(), '.clawket', 'pi', projectId, 'runtime.json'));
  const directory = dirname(configPath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const save = (value: Config) => { writeFileSync(configPath + '.pending', JSON.stringify(value, null, 2), { mode: 0o600 }); renameSync(configPath + '.pending', configPath); };
  let config: Config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : { project, agentDirectory: flag(args, '--agent-dir') ?? process.env.PI_CODING_AGENT_DIR, nativeSessionDirectory: flag(args, '--sessions-dir'), command: flag(args, '--pi-command') ?? 'pi', token: randomBytes(32).toString('hex'), port: Number(flag(args, '--port') ?? (18000 + parseInt(projectId.slice(0, 4), 16) % 20000)), host: '127.0.0.1' };
  if (command === 'pair' && flag(args, '--port')) config.port = Number(flag(args, '--port'));
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('Invalid Pi Bridge port');
  if (command === 'logs') {
    const log = join(directory, 'pi.log');
    if (!existsSync(log)) { console.log('No Pi Bridge logs yet.'); return; }
    const fd = openSync(log, 'r');
    try { const size = fstatSync(fd).size; const buffer = Buffer.alloc(Math.min(size, 32000)); readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length)); console.log(buffer.toString('utf8')); }
    finally { closeSync(fd); }
    return;
  }
  if (['status', 'doctor', 'stop', 'restart', 'reset', 'start'].includes(command)) {
    let health: { model: string; modelReady: boolean } | undefined;
    try { health = await piControl(config); } catch { /* An offline runtime may be started or diagnosed below. */ }
    if (command === 'status') { console.log(`Pi · ${basename(config.project)}: ${health ? 'ready' : 'offline'}`); return; }
    if (command === 'doctor' && health) { console.log(`Pi RPC: ready\nModel: ${health.modelReady ? 'configured' : 'run pi and /login in this project'}`); return; }
    if (['stop', 'restart', 'reset'].includes(command) && health) {
      await piControl(config, 'bridge.stop');
      const deadline = Date.now() + 10000;
      while (existsSync(join(directory, 'sessions', 'owner.lock'))) { if (Date.now() > deadline) throw new Error('Pi is still stopping; retry after it exits.'); await new Promise(r => setTimeout(r, 100)); }
    }
    if (command === 'reset') { if (existsSync(join(directory, 'sessions', 'owner.lock'))) throw new Error('Stop the Pi owner before resetting pairing'); if (existsSync(configPath)) unlinkSync(configPath); console.log('Pi pairing cleared. Session history retained.'); return; }
    if (command === 'stop') { console.log(health ? 'Pi Bridge stopped.' : 'Pi Bridge is offline.'); return; }
    if (command === 'start' && health) { console.log('Pi Bridge is already running.'); return; }
    if (command === 'start' || command === 'restart') { if (!existsSync(configPath)) throw new Error('Pair this project first'); await startPiBackground(['run', '--config', configPath], join(directory, 'pi.log')); return; }
  }
  if (command === 'pair' && !args.includes('--foreground')) {
    await startPiBackground([...args, '--config', configPath], join(directory, 'pi.log')); return;
  }
  const show = (text: string) => { if (process.send) process.send({ type: 'pi.display', text }); else console.log(text); };
  const installed = await inspectPiInstallation(config.command);
  const service = new PiService({ project: config.project, directory: join(directory, 'sessions'), command: config.command, agentDirectory: config.agentDirectory, nativeSessionDirectory: config.nativeSessionDirectory });
  let server: PiServer | undefined, relay: PiRelay | undefined;
  try {
    const health = await service.health() as { model: string; modelReady: boolean };
    if (command === 'doctor') { console.log(`Pi ${installed.version} RPC: ready\nModel: ${health.modelReady ? 'configured' : 'not configured — run pi and /login in this project'}\nProject: ${basename(config.project)}`); return; }
    let qrPayload: string | undefined, code: string | undefined;
    if (command === 'pair') {
      if (args.includes('local') || args.includes('--local')) {
        config.host = flag(args, '--host') ?? '0.0.0.0'; config.relay = undefined;
        const address = flag(args, '--address') ?? Object.values(networkInterfaces()).flat().find(a => a?.family === 'IPv4' && !a.internal)?.address;
        if (!address) throw new Error('No LAN address found. Supply --address reachable-from-phone');
        qrPayload = JSON.stringify({ version: 1, backendKind: 'pi', mode: 'local', url: `ws://${address}:${config.port}/v1/pi/ws`, token: config.token });
      } else {
        const registryUrl = flag(args, '--registry') ?? 'https://clawket-pi-registry.clawket.workers.dev';
        const url = new URL(registryUrl);
        if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Pi Registry requires HTTPS');
        const registered = await post<{ gatewayId: string; relaySecret: string; relayUrl: string; accessCode: string }>(registryUrl.replace(/\/$/, '') + '/v1/pair/register', { displayName: `Pi · ${basename(config.project)}` });
        if (!registered.gatewayId || !registered.relaySecret || !registered.relayUrl || !registered.accessCode) throw new Error('Invalid Pi registration');
        qrPayload = JSON.stringify({ v: 2, k: 'cp', b: 'pi', s: registryUrl, g: registered.gatewayId, a: registered.accessCode, n: `Pi · ${basename(config.project)}` });
        const draft = buildPairingSessionDraft({ ...registered, qrPayload });
        config.host = '127.0.0.1'; config.relay = { relayUrl: registered.relayUrl, gatewayId: registered.gatewayId, relaySecret: registered.relaySecret };
        try {
          const invitation = await post<{ sessionId: string; expiresAt: string; capabilities?: string[] }>(registryUrl.replace(/\/$/, '') + '/v1/pair/session', draft.request);
          if (invitation.capabilities?.includes('pairing.secure-short-code.v2') && /^ps_[a-f0-9]{64}$/.test(invitation.sessionId) && Number.isFinite(Date.parse(invitation.expiresAt))) {
            config.relay.invitation = { ...invitation, codeKeyHex: securePairingCodeKeyHex(draft.shortPairingCode), qrPayload, attempts: 0 }; code = draft.shortPairingCode;
          }
        } catch { console.error('Code invitation unavailable; scan the QR code instead.'); }
      }
      save(config);
    } else if (!existsSync(configPath)) throw new Error('Pair this Pi project first');
    server = new PiServer(service, config.token, message => console.error(message)); await server.start(config.port, config.host);
    if (config.relay) {
      relay = new PiRelay(service, config.relay, invitation => { config.relay!.invitation = invitation; save(config); }, message => console.error(message));
      relay.start(); await relay.waitUntilReady();
    }
    if (code) show(`Pairing code: ${code}`);
    if (qrPayload) { show(await QRCode.toString(qrPayload, { type: 'terminal', small: true })); const output = flag(args, '--qr-file'); if (output) await QRCode.toFile(resolve(output), qrPayload); }
    show(process.send ? `Pi · ${basename(config.project)} is running in the background. Use clawket pi status / stop from this project.` : `Pi · ${basename(config.project)} is running. Keep this terminal open. Ctrl+C stops Clawket-owned Pi sessions.`);
    if (!health.modelReady) show('Configure a model on this computer with pi and /login before chatting.');
    await new Promise<void>(done => { const stop = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); service.off('shutdown', stop); done(); }; process.once('SIGINT', stop); process.once('SIGTERM', stop); service.once('shutdown', stop); process.send?.({ type: 'pi.ready' }); });
  } finally { relay?.stop(); if (server) await server.stop(); else await service.stop(); }
}
