import {
  AgentActivity,
  agentIdFromSessionKey,
  truncateForPreview,
  applyRunStart,
  applyDelta,
  applyToolStart,
  applyRunEnd,
} from './agentActivity';

describe('agentIdFromSessionKey', () => {
  it('extracts agent id from valid session key', () => {
    expect(agentIdFromSessionKey('agent:coder:main')).toBe('coder');
  });

  it('handles multi-segment session names', () => {
    expect(agentIdFromSessionKey('agent:mybot:session:extra')).toBe('mybot');
  });

  it('returns null for non-agent keys', () => {
    expect(agentIdFromSessionKey('main')).toBeNull();
    expect(agentIdFromSessionKey('session:foo')).toBeNull();
  });

  it('returns null for malformed agent keys', () => {
    expect(agentIdFromSessionKey('agent:')).toBeNull();
    expect(agentIdFromSessionKey('agent::')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(agentIdFromSessionKey('')).toBeNull();
  });
});

describe('truncateForPreview', () => {
  it('returns short text unchanged', () => {
    expect(truncateForPreview('hello')).toBe('hello');
  });

  it('trims whitespace', () => {
    expect(truncateForPreview('  hello  ')).toBe('hello');
  });

  it('truncates text exceeding max length', () => {
    const long = 'a'.repeat(100);
    const result = truncateForPreview(long, 80);
    expect(result.length).toBe(81); // 80 chars + ellipsis
    expect(result.endsWith('…')).toBe(true);
  });

  it('respects custom max parameter', () => {
    const result = truncateForPreview('hello world', 5);
    expect(result).toBe('hello…');
  });

  it('handles empty string', () => {
    expect(truncateForPreview('')).toBe('');
  });
});

describe('applyRunStart', () => {
  it('returns true when agent is new (was idle)', () => {
    const map = new Map<string, AgentActivity>();
    const result = applyRunStart(map, 'coder');
    expect(result).toBe(true);
    expect(map.get('coder')?.status).toBe('streaming');
  });

  it('returns true when agent was explicitly idle', () => {
    const map = new Map<string, AgentActivity>();
    map.set('coder', { agentId: 'coder', status: 'idle', previewText: 'old text', toolName: null, updatedAt: 0 });
    const result = applyRunStart(map, 'coder');
    expect(result).toBe(true);
    expect(map.get('coder')?.status).toBe('streaming');
    expect(map.get('coder')?.previewText).toBe('old text');
  });

  it('returns false when agent was already active', () => {
    const map = new Map<string, AgentActivity>();
    map.set('coder', { agentId: 'coder', status: 'streaming', previewText: null, toolName: null, updatedAt: 0 });
    const result = applyRunStart(map, 'coder');
    expect(result).toBe(false);
  });
});

describe('applyDelta', () => {
  it('updates preview text and sets streaming status', () => {
    const map = new Map<string, AgentActivity>();
    applyRunStart(map, 'coder');
    applyDelta(map, 'coder', 'Hello world');
    expect(map.get('coder')?.previewText).toBe('Hello world');
    expect(map.get('coder')?.status).toBe('streaming');
  });

  it('preserves tool_calling status during delta', () => {
    const map = new Map<string, AgentActivity>();
    applyRunStart(map, 'coder');
    applyToolStart(map, 'coder', 'exec');
    applyDelta(map, 'coder', 'some output');
    expect(map.get('coder')?.status).toBe('tool_calling');
  });

  it('truncates long preview text', () => {
    const map = new Map<string, AgentActivity>();
    applyDelta(map, 'coder', 'a'.repeat(200));
    expect(map.get('coder')!.previewText!.length).toBe(81);
  });

  it('suppresses silent NO_REPLY preview fragments', () => {
    const map = new Map<string, AgentActivity>();
    applyDelta(map, 'coder', 'NO');
    expect(map.get('coder')?.previewText).toBeNull();
  });
});

describe('applyToolStart', () => {
  it('sets tool_calling status and tool name', () => {
    const map = new Map<string, AgentActivity>();
    applyRunStart(map, 'coder');
    applyToolStart(map, 'coder', 'exec');
    expect(map.get('coder')?.status).toBe('tool_calling');
    expect(map.get('coder')?.toolName).toBe('exec');
  });
});

describe('applyRunEnd', () => {
  it('returns true when agent was active', () => {
    const map = new Map<string, AgentActivity>();
    applyRunStart(map, 'coder');
    const result = applyRunEnd(map, 'coder');
    expect(result).toBe(true);
    expect(map.get('coder')?.status).toBe('idle');
    expect(map.get('coder')?.toolName).toBeNull();
  });

  it('returns false when agent was already idle', () => {
    const map = new Map<string, AgentActivity>();
    map.set('coder', { agentId: 'coder', status: 'idle', previewText: null, toolName: null, updatedAt: 0 });
    const result = applyRunEnd(map, 'coder');
    expect(result).toBe(false);
  });

  it('returns false when agent is unknown', () => {
    const map = new Map<string, AgentActivity>();
    const result = applyRunEnd(map, 'unknown');
    expect(result).toBe(false);
  });

  it('preserves preview text after run end', () => {
    const map = new Map<string, AgentActivity>();
    applyRunStart(map, 'coder');
    applyDelta(map, 'coder', 'final output');
    applyRunEnd(map, 'coder');
    expect(map.get('coder')?.previewText).toBe('final output');
  });
});
