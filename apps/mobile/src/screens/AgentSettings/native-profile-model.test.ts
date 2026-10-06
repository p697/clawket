import { nativeProfileDocument, quotaRemaining, quotaSummary, quotaResetCountdown } from './native-profile-model';
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

it('localizes native file conflicts and failures without exposing native error text', async () => {
  const profile = { document: jest.fn(async () => ({ content: '', version: 'v', editable: true, missing: true, size: 0 })), saveDocument: jest.fn() } as unknown as jest.Mocked<AgentProfileOperations>;
  const source = nativeProfileDocument(profile, 'c', 'opaque', false, { changed: '文件已改变', load: '读取失败', save: '保存失败' });
  await source.load();
  profile.saveDocument.mockRejectedValueOnce(new Error('Document changed; refresh before saving'));
  await expect(source.save!('Draft')).rejects.toThrow('文件已改变');
  profile.saveDocument.mockRejectedValueOnce(new Error('Native diagnostic'));
  await expect(source.save!('Draft')).rejects.toThrow('保存失败');
  profile.document.mockRejectedValueOnce(new Error('Native diagnostic'));
  await expect(source.load()).rejects.toThrow('读取失败');
});


it('pairs the remaining percentage with its own reset, including tied and unknown windows', () => {
  const usage = { plan: 'pro', quotas: [{ id: 'codex', name: 'Codex', windows: [{ minutes: 300, usedPercent: 10, resetsAt: 100 }, { minutes: 10080, usedPercent: 33, resetsAt: 600 }] }], lifetimeTokens: null, daily: [] };
  expect(quotaSummary(usage)).toEqual({ remaining: 67, resetsAt: 600 });
  expect(quotaSummary(undefined)).toBeNull();
  usage.quotas[0].windows[0].usedPercent = 33;
  expect(quotaSummary(usage)).toEqual({ remaining: 67, resetsAt: 600 });
  usage.quotas[0].windows[0].resetsAt = 900;
  expect(quotaSummary(usage)?.resetsAt).toBe(900);
  expect(quotaSummary({ ...usage, quotas: [{ ...usage.quotas[0], windows: [{ ...usage.quotas[0].windows[0], resetsAt: null }, usage.quotas[0].windows[1]] }] })?.resetsAt).toBeNull();
  expect(quotaSummary({ ...usage, quotas: [{ ...usage.quotas[0], windows: [{ minutes: 300, usedPercent: 110, resetsAt: 300 }, { minutes: 10080, usedPercent: 120, resetsAt: 600 }] }] })).toEqual({ remaining: 0, resetsAt: 600 });
});

it('converts native Unix seconds into a bounded reset countdown without assuming replenishment', () => {
  const now = 1800000000000;
  const reset = (minutes: number) => now / 1000 + minutes * 60;
  expect(quotaResetCountdown(reset(6 * 1440 + 60), now)).toEqual({ days: 6, hours: 1, minutes: 0, pending: false });
  expect(quotaResetCountdown(reset(90), now)).toEqual({ days: 0, hours: 1, minutes: 30, pending: false });
  expect(quotaResetCountdown(reset(0.1), now)).toEqual({ days: 0, hours: 0, minutes: 1, pending: false });
  expect(quotaResetCountdown(reset(0), now)).toEqual({ days: 0, hours: 0, minutes: 0, pending: true });
  expect(quotaResetCountdown(reset(-1), now)?.pending).toBe(true);
  expect(quotaResetCountdown(null, now)).toBeNull();
});
