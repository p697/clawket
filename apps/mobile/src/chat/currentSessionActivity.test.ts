import { deriveCurrentSessionActivity } from './currentSessionActivity';

describe('deriveCurrentSessionActivity', () => {
  it('treats a remembered run as sending', () => {
    const result = deriveCurrentSessionActivity([], {
      runId: 'run_1',
      streamText: null,
      startedAt: 1000,
    });

    expect(result).toEqual({
      isSending: true,
      hasTrackedRun: true,
      hasRunningTool: false,
      latestRunningToolName: null,
      latestRunningToolTimestampMs: null,
    });
  });

  it('treats a running tool row as sending even without a tracked run', () => {
    const result = deriveCurrentSessionActivity([
      {
        id: 'tool_1',
        role: 'tool',
        text: '',
        toolName: 'search',
        toolStatus: 'running',
        timestampMs: 1234,
      },
    ], null);

    expect(result).toEqual({
      isSending: true,
      hasTrackedRun: false,
      hasRunningTool: true,
      latestRunningToolName: 'search',
      latestRunningToolTimestampMs: 1234,
    });
  });

  it('picks the latest running tool name', () => {
    const result = deriveCurrentSessionActivity([
      {
        id: 'tool_1',
        role: 'tool',
        text: '',
        toolName: 'search',
        toolStatus: 'running',
        timestampMs: 1111,
      },
      {
        id: 'tool_2',
        role: 'tool',
        text: '',
        toolName: 'exec',
        toolStatus: 'running',
        timestampMs: 2222,
      },
    ], null);

    expect(result.latestRunningToolName).toBe('exec');
    expect(result.latestRunningToolTimestampMs).toBe(2222);
  });

  it('returns idle when neither run nor running tool exists', () => {
    const result = deriveCurrentSessionActivity([
      {
        id: 'tool_1',
        role: 'tool',
        text: '',
        toolName: 'search',
        toolStatus: 'success',
      },
    ], null);

    expect(result).toEqual({
      isSending: false,
      hasTrackedRun: false,
      hasRunningTool: false,
      latestRunningToolName: null,
      latestRunningToolTimestampMs: null,
    });
  });

  it('does not report sending when a final assistant message already came after a running tool row', () => {
    const result = deriveCurrentSessionActivity([
      {
        id: 'tool_1',
        role: 'tool',
        text: '',
        toolName: 'search',
        toolStatus: 'running',
        timestampMs: 1111,
      },
      {
        id: 'assistant_1',
        role: 'assistant',
        text: 'Done.',
      },
    ], null);

    expect(result).toEqual({
      isSending: false,
      hasTrackedRun: false,
      hasRunningTool: false,
      latestRunningToolName: 'search',
      latestRunningToolTimestampMs: 1111,
    });
  });
});
