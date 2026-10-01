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

  it('shows the recorded reset boundary as the localized Session reset notice', () => {
    const mapped = mapGatewayHistoryMessages('agent:main:main', resetHistory);
    expect(mapped.map(message => [message.role, message.text])).toEqual([
      ['user', 'Morning'], ['system', 'Session reset'], ['assistant', 'Good morning.'],
    ]);
    expect(mapped[1]).toEqual({ id: '5e4bd6a9', role: 'system', text: 'Session reset', timestampMs: reset.timestamp });
    expect(localizeAgentSystemNotice(mapped[1].text, zhHans)).toBe('会话已重置');
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
      .filter(message => message.role === 'system')).toEqual([remote[1]]);
  });
});
