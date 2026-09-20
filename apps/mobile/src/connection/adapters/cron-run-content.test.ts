import { extractCronDeliveries, resolveCronRunSessionKey } from './cron-run-content';

const BRIEF = '早。昨天周五，主站 DAU 36.5k，比七日均低了 26%。';

describe('resolveCronRunSessionKey', () => {
  it('strips the hidden per-run suffix OpenClaw reports on cron.runs entries', () => {
    expect(resolveCronRunSessionKey('agent:main:cron:41230a62:run:9e1dda96-8e1d')).toBe('agent:main:cron:41230a62');
  });

  it('keeps stable, foreign and empty keys as they are', () => {
    expect(resolveCronRunSessionKey('agent:main:cron:41230a62')).toBe('agent:main:cron:41230a62');
    expect(resolveCronRunSessionKey(' agent:main:subagent:worker ')).toBe('agent:main:subagent:worker');
    expect(resolveCronRunSessionKey('   ')).toBeUndefined();
    expect(resolveCronRunSessionKey(undefined)).toBeUndefined();
  });
});

describe('extractCronDeliveries', () => {
  it('reads a direct message tool send', () => {
    expect(extractCronDeliveries([
      { role: 'assistant', content: [
        { type: 'text', text: 'Sending.' },
        { type: 'toolCall', id: 'call_1', name: 'message', arguments: { action: 'send', channel: 'telegram', target: '8053522863', message: BRIEF } },
      ] },
    ])).toEqual([{ channel: 'telegram', target: '8053522863', text: BRIEF }]);
  });

  it('unwraps the generic tool_call envelope and de-duplicates the nested custom echo', () => {
    // Recorded 2026-09-19 from an OpenClaw 2026.9.1 isolated cron run (deepseek-flash).
    const history = [
      { role: 'assistant', content: [
        { type: 'thinking', thinking: '…' },
        { type: 'toolCall', id: 'call_00_cClF', name: 'tool_call', arguments: { id: 'message', args: { action: 'send', channel: 'telegram', target: '8053522863', message: BRIEF } } },
      ] },
      { role: 'custom', customType: 'openclaw.nested-tool.v1', content: [
        { type: 'toolCall', id: 'tool_search_code:call_00_cClF:message:1', name: 'message', arguments: { action: 'send', channel: 'telegram', target: '8053522863', message: BRIEF }, parentToolCallId: 'call_00_cClF' },
        { type: 'toolResult', toolCallId: 'tool_search_code:call_00_cClF:message:1', toolName: 'message', content: [{ type: 'text', text: '{"ok":true}' }] },
      ] },
      { role: 'toolResult', toolCallId: 'call_00_cClF', content: [{ type: 'text', text: '{"tool":{"name":"message"}}' }] },
      { role: 'assistant', content: [{ type: 'text', text: '已发送。' }] },
    ];
    expect(extractCronDeliveries(history)).toEqual([{ channel: 'telegram', target: '8053522863', text: BRIEF }]);
  });

  it('keeps distinct sends in order and accepts Anthropic-style tool_use blocks with `to` / `text`', () => {
    expect(extractCronDeliveries([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'message', input: { action: 'send', channel: 'slack', to: '#ops', text: 'first' } }] },
      { role: 'assistant', content: [{ type: 'toolCall', id: 'b', name: 'message', arguments: { action: 'broadcast', channel: 'discord', message: 'second' } }] },
    ])).toEqual([
      { channel: 'slack', target: '#ops', text: 'first' },
      { channel: 'discord', text: 'second' },
    ]);
  });

  it('ignores non-send message actions, other tools and malformed rows', () => {
    expect(extractCronDeliveries([
      { role: 'assistant', content: [{ type: 'toolCall', id: 'a', name: 'message', arguments: { action: 'react', channel: 'telegram', target: '1', message: 'x' } }] },
      { role: 'assistant', content: [{ type: 'toolCall', id: 'b', name: 'exec', arguments: { command: 'echo hi', message: 'not a send' } }] },
      { role: 'assistant', content: [{ type: 'toolCall', id: 'c', name: 'tool_call', arguments: { id: 'exec', args: { message: 'nope' } } }] },
      { role: 'assistant', content: [{ type: 'toolCall', id: 'd', name: 'message', arguments: { action: 'send', channel: 'telegram' } }] },
      { role: 'assistant', content: 'plain string content' },
      null,
      42,
      { role: 'assistant', content: [null, 'text', { type: 'toolCall', name: 'message', arguments: 'bad' }] },
    ])).toEqual([]);
    expect(extractCronDeliveries([])).toEqual([]);
  });
});
