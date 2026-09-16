import { mapGatewayHistoryMessages, preserveOpenClawCliHistorySegments } from './gateway-history';

describe('OpenClaw CLI aggregate history', () => {
  const imported = { importedFrom: 'claude-cli', cliSessionId: 'cli-session' };
  const history = [
    { id: 'user', role: 'user', content: 'Check', __openclaw: { idempotencyKey: 'run-1:user' } },
    { id: 'before', role: 'assistant', content: 'Checking now.', __openclaw: imported },
    { id: 'tool', role: 'assistant', content: [
      { type: 'toolcall', id: 'read', name: 'read' },
      { type: 'tool_result', tool_use_id: 'read', content: 'done' },
    ], __openclaw: imported },
    { id: 'after', role: 'assistant', content: 'Finished.', __openclaw: imported },
    { id: 'aggregate', role: 'assistant', provider: 'claude-cli', content: 'Checking now.\n\nFinished.',
      usage: { input: 12, output: 4 }, __openclaw: { idempotencyKey: 'cli-assistant:run-1' } },
  ];
  const project = (values: unknown[]) => preserveOpenClawCliHistorySegments('main', values, mapGatewayHistoryMessages('main', values));
  it('keeps the ordered text/tool rows and final usage instead of appending the whole reply again', () => {
    const messages = project(history);
    expect(messages.map(message => message.id)).toEqual(['user', 'before', 'tool:call:0', 'tool:result:1', 'after']);
    expect(messages.at(-1)?.usage).toMatchObject({ input: 12, output: 4 });
  });
  it('retains changed text, partial pages, other runs and attachments', () => {
    const final = history.at(-1)!;
    for (const values of [
      history.slice(1),
      [history[0], ...history.slice(2)],
      [...history.slice(0, -1), { ...final, content: 'Checking now.\n\nFinished. Extra result.' }],
      [...history.slice(0, -1), { ...final, __openclaw: { idempotencyKey: 'cli-assistant:other-run' } }],
      [...history.slice(0, -1), { ...final, content: [{ type: 'text', text: final.content }, { type: 'image', url: 'file://result.png' }] }],
    ]) expect(project(values).some(message => message.id === 'aggregate')).toBe(true);
  });
});

describe('embedded CLI tool history', () => {
  it('preserves multiple coalesced calls, results and assistant text', () => {
    const mapped = mapGatewayHistoryMessages('main', [{ id: 'one', role: 'assistant', timestamp: 1000, content: [
      { type: 'text', text: 'Searching' },
      { type: 'toolcall', id: 'search', name: 'web_search', arguments: { query: 'public docs' } },
      { type: 'tool_result', tool_use_id: 'search', content: [{ type: 'text', text: 'six results' }] },
      { type: 'tool_use', id: 'job', name: 'automations', input: { action: 'add' } },
      { type: 'tool_result', tool_use_id: 'job', content: 'denied', is_error: true },
    ] }]);
    expect(mapped.map(message => message.role)).toEqual(['assistant', 'assistant', 'tool', 'assistant', 'tool']);
    expect(mapped[2]).toMatchObject({ text: 'six results', tool: { callId: 'search', name: 'web_search', status: 'success' } });
    expect(mapped[4]).toMatchObject({ text: 'denied', tool: { callId: 'job', name: 'automations', status: 'error' } });
    expect(new Set(mapped.map(message => message.id)).size).toBe(mapped.length);
  });

  it('treats a user-role tool result as a result, without inventing a user bubble', () => {
    const mapped = mapGatewayHistoryMessages('main', [
      { id: 'call', role: 'assistant', content: [{ type: 'toolcall', id: 'x', name: 'terminal' }] },
      { id: 'result', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] },
      { id: 'normal', role: 'user', content: 'hello' },
    ]);
    expect(mapped.map(message => message.role)).toEqual(['assistant', 'tool', 'user']);
    expect(mapped[1]?.tool?.name).toBe('terminal');
  });

  it('keeps ordinary Hermes toolResult and malformed records on the existing path', () => {
    const mapped = mapGatewayHistoryMessages('main', [null, { role: 'toolResult', toolCallId: 'h', toolName: 'terminal', content: '1517' }]);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toMatchObject({ role: 'tool', text: '1517', tool: { callId: 'h', status: 'success' } });
  });
});
