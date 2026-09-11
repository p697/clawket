import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import WebSocket from 'ws';
import nacl from 'tweetnacl';
import { expect, it } from 'vitest';
import { securePairingCodeKeyHex, createSecurePairingClientProof, createSecurePairingBridgeProof } from '../../packages/bridge-core/src/index';
import { LocalModelAdapter } from '../../apps/mobile/src/connection/adapters/local-model';
import type { WebSocketLike } from '../../apps/mobile/src/connection/transports/types';
import { WebSocketInbox } from '../compat/live-harness';
import { getFreePort } from './harness';

// Opt-in: creates a short-lived pairing in the isolated Preview services and
// sends a real inference request to the user's configured localhost model.
it.skipIf(process.env.CLAWKET_LOCAL_MODEL_PREVIEW_SMOKE !== '1')('CLI six-digit code -> public Preview -> actual mobile adapter -> local model', async () => {
  const registry = 'https://clawket-local-model-registry-preview.clawket.workers.dev';
  const output = join(process.cwd(), 'docs/3.0/evidence/local-model');
  const runDirectory = join(output, `preview-${Date.now()}`);
  await mkdir(runDirectory, { recursive: true });
  const cli = spawn(process.execPath, ['apps/bridge-cli/dist/index.js', 'local-model', 'pair', '--preview', '--config', join(runDirectory,'runtime.json'), '--port', String(await getFreePort()), '--base-url', process.env.CLAWKET_MODEL_URL ?? 'http://127.0.0.1:8080', ...(process.env.CLAWKET_MODEL_ENDPOINTS ? ['--endpoints',process.env.CLAWKET_MODEL_ENDPOINTS] : [])], { cwd: process.cwd(), windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  let diagnostic = '';
  cli.stderr.on('data', data => { diagnostic += data.toString(); });
  let pairing: WebSocket | undefined;
  let adapter: LocalModelAdapter | undefined;
  const startedAt = Date.now();
  const trace: unknown[] = [];
  let socketCount = 0;
  try {
    const code = await new Promise<string>((resolve, reject) => {
      let text = '';
      const timer = setTimeout(() => reject(new Error(`CLI pairing timeout: ${diagnostic}`)), 90_000);
      cli.stdout.on('data', data => { text += data.toString(); const match = /Pairing code: (\d{6})/.exec(text); if (match) { clearTimeout(timer); resolve(match[1]); } });
      cli.once('exit', code => { clearTimeout(timer); reject(new Error(`CLI exited ${code}: ${diagnostic}`)); });
      cli.once('error', error => { clearTimeout(timer); reject(error); });
    });
    const post = async (path: string, body: object) => {
      const response = await fetch(registry + path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), signal:AbortSignal.timeout(20_000) });
      expect(response.status).toBe(200); return response.json() as Promise<any>;
    };
    const codeKeyHex = securePairingCodeKeyHex(code);
    const resolution = await post('/v2/pair/session/resolve', { codeHash: codeKeyHex });
    const url = new URL(resolution.relayUrl);
    for (const [key,value] of Object.entries({ gatewayId:resolution.gatewayId, token:resolution.relayTicket, role:'client', clientId:randomUUID() })) url.searchParams.set(key,String(value));
    pairing = new WebSocket(url); const inbox = new WebSocketInbox(pairing);
    await new Promise<void>((resolve,reject) => { pairing!.once('open',resolve); pairing!.once('error',reject); });
    const keys=nacl.box.keyPair(), requestId=randomUUID(), clientPublicKey=Buffer.from(keys.publicKey).toString('base64url');
    const prefix='__clawket_relay_control__:';
    pairing.send(prefix+JSON.stringify({type:'control',event:'pairing.secure.start',requestId,payload:{protocol:2,sessionId:resolution.sessionId,clientPublicKey,clientProof:createSecurePairingClientProof({codeKeyHex,sessionId:resolution.sessionId,requestId,clientPublicKey})}}));
    const result=JSON.parse((await inbox.nextText(t=>t.startsWith(prefix)&&t.includes('pairing.secure.result'),30_000)).slice(prefix.length)).payload;
    expect(result.bridgeProof).toBe(createSecurePairingBridgeProof({...result,codeKeyHex,requestId,clientPublicKey}));
    const plaintext=nacl.box.open(Buffer.from(result.ciphertext,'base64url'),Buffer.from(result.nonce,'base64url'),Buffer.from(result.bridgePublicKey,'base64url'),keys.secretKey);
    expect(plaintext).toBeTruthy(); const qr=JSON.parse(Buffer.from(plaintext!).toString()); expect(qr.b).toBe('local-model');
    pairing.close();
    const claimed=await post('/v1/pair/claim',{gatewayId:qr.g,accessCode:qr.a,clientLabel:'Windows mobile-adapter real Preview test'});
    adapter=new LocalModelAdapter({id:randomUUID(),backendKind:'local-model',transportKind:'relay',label:'Preview local model',url:claimed.relayUrl,createdAt:Date.now(),environment:'preview',relay:{gatewayId:claimed.gatewayId,clientToken:claimed.clientToken,serverUrl:registry}}, {webSocketFactory:url=>{
      const socketId=++socketCount;
      const ws=new WebSocket(url);ws.on('close',(code,reason)=>trace.push({socketId,close:code,reason:reason.toString()}));
      ws.on('message',data=>{try{const f=JSON.parse(data.toString());if(f.type==='res')trace.push({response:f.ok,error:f.error?.message,backend:f.payload?.backend});}catch{}});
      return ws as unknown as WebSocketLike;
    }});
    adapter.on('state',state=>trace.push({state,at:Date.now()-startedAt}));
    await adapter.connect(); expect(await adapter.probe()).toBe(true);
    const selection=await adapter.management.models!.getSelection!();
    let firstTokenAt=0; let text=''; let firstFinished=false;
    const promptAt=Date.now();
    const final=new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Real model response timeout')),90_000);
      adapter!.on('update',update=>{if(firstFinished)return;if(update.type==='agent_message_chunk'){firstTokenAt ||= Date.now();text+=update.text;} if(update.type==='run_finished'){firstFinished=true;clearTimeout(timer);update.stopReason==='error'?reject(new Error('Real model run failed')):resolve();}});
    });
    const key=randomUUID();
    await adapter.prompt('main',{text:'Translate into Chinese, output only the translation: The effect lasts for 5 seconds.',idempotencyKey:key});
    await final;
    expect(text).toMatch(/5/);
    const history=await adapter.loadSession('main');expect(history.messages.at(-1)?.text).toBe(text);
    adapter.disconnect();await adapter.connect();
    expect((await adapter.loadSession('main')).messages.at(-1)?.text).toBe(text);
    const extra: Record<string,unknown> = {};
    // No application RPCs during this interval: only negotiated tick/pong.
    const idleStart = trace.length;
    const idleSocketId = socketCount;
    await new Promise(resolve => setTimeout(resolve, 95_000));
    expect(adapter.state).toBe('ready');
    expect(socketCount).toBe(idleSocketId);
    expect(trace.slice(idleStart).filter((entry: any) => (entry.socketId === idleSocketId && entry.close !== undefined) || (entry.state && entry.state !== 'ready'))).toEqual([]);
    expect((await adapter.loadSession('main')).messages.at(-1)?.text).toBe(text);
    extra.idleWithoutReconnectMs = 95_000;

    if (process.env.CLAWKET_TEST_VISION_MODEL) {
      const switchAt=Date.now();
      await adapter.management.models!.setSelection!({model:process.env.CLAWKET_TEST_VISION_MODEL,scope:'global'});
      extra.visionSwitchMs=Date.now()-switchAt;
      expect(adapter.capabilities.attachments).toBe(true);
      let visionText='';
      const completed=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Vision request timed out')),90_000);adapter!.on('update',event=>{if(event.type==='agent_message_chunk')visionText+=event.text;if(event.type==='run_finished'){clearTimeout(timer);event.stopReason==='error'?reject(new Error('Vision run failed')):resolve();}});});
      const png=await readFile('tests/integration/fixtures/local-model-red-circle.png');
      await adapter.prompt('main',{text:'What color is the large circle in this image? Reply with one English word.',idempotencyKey:randomUUID(),attachments:[{type:'image',mimeType:'image/png',content:png.toString('base64')}]});
      await completed;expect(visionText.toLowerCase()).toContain('red');
      expect((await adapter.loadSession('main')).messages.at(-2)?.attachments?.[0].content).toBe(png.toString('base64'));
      extra.visionReply=visionText;
      await adapter.management.models!.setSelection!({model:selection.currentModel,scope:'global'});
      expect(adapter.capabilities.attachments).toBe(false);
      extra.restoredTextModel=true;
    }
    await writeFile(join(output,process.env.CLAWKET_TEST_VISION_MODEL?'preview-vision-result.json':'preview-live-result.json'),JSON.stringify({at:new Date().toISOString(),registry,backend:'local-model',selected:selection.currentModel,model:history.messages.at(-1)?.model,text,firstTokenMs:firstTokenAt-promptAt,totalMs:Date.now()-startedAt,checks:['CLI readiness before six-digit code','v2 proof and encrypted credential exchange','single-use claim','actual mobile adapter','real model SSE through public Relay','history','disconnect and reconnect'],vision:adapter.capabilities.attachments,...extra},null,2));
  } finally {
    await writeFile(join(runDirectory,'diagnostic.json'),JSON.stringify({diagnostic,trace},null,2));
    adapter?.disconnect();pairing?.terminate();
    if (cli.exitCode===null) {
      if(process.platform==='win32'&&cli.pid)await new Promise<void>(resolve=>execFile('taskkill.exe',['/PID',String(cli.pid),'/T','/F'],{windowsHide:true},()=>resolve()));
      else cli.kill('SIGTERM');
    }
  }
},480_000);
