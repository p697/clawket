import { updateRunActivities } from './run-activity';

describe.each(['openclaw', 'hermes', 'youmind'])('%s live activity', (connectionId) => {
  it('retains working phase without republishing every token and finishes only the matching run', () => {
    const base = { sessionKey: 'main', runId: 'run1' };
    const thinking = updateRunActivities([], connectionId, { ...base, type: 'run_started' });
    expect(thinking[0].phase).toBe('thinking');
    const reply = updateRunActivities(thinking, connectionId, { ...base, type: 'agent_message_chunk', text: 'a' });
    expect(reply[0].phase).toBe('replying');
    expect(updateRunActivities(reply, connectionId, { ...base, type: 'agent_message_chunk', text: 'b' })).toBe(reply);
    const tool = updateRunActivities(reply, connectionId, { ...base, type: 'tool_call', toolCallId: 't', title: 'bash' });
    expect(tool[0].phase).toBe('tool');
    expect(updateRunActivities(tool, 'another-connection', { ...base, type: 'run_finished', stopReason: 'end_turn' })).toBe(tool);
    expect(updateRunActivities(tool, connectionId, { ...base, runId: 'older', type: 'run_finished', stopReason: 'end_turn' })).toBe(tool);
    expect(updateRunActivities(tool, connectionId, { ...base, type: 'run_finished', stopReason: 'end_turn' })).toEqual([]);
  });
});

it('retires a reconciled idle session without clearing another session', () => {
  const a = updateRunActivities([], 'c', { type: 'run_started', sessionKey: 'a', runId: '1' });
  const both = updateRunActivities(a, 'c', { type: 'run_started', sessionKey: 'b', runId: '2' });
  expect(updateRunActivities(both, 'c', {
    type: 'history_reconciled', sessionKey: 'a', history: { key: 'a', messages: [], hasActiveRun: false },
  })).toEqual([both[1]]);
});
