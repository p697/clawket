import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import WebSocket from 'ws';

/** A bounded authenticated local control call; never infer ownership from a PID or an occupied port. */
export function codexControl(config: { port: number; token: string }, method = 'health'): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${config.port}/v1/codex/ws`, { handshakeTimeout: 3000 });
    const timer = setTimeout(() => finish(new Error('Codex Bridge did not answer')), 5000);
    let settled = false;
    const finish = (error?: Error, value?: unknown) => { if (settled) return; settled = true; clearTimeout(timer); socket.terminate(); error ? reject(error) : resolve(value); };
    socket.on('error', () => finish(new Error('Codex Bridge is not reachable')));
    socket.on('close', () => finish(new Error('Codex Bridge closed the connection')));
    socket.on('open', () => socket.send(JSON.stringify({ type: 'req', id: 'auth', method: 'connect', params: { token: config.token } })));
    socket.on('message', raw => {
      let frame: any; try { frame = JSON.parse(raw.toString()); } catch { return; }
      if (frame.type !== 'res') return;
      if (!frame.ok) { finish(new Error('Codex Bridge rejected the control request')); return; }
      if (frame.id === 'auth') {
        if (frame.payload?.backend !== 'codex') { finish(new Error('Endpoint is not a Codex Bridge')); return; }
        if (method === 'health') finish(undefined, frame.payload);
        else socket.send(JSON.stringify({ type: 'req', id: 'control', method }));
      } else if (frame.id === 'control') finish(undefined, frame.payload);
    });
  });
}

/** Detach only after authenticated startup. Pairing credentials go over IPC to the invoking terminal, never to persistent logs. */
export async function startCodexBackground(args: string[], logPath: string, executable = process.execPath, entry = process.argv[1]): Promise<void> {
  const fd = openSync(logPath, 'a', 0o600);
  const child = spawn(executable, [entry, 'codex', ...args, '--foreground'], { detached: true, stdio: ['ignore', fd, fd, 'ipc'], windowsHide: true });
  closeSync(fd);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return; settled = true; clearTimeout(timer);
      child.removeAllListeners('message'); child.removeAllListeners('exit'); child.removeAllListeners('error');
      if (error) { child.kill('SIGTERM'); reject(error); }
      else { child.disconnect(); child.unref(); resolve(); }
    };
    const timer = setTimeout(() => finish(new Error('Codex startup timed out. Inspect clawket codex logs.')), 150000);
    child.once('error', () => finish(new Error('Could not start Codex Bridge')));
    child.once('exit', () => finish(new Error('Codex Bridge exited during startup. Inspect clawket codex logs.')));
    child.on('message', (message: any) => {
      if (message?.type === 'codex.display' && typeof message.text === 'string') console.log(message.text);
      if (message?.type === 'codex.ready') finish();
    });
  });
}
