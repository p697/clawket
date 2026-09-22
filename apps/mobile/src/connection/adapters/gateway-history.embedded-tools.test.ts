import { mergeGatewayHistory, mapGatewayHistoryMessages, preserveOpenClawCliHistorySegments } from './gateway-history';
import resumeHistory from './__fixtures__/openclaw-cli-resume-user.json';

describe('recorded OpenClaw CLI resumed input', () => {
  const project = (values: unknown[]) => preserveOpenClawCliHistorySegments('main', values, mapGatewayHistoryMessages('main', values));
  it('keeps one canonical user bubble for the recorded resumed input', () => {
    expect(project(resumeHistory)).toEqual([mapGatewayHistoryMessages('main', resumeHistory)[0]]);
  });
  it('keeps intentionally repeated sends', () => {
    const repeated = { ...resumeHistory[0], id: 'second-send', idempotencyKey: '1789650198142_another:user' };
    expect(project([resumeHistory[0], repeated, resumeHistory[1]]).map(m => m.id)).toEqual(['persisted-user', 'second-send']);
  });
  it.each([
    ['partial page', [resumeHistory[1]]],
    ['ordinary imported input', [resumeHistory[0], { ...resumeHistory[1], content: '滴滴' }]],
    ['different prompt', [resumeHistory[0], { ...resumeHistory[1], content: resumeHistory[1].content + '！' }]],
    ['explicit other identity', [resumeHistory[0], { ...resumeHistory[1], idempotencyKey: 'other' }]],
    ['missing CLI provenance', [resumeHistory[0], { ...resumeHistory[1], __openclaw: { id: 'unknown' } }]],
    ['missing transcript identity', [resumeHistory[0], { ...resumeHistory[1], __openclaw: { importedFrom: 'claude-cli', cliSessionId: 'session' } }]],
    ['late input', [resumeHistory[0], { ...resumeHistory[1], timestamp: resumeHistory[0].timestamp + 60_001 }]],
    ['older input', [resumeHistory[0], { ...resumeHistory[1], timestamp: resumeHistory[0].timestamp - 1 }]],
    ['intervening reply', [resumeHistory[0], { id: 'reply', role: 'assistant', content: 'Hi' }, resumeHistory[1]]],
    ['attachment', [resumeHistory[0], { ...resumeHistory[1], content: [{ type: 'text', text: resumeHistory[1].content }, { type: 'image', uri: 'file:///photo.png' }] }]],
    ['opaque original identity', [{ ...resumeHistory[0], idempotencyKey: 'external:user' }, resumeHistory[1]]],
  ])('preserves unproven copies: %s', (_, values) => {
    expect(project(values)).toHaveLength(values.length);
  });
  it('keeps the canonical run anchor for assistant rollup reconciliation', () => {
    const reply = { id: 'reply', role: 'assistant', content: '在。滴到了', __openclaw: resumeHistory[1].__openclaw };
    const rollup = { id: 'rollup', role: 'assistant', provider: 'claude-cli', content: reply.content,
      __openclaw: { idempotencyKey: `cli-assistant:${resumeHistory[0].idempotencyKey!.replace(/:user$/, '')}` } };
    expect(project([...resumeHistory, reply, rollup]).map(m => m.id)).toEqual(['persisted-user', 'reply']);
  });
});

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

describe('Hermes installed-skill cache presentation', () => {
  it('retires a cached display prefix when the canonical prompt is echoed', () => {
    const remote = { id: 'native:1', role: 'user' as const, timestampMs: 10_310, text: 'Use the installed skill "arxiv" for this request. Read its instructions with skill_view before proceeding.\n\nRead it.' };
    const cached = { id: 'h_user_10000_old', role: 'user' as const, timestampMs: 10_320, text: '$arxiv\n\nRead it.' };
    expect(mergeGatewayHistory([remote], [cached], { hermesUserPresentation: true })).toEqual([remote]);
    expect(mergeGatewayHistory([remote], [cached])).toHaveLength(2);
    const repeat = { ...remote, id: 'native:2', timestampMs: 10_500 };
    expect(mergeGatewayHistory([remote, repeat], [cached], { hermesUserPresentation: true })).toEqual([remote, repeat]);
    expect(mergeGatewayHistory([remote], [{ ...cached, text: '$arxiv\n\nDifferent.' }], { hermesUserPresentation: true })).toHaveLength(2);
  });
});

describe('native expanded user inputs', () => {
  const skill = "Use the following explicitly referenced skills for this request. Read each skill's SKILL.md before acting:\n- apple-notes\n\nUser request:\n$apple-notes\n\nExplain";
  const doc = '[media attached: media://inbound/report.pdf (application/pdf)]\nRead this\n[media attached: media://inbound/report.pdf]\n\n<file name="report.pdf" mime="application/pdf">\n<<<EXTERNAL_UNTRUSTED_CONTENT id="ab">>>\nextracted text\n<<<END_EXTERNAL_UNTRUSTED_CONTENT id="ab">>>\n</file>';
  it.each([[skill, '$apple-notes\n\nExplain'], [doc, 'Read this']])('keeps one canonical user send for a proven expansion', (content, original) => {
    const rows = [
      { id: 'send', role: 'user', timestamp: 1789976421978, content: original, __openclaw: { idempotencyKey: '1789976428152_r1stw8sb:user' } },
      { id: 'import', role: 'user', timestamp: 1789976422747, content, __openclaw: { importedFrom: 'claude-cli', cliSessionId: 'cli' } },
    ];
    const project = (values: unknown[]) => preserveOpenClawCliHistorySegments('main', values, mapGatewayHistoryMessages('main', values));
    expect(project(rows).map(m => m.text)).toEqual([original]);
    expect(project([rows[1]]).map(m => m.text)).toEqual([original]);
    const cached = mapGatewayHistoryMessages('main', rows);
    cached[1].text = content;
    const merged = mergeGatewayHistory(mapGatewayHistoryMessages('main', rows), cached, { openclawUserEchoes: true });
    expect(preserveOpenClawCliHistorySegments('main', rows, merged).map(m => m.text)).toEqual([original]);
    expect(project([{ ...rows[0], content: 'Different request' }, rows[1]])).toHaveLength(2);
    expect(project([rows[0], { ...rows[1], __openclaw: {} }])).toHaveLength(2);
    expect(project([rows[0], { ...rows[1], timestamp: 1789976522747 }])).toHaveLength(2);
    expect(project([rows[0], { ...rows[0], id: 'repeat', __openclaw: { idempotencyKey: '1789976429152_repeat:user' } }, rows[1]])).toHaveLength(2);
  });
});
