import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import WebSocket from 'ws';

/** A bounded authenticated local control call; never infer ownership from a PID or an occupied port. */
export function claudeControl(config: { port: number; token: string }, method = 'health'): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${config.port}/v1/claude-code/ws`, { handshakeTimeout: 3000 });
    const timer = setTimeout(() => finish(new Error('Claude Code Bridge did not answer')), 5000);
    let settled = false;
    const finish = (error?: Error, value?: unknown) => { if (settled) return; settled = true; clearTimeout(timer); socket.terminate(); error ? reject(error) : resolve(value); };
    socket.on('error', () => finish(new Error('Claude Code Bridge is not reachable')));
    socket.on('close', () => finish(new Error('Claude Code Bridge closed the connection')));
    socket.on('open', () => socket.send(JSON.stringify({ type: 'req', id: 'auth', method: 'connect', params: { token: config.token } })));
    socket.on('message', raw => {
      let frame: any; try { frame = JSON.parse(raw.toString()); } catch { return; }
      if (frame.type !== 'res') return;
      if (!frame.ok) { finish(new Error('Claude Code Bridge rejected the control request')); return; }
      if (frame.id === 'auth') {
        if (frame.payload?.backend !== 'claude-code') { finish(new Error('Endpoint is not a Claude Code Bridge')); return; }
        if (method === 'health') finish(undefined, frame.payload);
        else socket.send(JSON.stringify({ type: 'req', id: 'control', method }));
      } else if (frame.id === 'control') finish(undefined, frame.payload);
    });
  });
}

/** Detach only after authenticated startup. Pairing credentials go over IPC to the invoking terminal, never to persistent logs. */
export async function startClaudeBackground(args: string[], logPath: string, executable = process.execPath, entry = process.argv[1]): Promise<void> {
  const fd = openSync(logPath, 'a', 0o600);
  const child = spawn(executable, [entry, 'claude-code', ...args, '--foreground'], { detached: true, stdio: ['ignore', fd, fd, 'ipc'], windowsHide: true });
  closeSync(fd);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return; settled = true; clearTimeout(timer);
      child.removeAllListeners('message'); child.removeAllListeners('exit'); child.removeAllListeners('error');
      if (error) { child.kill('SIGTERM'); reject(error); }
      else { child.disconnect(); child.unref(); resolve(); }
    };
    const timer = setTimeout(() => finish(new Error('Claude Code startup timed out. Inspect clawket claude-code logs.')), 150000);
    child.once('error', () => finish(new Error('Could not start Claude Code Bridge')));
    child.once('exit', () => finish(new Error('Claude Code Bridge exited during startup. Inspect clawket claude-code logs.')));
    child.on('message', (message: any) => {
      if (message?.type === 'claude-code.display' && typeof message.text === 'string') console.log(message.text);
      if (message?.type === 'claude-code.ready') finish();
    });
  });
}
