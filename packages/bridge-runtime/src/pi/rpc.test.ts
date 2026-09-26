import { expect, it } from 'vitest';
import { PiRpc } from './rpc.js';

it('preserves JSONL Unicode separators and split UTF-8 while correlating responses', async () => {
  const script = `process.stdin.on('data', b => { const q=JSON.parse(String(b)); const text=Buffer.from(JSON.stringify({type:'response',id:q.id,success:true,data:{text:'你\\u2028好'}})+'\\n'); for(const byte of text) process.stdout.write(Buffer.from([byte])); }); process.stdin.on('end',()=>process.exit());`;
  const rpc = new PiRpc(process.execPath, ['-e', script], process.cwd());
  try { expect(await rpc.request('get_state')).toEqual({ text: '你\u2028好' }); } finally { await rpc.stop(); }
});
it('rejects spawn failures without leaking a path and shuts down deterministically', async () => {
  const rpc = new PiRpc('/missing-private-directory/pi', [], process.cwd());
  await expect(rpc.request('get_state')).rejects.toThrow('Pi could not start');
  await rpc.stop();
});
it('rejects all in-flight requests when the child exits', async () => {
  const rpc = new PiRpc(process.execPath, ['-e', 'process.stdin.once("data",()=>process.exit(1))'], process.cwd());
  const results = await Promise.allSettled([rpc.request('get_state'), rpc.request('get_messages')]);
  expect(results.every(result => result.status === 'rejected')).toBe(true); await rpc.stop();
});
