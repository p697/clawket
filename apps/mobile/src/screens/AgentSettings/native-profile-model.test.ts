import { nativeProfileDocument, quotaRemaining } from './native-profile-model';
import type { AgentProfileOperations } from '@clawket/agent-protocol';

it('uses the tightest quota window and never turns unknown usage into zero', () => {
  expect(quotaRemaining(undefined)).toBeNull();
  expect(quotaRemaining({ plan: null, quotas: [], lifetimeTokens: null, daily: [] })).toBeNull();
  const usage = { plan: 'pro', quotas: [{ id: 'q', name: 'Q', windows: [{ minutes: 300, usedPercent: 25, resetsAt: null }, { minutes: 10080, usedPercent: 80, resetsAt: null }] }], lifetimeTokens: null, daily: [] };
  expect(quotaRemaining(usage)).toBe(20);
  expect(quotaRemaining({ ...usage, quotas: [{ ...usage.quotas[0], windows: [{ ...usage.quotas[0].windows[0], usedPercent: 110 }] }] })).toBe(0);
});

it('retains the paid editing gate and exact loaded version, without retrying conflicts', async () => {
  const profile = { document: jest.fn(async () => ({ content: 'Original', version: 'v1', editable: true, missing: false, size: 8 })), saveDocument: jest.fn() } as unknown as jest.Mocked<AgentProfileOperations>;
  const source = nativeProfileDocument(profile, 'c', 'opaque', false);
  expect(source.freeEditing).toBeUndefined();
  await expect(source.save!('Draft')).rejects.toThrow('Refresh');
  await source.load();
  profile.saveDocument.mockRejectedValueOnce(new Error('Document changed'));
  await expect(source.save!('Draft')).rejects.toThrow('Document changed');
  expect(profile.saveDocument).toHaveBeenCalledTimes(1);
  expect(profile.saveDocument).toHaveBeenCalledWith({ id: 'opaque', version: 'v1', content: 'Draft' });
  profile.saveDocument.mockResolvedValue({ id: 'opaque', name: 'AGENTS.md', content: 'Draft', version: 'v2', editable: true, missing: false, size: 5 });
  await expect(source.save!('Draft')).resolves.toEqual({ ok: true });
  await source.save!('Next');
  expect(profile.saveDocument).toHaveBeenLastCalledWith({ id: 'opaque', version: 'v2', content: 'Next' });
});
