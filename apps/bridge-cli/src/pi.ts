import { handleAgentDiagnostics } from './operations.js';
import { piControl, startPiBackground } from './pi-lifecycle.js';
import { agentPairProgress, type Progress } from './progress.js';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, unlinkSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { buildPairingSessionDraft, securePairingCodeKeyHex } from '@clawket/bridge-core';
import { PiService, PiServer, PiRelay, inspectPiInstallation, type PiRelayConfig } from '@clawket/bridge-runtime';
import QRCode from 'qrcode';

interface Config { agentDirectory?: string; nativeSessionDirectory?: string; project: string; token: string; command: string; port: number; host: string; relay?: PiRelayConfig & { registryUrl?: string } }
function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name); if (i < 0) return undefined;
  const value = args[i + 1]; if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`); return value;
}
async function post<T>(url: string, body: object): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000), redirect: 'error' });
  if (!response.ok) throw new Error(`Pi Registry returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function registryIdentity(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Cannot verify the original Pi Registry. Use a separate --config for a new pairing.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Cannot verify the original Pi Registry. Use a separate --config for a new pairing.'); }
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) {
    throw new Error('Cannot verify the original Pi Registry. Use a separate --config for a new pairing.');
  }
  return url.toString().replace(/\/+$/, '');
}

/** A live owner keeps its sessions and invitation in memory. Refresh only its QR access code. */
async function refreshRunningPair(args: string[], config: Config, show: (text: string) => void): Promise<void> {
  const differentScope = () => { throw new Error('Keep the running Pi pairing scope and options unchanged. Use a separate --config for a different target.'); };
  if (flag(args, '--project') && realpathSync(resolve(flag(args, '--project')!)) !== realpathSync(config.project)) differentScope();
  const nativePath = (value: string) => resolve(config.project, value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value);
  for (const [name, saved] of [['--agent-dir', config.agentDirectory], ['--sessions-dir', config.nativeSessionDirectory]] as const) {
    const requested = flag(args, name);
    if (requested && (!saved || nativePath(requested) !== nativePath(saved))) differentScope();
  }
  if (flag(args, '--pi-command') && flag(args, '--pi-command') !== config.command) differentScope();
  if (flag(args, '--port') && Number(flag(args, '--port')) !== config.port) differentScope();
  if (flag(args, '--host') && flag(args, '--host') !== config.host) differentScope();
  if (args.includes('--preview')) throw new Error('Pi Preview requires its original --registry and isolated --config; do not change a running pairing.');
  const local = args.includes('local') || args.includes('--local');
  if (local === Boolean(config.relay)) differentScope();
  let qrPayload: string;
  if (config.relay) {
    if (flag(args, '--address')) differentScope();
    const previous = config.relay;
    let registry = previous.registryUrl === undefined ? undefined : registryIdentity(previous.registryUrl);
    if (previous.invitation) {
      let payload: any;
      try { payload = JSON.parse(previous.invitation.qrPayload); } catch { throw new Error('Cannot verify the original Pi Registry invitation.'); }
      if (payload?.v !== 2 || payload.k !== 'cp' || payload.b !== 'pi' || payload.g !== previous.gatewayId) throw new Error('Cannot verify the original Pi Registry invitation.');
      const fromInvitation = registryIdentity(payload.s);
      if (registry && registry !== fromInvitation) throw new Error('The saved Pi Registry identities disagree. Keep the running owner unchanged.');
      registry = fromInvitation;
    }
    if (!registry) throw new Error('Cannot verify the original Pi Registry. Keep the running owner unchanged; use a separate --config for a new pairing.');
    if (flag(args, '--registry') && registryIdentity(flag(args, '--registry')) !== registry) throw new Error('Use the same Pi Registry as the running owner, or a separate --config.');
    const refreshed = await post<{ accessCode: string; gatewayId?: string; relayUrl?: string }>(registry + '/v1/pair/access-code', { gatewayId: previous.gatewayId, relaySecret: previous.relaySecret });
    if (!refreshed || typeof refreshed.accessCode !== 'string' || !refreshed.accessCode.trim() || refreshed.accessCode.length > 256
      || (refreshed.gatewayId !== undefined && refreshed.gatewayId !== previous.gatewayId)
      || (refreshed.relayUrl !== undefined && refreshed.relayUrl !== previous.relayUrl)) throw new Error('Invalid Pi pairing refresh response');
    qrPayload = JSON.stringify({ v: 2, k: 'cp', b: 'pi', s: registry, g: previous.gatewayId, a: refreshed.accessCode, n: `Pi · ${basename(config.project)}` });
    show('Pi is already running. Scan the new QR code to pair; six-digit code refresh is unavailable while it stays running. Existing phone connections and tasks are unchanged.');
  } else {
    if (flag(args, '--registry')) differentScope();
    const wildcard = config.host === '0.0.0.0' || config.host === '::';
    const address = flag(args, '--address') ?? (wildcard ? Object.values(networkInterfaces()).flat().find(a => a?.family === 'IPv4' && !a.internal)?.address : config.host);
    if (!address) throw new Error('No LAN address found. Supply --address reachable-from-phone');
    if (!wildcard && address !== config.host) differentScope();
    qrPayload = JSON.stringify({ version: 1, backendKind: 'pi', mode: 'local', url: `ws://${address}:${config.port}/v1/pi/ws`, token: config.token });
    show('Pi is already running. Scan this QR code to pair. Existing phone connections and tasks are unchanged.');
  }
  show(await QRCode.toString(qrPayload, { type: 'terminal', small: true }));
  const output = flag(args, '--qr-file'); if (output) await QRCode.toFile(resolve(output), qrPayload);
}

export async function handlePiCommand(args: string[]): Promise<void> {
  const progress = agentPairProgress(args, 'pi', 'Pi');
  try { await runPiCommand(args, progress); }
  catch (error) { progress.fail(); throw error; }
  finally { progress.stop(); }
}

async function runPiCommand(args: string[], progress: Progress): Promise<void> {
  const command = args[0] ?? 'pair';
  if (await handleAgentDiagnostics('pi', args)) return;
  if (!['pair', 'run', 'doctor', 'status', 'start', 'restart', 'stop', 'logs', 'reset'].includes(command)) throw new Error('Use pi pair, run, start, restart, stop, status, doctor, logs or reset');
  const requestedProject = resolve(flag(args, '--project') ?? process.cwd());
  const project = flag(args, '--config') && !existsSync(requestedProject) ? requestedProject : realpathSync(requestedProject);
  const projectId = createHash('sha256').update(project).digest('hex').slice(0, 16);
  const configPath = resolve(flag(args, '--config') ?? join(homedir(), '.clawket', 'pi', projectId, 'runtime.json'));
  const directory = dirname(configPath);
  if (!existsSync(configPath) && ['start', 'restart', 'stop', 'reset', 'run'].includes(command)) {
    if (command === 'stop' || command === 'reset') {
      const message = 'Pi has no saved pairing at this scope.';
      console.log(args.includes('--json') ? JSON.stringify({ ok: true, message, configPath }) : message); return;
    }
    throw new Error('Pair this connection first, or select its original --config / --project.');
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const save = (value: Config) => { writeFileSync(configPath + '.pending', JSON.stringify(value, null, 2), { mode: 0o600 }); renameSync(configPath + '.pending', configPath); };
  let config: Config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : { project, agentDirectory: flag(args, '--agent-dir') ?? process.env.PI_CODING_AGENT_DIR, nativeSessionDirectory: flag(args, '--sessions-dir'), command: flag(args, '--pi-command') ?? 'pi', token: randomBytes(32).toString('hex'), port: Number(flag(args, '--port') ?? (18000 + parseInt(projectId.slice(0, 4), 16) % 20000)), host: '127.0.0.1' };
  const show = (text: string) => { if (process.send) process.send({ type: 'pi.display', text }); else { progress.succeed(); console.log(text); } };
  if (command === 'pair' && existsSync(configPath)) {
    let running = false;
    try { await piControl(config); running = true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ECONNREFUSED' || existsSync(join(directory, 'sessions', 'owner.lock'))) {
        throw new Error('Cannot verify the existing Pi Bridge safely. Check clawket pi status / logs with the same pairing options; the owner has not been changed.');
      }
    }
    if (running) { progress.update('Refreshing the Pi pairing code…'); await refreshRunningPair(args, config, show); process.send?.({ type: 'pi.ready' }); return; }
  }
  if (command === 'pair' && flag(args, '--port')) config.port = Number(flag(args, '--port'));
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('Invalid Pi Bridge port');
  if (['stop', 'restart', 'reset', 'start'].includes(command)) {
    let health: { model: string; modelReady: boolean } | undefined;
    const explicitStop = ['stop', 'restart', 'reset'].includes(command);
    let stoppedOwned = false;
    if (explicitStop) {
      try { await piControl(config, 'bridge.stop'); stoppedOwned = true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ECONNREFUSED') throw error; }
    } else {
      try { health = await piControl(config); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ECONNREFUSED') throw error; }
    }
    if (!health && !stoppedOwned && ['pair', 'start', 'restart'].includes(command) && existsSync(join(directory, 'sessions', 'owner.lock'))) {
      throw new Error('The saved Pi owner is locked without verified health. Inspect logs before starting another runtime.');
    }
    if (stoppedOwned) {
      const deadline = Date.now() + 10000;
      while (existsSync(join(directory, 'sessions', 'owner.lock'))) { if (Date.now() > deadline) throw new Error('Pi is still stopping; retry after it exits.'); await new Promise(r => setTimeout(r, 100)); }
    }
    if (command === 'reset') { if (existsSync(join(directory, 'sessions', 'owner.lock'))) throw new Error('Stop the Pi owner before resetting pairing'); if (existsSync(configPath)) unlinkSync(configPath); console.log(args.includes('--json') ? JSON.stringify({ ok: true, backend: 'pi', configPath, historyRetained: true }) : 'Pi pairing cleared. Session history retained.'); return; }
    if (command === 'stop') { console.log(stoppedOwned ? 'Pi Bridge stopped.' : 'Pi Bridge is offline.'); return; }
    if (command === 'start' && health) { console.log('Pi Bridge is already running.'); return; }
    if (command === 'start' || command === 'restart') { if (!existsSync(configPath)) throw new Error('Pair this project first'); await startPiBackground(['run', '--config', configPath], join(directory, 'pi.log')); return; }
  }
  progress.update('Starting Pi…');
  if (command === 'pair' && !args.includes('--foreground')) {
    await startPiBackground([...args, '--config', configPath], join(directory, 'pi.log'), progress); return;
  }
  await inspectPiInstallation(config.command);
  const service = new PiService({ project: config.project, directory: join(directory, 'sessions'), command: config.command, agentDirectory: config.agentDirectory, nativeSessionDirectory: config.nativeSessionDirectory });
  let server: PiServer | undefined, relay: PiRelay | undefined;
  try {
    const health = await service.health() as { model: string; modelReady: boolean };
    let qrPayload: string | undefined, code: string | undefined;
    if (command === 'pair') {
      if (args.includes('local') || args.includes('--local')) {
        config.host = flag(args, '--host') ?? '0.0.0.0'; config.relay = undefined;
        const address = flag(args, '--address') ?? Object.values(networkInterfaces()).flat().find(a => a?.family === 'IPv4' && !a.internal)?.address;
        if (!address) throw new Error('No LAN address found. Supply --address reachable-from-phone');
        qrPayload = JSON.stringify({ version: 1, backendKind: 'pi', mode: 'local', url: `ws://${address}:${config.port}/v1/pi/ws`, token: config.token });
      } else {
        progress.update('Requesting a pairing code for Pi…');
        const registryUrl = flag(args, '--registry') ?? 'https://clawket-pi-registry.clawket.workers.dev';
        const url = new URL(registryUrl);
        if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Pi Registry requires HTTPS');
        const registered = await post<{ gatewayId: string; relaySecret: string; relayUrl: string; accessCode: string }>(registryUrl.replace(/\/$/, '') + '/v1/pair/register', { displayName: `Pi · ${basename(config.project)}` });
        if (!registered.gatewayId || !registered.relaySecret || !registered.relayUrl || !registered.accessCode) throw new Error('Invalid Pi registration');
        qrPayload = JSON.stringify({ v: 2, k: 'cp', b: 'pi', s: registryUrl, g: registered.gatewayId, a: registered.accessCode, n: `Pi · ${basename(config.project)}` });
        const draft = buildPairingSessionDraft({ ...registered, qrPayload });
        config.host = '127.0.0.1'; config.relay = { registryUrl, relayUrl: registered.relayUrl, gatewayId: registered.gatewayId, relaySecret: registered.relaySecret };
        try {
          const invitation = await post<{ sessionId: string; expiresAt: string; capabilities?: string[] }>(registryUrl.replace(/\/$/, '') + '/v1/pair/session', draft.request);
          if (invitation.capabilities?.includes('pairing.secure-short-code.v2') && /^ps_[a-f0-9]{64}$/.test(invitation.sessionId) && Number.isFinite(Date.parse(invitation.expiresAt))) {
            config.relay.invitation = { ...invitation, codeKeyHex: securePairingCodeKeyHex(draft.shortPairingCode), qrPayload, attempts: 0 }; code = draft.shortPairingCode;
          }
        } catch { console.error('Code invitation unavailable; scan the QR code instead.'); }
      }
      save(config);
    } else if (!existsSync(configPath)) throw new Error('Pair this Pi project first');
    server = new PiServer(service, config.token, message => console.error(`[${Date.now()}] ${message}`)); await server.start(config.port, config.host);
    if (config.relay) {
      progress.update('Connecting to Clawket Relay…');
      relay = new PiRelay(service, config.relay, invitation => { config.relay!.invitation = invitation; save(config); }, message => console.error(`[${Date.now()}] ${message}`));
      relay.start(); await relay.waitUntilReady();
    }
    if (code) show(`Pairing code: ${code}`);
    if (qrPayload) { show(await QRCode.toString(qrPayload, { type: 'terminal', small: true })); const output = flag(args, '--qr-file'); if (output) await QRCode.toFile(resolve(output), qrPayload); }
    show(process.send ? `Pi · ${basename(config.project)} is running in the background. Use clawket pi status / stop from this project.` : `Pi · ${basename(config.project)} is running. Keep this terminal open. Ctrl+C stops Clawket-owned Pi sessions.`);
    if (!health.modelReady) show('Configure a model on this computer with pi and /login before chatting.');
    await new Promise<void>(done => { const stop = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); service.off('shutdown', stop); done(); }; process.once('SIGINT', stop); process.once('SIGTERM', stop); service.once('shutdown', stop); process.send?.({ type: 'pi.ready' }); });
  } finally { relay?.stop(); if (server) await server.stop(); else await service.stop(); }
}
