import { claudeControl, startClaudeBackground } from './claude-code-lifecycle.js';
import { openSync, readSync, closeSync, fstatSync, mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, unlinkSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { buildPairingSessionDraft, securePairingCodeKeyHex } from '@clawket/bridge-core';
import { ClaudeService, ClaudeServer, ClaudeRelay, inspectClaudeInstallation, type ClaudeRelayConfig } from '@clawket/bridge-runtime';
import QRCode from 'qrcode';

interface Config { device?: boolean; project: string; token: string; command: string; port: number; host: string; relay?: ClaudeRelayConfig }
function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name); if (i < 0) return undefined;
  const value = args[i + 1]; if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`); return value;
}
async function post<T>(url: string, body: object): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000), redirect: 'error' });
  if (!response.ok) throw new Error(`Claude Registry returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
export async function handleClaudeCommand(args: string[]): Promise<void> {
  const command = args[0] ?? 'pair';
  if (!['pair', 'run', 'doctor', 'status', 'start', 'restart', 'stop', 'logs', 'reset'].includes(command)) throw new Error('Use claude-code pair, run, start, restart, stop, status, doctor, logs or reset');
  if (args.includes('--device') && flag(args, '--project')) throw new Error('Choose --device or --project, not both');
  const device = args.includes('--device') || (!flag(args, '--project') && !flag(args, '--config'));
  const deviceRoot = join(homedir(), 'Documents', 'Clawket', 'Chats');
  if (device) mkdirSync(deviceRoot, { recursive: true, mode: 0o700 });
  const project = realpathSync(resolve(flag(args, '--project') ?? (device ? deviceRoot : process.cwd())));
  const projectId = createHash('sha256').update(project).digest('hex').slice(0, 16);
  const configPath = resolve(flag(args, '--config') ?? join(homedir(), '.clawket', 'claude-code', device ? 'device' : projectId, args.includes('--preview') ? 'preview' : 'production', 'runtime.json'));
  const directory = dirname(configPath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const save = (value: Config) => { writeFileSync(configPath + '.pending', JSON.stringify(value, null, 2), { mode: 0o600 }); renameSync(configPath + '.pending', configPath); };
  let config: Config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : { device, project, command: flag(args, '--claude-command') ?? 'claude', token: randomBytes(32).toString('hex'), port: Number(flag(args, '--port') ?? (18000 + (parseInt(projectId.slice(0, 4), 16) % 10000) * 2 + (args.includes('--preview') ? 1 : 0))), host: '127.0.0.1' };
  if (existsSync(configPath) && ((args.includes('--device') && config.device !== true) || (flag(args, '--project') && config.device === true))) throw new Error('This pairing has a different scope. Choose a separate config for the new scope.');
  const label = config.device ? 'Computer' : basename(config.project);
  if (command === 'pair' && flag(args, '--port')) config.port = Number(flag(args, '--port'));
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('Invalid Claude Bridge port');
  if (command === 'logs') {
    const log = join(directory, 'claude-code.log');
    if (!existsSync(log)) { console.log('No Claude Bridge logs yet.'); return; }
    const fd = openSync(log, 'r');
    try { const size = fstatSync(fd).size; const buffer = Buffer.alloc(Math.min(size, 32000)); readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length)); console.log(buffer.toString('utf8')); }
    finally { closeSync(fd); }
    return;
  }
  if (['pair', 'status', 'doctor', 'stop', 'restart', 'reset', 'start'].includes(command)) {
    let health: { model: string; modelReady: boolean } | undefined;
    try { health = await claudeControl(config); } catch { /* An offline runtime may be started or diagnosed below. */ }
    if (command === 'status') { console.log(`Claude Code · ${label}: ${health ? 'ready' : 'offline'}`); return; }
    if (command === 'doctor' && health) { console.log('Claude Code Bridge: ready. Check native authentication with claude auth status.'); return; }
    if (['pair', 'stop', 'restart', 'reset'].includes(command) && health) {
      if (command === 'pair') { const sessions = await claudeControl(config, 'sessions.list') as unknown as Array<{ hasActiveRun?: boolean }>; if (sessions.some(s => s.hasActiveRun)) throw new Error('Finish the current Claude task before refreshing pairing. Existing phone connections remain usable.'); }
      await claudeControl(config, 'bridge.stop');
      const deadline = Date.now() + 10000;
      while (existsSync(join(directory, 'sessions', 'owner.lock'))) { if (Date.now() > deadline) throw new Error('Claude is still stopping; retry after it exits.'); await new Promise(r => setTimeout(r, 100)); }
    }
    if (command === 'reset') { if (existsSync(join(directory, 'sessions', 'owner.lock'))) throw new Error('Stop the Claude owner before resetting pairing'); if (existsSync(configPath)) unlinkSync(configPath); console.log('Claude pairing cleared. Session history retained.'); return; }
    if (command === 'stop') { console.log(health ? 'Claude Bridge stopped.' : 'Claude Bridge is offline.'); return; }
    if (command === 'start' && health) { console.log('Claude Bridge is already running.'); return; }
    if (command === 'start' || command === 'restart') { if (!existsSync(configPath)) throw new Error('Pair this Claude connection first'); await startClaudeBackground(['run', '--config', configPath], join(directory, 'claude-code.log')); return; }
  }
  if (command === 'pair' && !args.includes('--foreground')) {
    // The child receives --config before it exists; preserve the parent's explicit scope.
    await startClaudeBackground([...args, ...(config.device && !args.includes('--device') ? ['--device'] : []), '--config', configPath], join(directory, 'claude-code.log')); return;
  }
  const show = (text: string) => { if (process.send) process.send({ type: 'claude-code.display', text }); else console.log(text); };
  const installed = await inspectClaudeInstallation(config.command);
  const service = new ClaudeService({ project: config.project, directory: join(directory, 'sessions'), executable: installed.executable, device: config.device });
  let server: ClaudeServer | undefined, relay: ClaudeRelay | undefined;
  try {
    await service.health();
    if (command === 'doctor') { console.log(`Claude Code ${installed.version}: installed\nProject: ${basename(config.project)}\nAuthentication: run claude auth status on this computer`); return; }
    let qrPayload: string | undefined, code: string | undefined;
    if (command === 'pair') {
      if (args.includes('local') || args.includes('--local')) {
        config.host = flag(args, '--host') ?? '0.0.0.0'; config.relay = undefined;
        const address = flag(args, '--address') ?? Object.values(networkInterfaces()).flat().find(a => a?.family === 'IPv4' && !a.internal)?.address;
        if (!address) throw new Error('No LAN address found. Supply --address reachable-from-phone');
        qrPayload = JSON.stringify({ version: 1, backendKind: 'claude-code', mode: 'local', url: `ws://${address}:${config.port}/v1/claude-code/ws`, token: config.token });
      } else {
        const registryUrl = flag(args, '--registry') ?? (args.includes('--preview') ? 'https://clawket-claude-code-registry-preview.clawket.workers.dev' : 'https://clawket-claude-code-registry.clawket.workers.dev');
        const url = new URL(registryUrl);
        if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Claude Registry requires HTTPS');
        const previous = config.relay;
        const previousRegistry = previous?.registryUrl ?? (() => { try { return JSON.parse(previous?.invitation?.qrPayload ?? '{}').s; } catch { return undefined; } })();
        const registered = previous && previousRegistry === registryUrl
          ? { ...previous, ...await post<{ accessCode: string }>(registryUrl.replace(/\/$/, '') + '/v1/pair/access-code', { gatewayId: previous.gatewayId, relaySecret: previous.relaySecret }) }
          : await post<{ gatewayId: string; relaySecret: string; relayUrl: string; accessCode: string }>(registryUrl.replace(/\/$/, '') + '/v1/pair/register', { displayName: `Claude Code · ${config.device ? 'Computer' : basename(config.project)}` });
        if (!registered.gatewayId || !registered.relaySecret || !registered.relayUrl || !registered.accessCode) throw new Error('Invalid Claude registration');
        qrPayload = JSON.stringify({ v: 2, k: 'cp', b: 'claude-code', s: registryUrl, g: registered.gatewayId, a: registered.accessCode, n: `Claude Code · ${config.device ? 'Computer' : basename(config.project)}` });
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
    } else if (!existsSync(configPath)) throw new Error('Pair this Claude connection first');
    server = new ClaudeServer(service, config.token, message => console.error(message)); await server.start(config.port, config.host);
    if (config.relay) {
      relay = new ClaudeRelay(service, config.relay, invitation => { config.relay!.invitation = invitation; save(config); }, message => console.error(message));
      relay.start(); await relay.waitUntilReady();
    }
    if (code) show(`Pairing code: ${code}`);
    if (qrPayload) { show(await QRCode.toString(qrPayload, { type: 'terminal', small: true })); const output = flag(args, '--qr-file'); if (output) await QRCode.toFile(resolve(output), qrPayload); }
    show(process.send ? `Claude Code · ${label} is running in the background. ${config.device ? 'Choose a project when starting a chat on your phone.' : 'New chats use this project.'} Use clawket claude-code status / stop with the same pairing options.` : `Claude Code · ${label} is running. Keep this terminal open. Ctrl+C stops Clawket-owned Claude sessions.`);

    await new Promise<void>(done => { const stop = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); service.off('shutdown', stop); done(); }; process.once('SIGINT', stop); process.once('SIGTERM', stop); service.once('shutdown', stop); process.send?.({ type: 'claude-code.ready' }); });
  } finally { relay?.stop(); if (server) await server.stop(); else await service.stop(); }
}
