import { expect, it } from 'vitest';
import { UpdateAdmission } from './update-admission.js';
it('waits for in-flight dispatch and active runs, then fences every new dispatch', async () => {
  const admission = new UpdateAdmission(); let finish!: () => void;
  const dispatch = admission.request(() => new Promise<void>(resolve => { finish = resolve; }));
  expect(admission.prepare(() => false)).toBe(false); finish(); await dispatch;
  expect(admission.prepare(() => true)).toBe(false); expect(admission.prepare(() => false)).toBe(true);
  await expect(admission.request(async () => 'new prompt')).rejects.toThrow('restarting');
});
it('releases a failed dispatch without leaving a false busy state', async () => {
  const admission = new UpdateAdmission();
  await expect(admission.request(async () => { throw new Error('failed'); })).rejects.toThrow('failed');
  expect(admission.prepare(() => false)).toBe(true);
});
