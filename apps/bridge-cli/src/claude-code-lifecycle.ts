import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import WebSocket from 'ws';
import type { Progress } from './progress.js';

/** A bounded authenticated local control call; never infer ownership from a PID or an occupied port. */
export function claudeControl(config: { port: number; token: string }, method = 'health'): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${config.port}/v1/claude-code/ws`, { handshakeTimeout: 3000 });
    const timer = setTimeout(() => finish(new Error('Claude Code Bridge did not answer')), 5000);
    let settled = false;
    let expectedResponse = 'auth';
    const finish = (error?: Error, value?: unknown) => { if (settled) return; settled = true; clearTimeout(timer); socket.terminate(); error ? reject(error) : resolve(value); };
    socket.on('error', error => finish(Object.assign(new Error('Claude Code Bridge is not reachable'), { code: (error as NodeJS.ErrnoException).code })));
    socket.on('close', () => finish(new Error('Claude Code Bridge closed the connection')));
    socket.on('open', () => socket.send(JSON.stringify({ type: 'req', id: 'auth', method: 'connect', params: { token: config.token, ...(method === 'bridge.stop' ? { controlOnly: true } : {}) } })));
    socket.on('message', raw => {
      let frame: any; try { frame = JSON.parse(raw.toString()); } catch { return; }
      if (frame.type !== 'res' || frame.id !== expectedResponse) return;
      if (!frame.ok) {
        // Older servers authenticate before native health; confirm native-independent identity before stop.
        if (method === 'bridge.stop' && frame.id === 'auth' && frame.error?.code === 'claude-code_error') {
          expectedResponse = 'identity'; socket.send(JSON.stringify({ type: 'req', id: 'identity', method: 'agents.list' })); return;
        }
        if (method === 'health' && frame.id === 'auth' && frame.error?.code === 'claude-code_error') {
          finish(new Error('The existing Claude Code Bridge failed its native health check. Inspect clawket claude-code logs and explicitly restart with the same pairing options.')); return;
        }
        finish(new Error('Claude Code Bridge rejected the control request')); return;
      }
      if (frame.id === 'auth') {
        if (frame.payload?.backend !== 'claude-code') { finish(new Error('Endpoint is not a Claude Code Bridge')); return; }
        if (method === 'health') finish(undefined, frame.payload);
        else { expectedResponse = 'control'; socket.send(JSON.stringify({ type: 'req', id: 'control', method })); }
      } else if (frame.id === 'identity') {
        if (!Array.isArray(frame.payload) || frame.payload.length !== 1 || frame.payload[0]?.agentId !== 'claude-code') {
          finish(new Error('Endpoint is not a Claude Code Bridge')); return;
        }
        expectedResponse = 'control'; socket.send(JSON.stringify({ type: 'req', id: 'control', method }));
      } else if (frame.id === 'control') finish(undefined, frame.payload);
    });
  });
}

/** Detach only after authenticated startup. Pairing credentials go over IPC to the invoking terminal, never to persistent logs. */
export async function startClaudeBackground(args: string[], logPath: string, progress?: Progress, executable = process.execPath, entry = process.argv[1]): Promise<void> {
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
      if (message?.type === 'claude-code.progress' && typeof message.text === 'string') progress?.update(message.text);
      if (message?.type === 'claude-code.display' && typeof message.text === 'string') { progress?.succeed(); console.log(message.text); }
      if (message?.type === 'claude-code.ready') finish();
    });
  });
}
