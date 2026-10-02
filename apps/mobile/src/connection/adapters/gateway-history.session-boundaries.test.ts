import { localizeAgentSystemNotice } from '../../chat/agentSystemNotice';
import zhHansChat from '../../i18n/locales/zh-Hans/chat.json';
import { mapGatewayHistoryMessages, mergeGatewayHistory } from './gateway-history';
// OpenClaw 2026.9.1 `chat.history` after a daily session reset; message text replaced.
import resetHistory from './__fixtures__/openclaw-session-reset.json';

const zhHans = (key: string) => (zhHansChat as Record<string, string>)[key] ?? key;

describe('recorded OpenClaw session boundaries', () => {
  const reset = resetHistory[1];
  // The same transcript reader projects compaction records as "Compaction",
  // optionally with the compacting run's identity.
  const compaction = {
    ...reset,
    content: [{ type: 'text', text: 'Compaction' }],
    __openclaw: { ...reset.__openclaw, kind: 'compaction', id: 'compaction-boundary', runId: 'compaction-run' },
  };

  it('shows the recorded reset boundary as the localized Session reset notice, before the message that opened it', () => {
    const wire = JSON.stringify(resetHistory);
    const mapped = mapGatewayHistoryMessages('agent:main:main', resetHistory);
    // The Gateway sorts by message time and wrote the boundary after the
    // user's own send time; the transcript position puts it first.
    expect(mapped.map(message => [message.role, message.text])).toEqual([
      ['system', 'Session reset'], ['user', 'Morning'], ['assistant', 'Good morning.'],
    ]);
    expect(mapped[0]).toEqual({ id: '5e4bd6a9', role: 'system', text: 'Session reset', timestampMs: resetHistory[0].timestamp - 1 });
    expect(localizeAgentSystemNotice(mapped[0].text, zhHans)).toBe('会话已重置');
    expect(JSON.stringify(resetHistory)).toBe(wire);
  });

  it('keeps the placed boundary through the time-ordered merge with cached rows', () => {
    const remote = mapGatewayHistoryMessages('agent:main:main', resetHistory);
    const cached = remote.map(message => ({ ...message }));
    expect(mergeGatewayHistory(remote, cached, { openclawUserEchoes: true }).map(message => message.text))
      .toEqual(['Session reset', 'Morning', 'Good morning.']);
  });

  it.each([
    ['already in place', [resetHistory[1], resetHistory[0], resetHistory[2]], reset.timestamp],
    ['without a transcript position', [resetHistory[0], { ...reset, __openclaw: { kind: 'reset', id: '5e4bd6a9' } }, resetHistory[2]], reset.timestamp],
  ])('leaves a boundary %s where the Gateway put it', (_, rows, timestampMs) => {
    const mapped = mapGatewayHistoryMessages('agent:main:main', rows);
    expect(mapped.map(message => message.id)).toEqual(rows.map(row => row.__openclaw!.id));
    expect(mapped.find(message => message.role === 'system')?.timestampMs).toBe(timestampMs);
  });

  it('never moves a boundary across another transcript or an unpositioned row', () => {
    const otherSource = { ...resetHistory[0], __openclaw: { ...resetHistory[0].__openclaw,
      transcriptPosition: { source: 'archived-transcript', rawSeq: 9000 } } };
    const unpositioned = { ...resetHistory[0], __openclaw: { ...resetHistory[0].__openclaw, transcriptPosition: undefined } };
    for (const user of [otherSource, unpositioned]) {
      expect(mapGatewayHistoryMessages('agent:main:main', [user, reset, resetHistory[2]]).map(message => message.role))
        .toEqual(['user', 'system', 'assistant']);
    }
  });

  it('shows a compaction boundary as the localized Context compacted notice', () => {
    const [mapped] = mapGatewayHistoryMessages('agent:main:main', [compaction]);
    expect(mapped).toEqual({ id: 'compaction-boundary', role: 'system', text: 'Context compacted', timestampMs: reset.timestamp });
    expect(localizeAgentSystemNotice(mapped.text, zhHans)).toBe('上下文已压缩');
  });

  it.each([
    ['system text without a boundary kind', { ...reset, __openclaw: { id: 'system-prose' } }],
    ['an unknown boundary kind', { ...reset, __openclaw: { ...reset.__openclaw, kind: 'checkpoint' } }],
    ['a user row carrying a boundary kind', { ...reset, role: 'user' }],
    ['a Hermes system row', { id: 'hermes-system', role: 'system', content: 'Reset' }],
  ])('keeps %s verbatim', (_, value) => {
    expect(mapGatewayHistoryMessages('agent:main:main', [value])[0]?.text).toBe('Reset');
  });

  it('replaces a boundary cached with the raw label by the canonical notice', () => {
    const remote = mapGatewayHistoryMessages('agent:main:main', resetHistory);
    const cached = remote.map(message => message.role === 'system' ? { ...message, text: 'Reset' } : message);
    expect(mergeGatewayHistory(remote, cached, { openclawUserEchoes: true })
      .filter(message => message.role === 'system')).toEqual(remote.filter(message => message.role === 'system'));
  });
});
