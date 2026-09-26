import { describe, expect, it } from 'vitest';
import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import { claudeHistory } from './history.js';

const message = (type: SessionMessage['type'], uuid: string, content: unknown): SessionMessage => ({
  type, uuid, session_id: 'fixture', parent_tool_use_id: null, parent_agent_id: null, message: { content },
});

describe('Claude native history', () => {
  it('omits native model-switch envelopes while preserving human discussion of commands', () => {
    const text = 'Explain <command-name>/model</command-name> please';
    expect(claudeHistory([
      message('user', 'switch', '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>sonnet</command-args>'),
      message('user', 'status', '<local-command-stdout>Set model to `sonnet (claude-sonnet-5)`</local-command-stdout>'),
      message('user', 'interrupted', [{ type: 'text', text: '[Request interrupted by user for tool use]' }]),
      message('user', 'interrupted-text', '[Request interrupted by user]'),
      message('user', 'human', text),
    ])).toEqual([{ id: 'human', role: 'user', text }]);
  });
  it('preserves text exactly and reconciles tools without rendering their results as human messages', () => {
    const rows = claudeHistory([
      message('user', 'user', '  inspect\n'),
      message('assistant', 'tool', [{ type: 'tool_use', id: 'call', name: 'Read', input: { file_path: 'README.md' } }]),
      message('user', 'result', [{ type: 'tool_result', tool_use_id: 'call', content: 'file content', is_error: false }]),
      message('assistant', 'answer', [{ type: 'thinking', thinking: 'private reasoning' }, { type: 'text', text: '\nDone.\n' }]),
    ]);
    expect(rows.map(row => [row.role, row.text])).toEqual([['user', '  inspect\n'], ['tool', ''], ['assistant', '\nDone.\n']]);
    expect(rows[1]).toMatchObject({ id: 'toolcall_call', tool: { callId: 'call', status: 'success', output: 'file content' } });
  });

  it('leaves unfinished tools unknown and ignores duplicate frames, subagents and orphan results', () => {
    const tool = message('assistant', 'one', [{ type: 'tool_use', id: 'call', name: 'Bash', input: {} }]);
    const rows = claudeHistory([tool, tool,
      { ...message('assistant', 'child', 'subagent text'), parent_tool_use_id: 'call' },
      message('user', 'orphan', [{ type: 'tool_result', tool_use_id: 'not-on-page', content: 'result' }]),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].tool?.status).toBe('unknown');
  });

  it('marks denied or failed tool results as errors and bounds their display output', () => {
    const rows = claudeHistory([
      message('assistant', 'call', [{ type: 'tool_use', id: 'x', name: 'Write', input: {} }]),
      message('user', 'result', [{ type: 'tool_result', tool_use_id: 'x', content: 'x'.repeat(40_000), is_error: true }]),
    ]);
    expect(rows[0].tool?.status).toBe('error');
    expect(rows[0].tool?.output).toHaveLength(32_000);
  });
});
