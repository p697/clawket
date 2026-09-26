import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { CodexRpc } from './rpc.js';
let root: string, rpc: CodexRpc;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'codex-wire-'));
  const fixture = join(root, 'fixture.cjs');
  writeFileSync(fixture, `const rl=require('node:readline').createInterface({input:process.stdin});
  function send(v){process.stdout.write(JSON.stringify(v)+'\\n')}
  rl.on('line',l=>{const f=JSON.parse(l);if(!f.id)return;
    if(f.method==='initialize')send({id:f.id,result:{}});
    else if(f.method==='utf8'){const b=Buffer.from(JSON.stringify({method:'delta',params:{text:'你好 🌸\\n '}})+'\\n');let i=0;const t=setInterval(()=>{process.stdout.write(b.subarray(i,i+1));if(++i===b.length){clearInterval(t);send({id:f.id,result:{ok:true}})}},1)}
    else if(f.method==='request'){send({id:'native-id',method:'approval',params:{}});send({id:f.id,result:{ok:true}})}
    else if(f.method==='rejected')send({id:f.id,error:{code:-32602,message:'secret native detail'}});
    else if(f.method==='malformed')process.stdout.write('{broken\\n');
    else if(f.method==='null')send(null);
    else if(f.method==='exit')process.exit(1);
    else if(f.method!=='hang')send({id:f.id,result:{ok:true}});
  });`);
  rpc = new CodexRpc(fixture, root);
});
afterEach(async () => { await rpc.stop(); rmSync(root, { recursive: true, force: true }); });
it('preserves split UTF-8 code points and whitespace', async () => {
  const next = once(rpc, 'notification'); await expect(rpc.request('utf8')).resolves.toEqual({ ok: true });
  expect((await next)[0].params.text).toBe('你好 🌸\n ');
});
it('distinguishes server requests from notifications', async () => {
  const next = once(rpc, 'request'); await rpc.request('request'); expect((await next)[0].id).toBe('native-id');
});
it('reports explicit refusal without exposing native secrets', async () => {
  await expect(rpc.request('rejected')).rejects.toMatchObject({ outcome: 'rejected' });
  await expect(rpc.request('rejected')).rejects.not.toThrow('secret native detail');
});
it('fails pending requests on malformed framing and process loss', async () => {
  await expect(rpc.request('malformed')).rejects.toThrow('disconnected');
  await expect(rpc.request('after')).rejects.toThrow('unavailable');
});
it('bounds outbound frames before writing', async () => {
  await expect(rpc.request('large', { text: 'x'.repeat(8 * 1024 * 1024) })).rejects.toThrow('transfer limit');
  await expect(rpc.request('still-alive')).resolves.toEqual({ ok: true });
});
it('bounds pending calls and settles them on shutdown', async () => {
  await rpc.request('ready');
  const calls = Array.from({ length: 33 }, () => rpc.request('hang').catch(e => e));
  await Promise.resolve();
  expect(await calls[32]).toMatchObject({ message: 'Too many Codex requests' });
  await rpc.stop(); expect((await Promise.all(calls)).every(e => e instanceof Error)).toBe(true);
});

it('rejects non-object JSON frames without crashing the host', async () => {
  await expect(rpc.request('null')).rejects.toThrow('disconnected');
});
