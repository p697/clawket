import { buildGatewayRuntimePatch, parseGatewayRuntimeSettings } from './gateway-settings';

describe('parseGatewayRuntimeSettings', () => {
  it('returns empty settings when config is missing', () => {
    expect(parseGatewayRuntimeSettings(null)).toEqual({
      heartbeatEvery: '',
      heartbeatActiveStart: '',
      heartbeatActiveEnd: '',
      heartbeatActiveTimezone: '',
      heartbeatSession: '',
      heartbeatModel: '',
      defaultModel: '',
      fallbackModels: [],
      thinkingDefault: '',
    });
  });

  it('reads heartbeat and model settings from config', () => {
    const parsed = parseGatewayRuntimeSettings({
      agents: {
        defaults: {
          heartbeat: {
            every: '15m',
            activeHours: {
              start: '09:00',
              end: '18:00',
              timezone: 'Asia/Shanghai',
            },
          },
          model: {
            primary: 'openai/gpt-4.1',
            fallbacks: ['openai/gpt-4.1-mini', 'anthropic/claude-3-5-haiku'],
          },
        },
      },
    });

    expect(parsed).toEqual({
      heartbeatEvery: '15m',
      heartbeatActiveStart: '09:00',
      heartbeatActiveEnd: '18:00',
      heartbeatActiveTimezone: 'Asia/Shanghai',
      heartbeatSession: '',
      heartbeatModel: '',
      defaultModel: 'openai/gpt-4.1',
      fallbackModels: ['openai/gpt-4.1-mini', 'anthropic/claude-3-5-haiku'],
      thinkingDefault: '',
    });
  });

  it('reads heartbeat session and model from config', () => {
    const parsed = parseGatewayRuntimeSettings({
      agents: {
        defaults: {
          heartbeat: {
            every: '1h',
            session: 'heartbeat',
            model: 'anthropic/claude-haiku-4-5-20251001',
          },
        },
      },
    });

    expect(parsed.heartbeatSession).toBe('heartbeat');
    expect(parsed.heartbeatModel).toBe('anthropic/claude-haiku-4-5-20251001');
  });

  it('reads thinkingDefault from config', () => {
    const parsed = parseGatewayRuntimeSettings({
      agents: {
        defaults: {
          thinkingDefault: 'high',
          model: 'openai/gpt-4.1',
        },
      },
    });

    expect(parsed.thinkingDefault).toBe('high');
  });
});

describe('buildGatewayRuntimePatch', () => {
  it('builds merge patch with default model and active hours', () => {
    expect(
      buildGatewayRuntimePatch({
        heartbeatEvery: '30m',
        heartbeatActiveStart: '08:00',
        heartbeatActiveEnd: '20:00',
        heartbeatActiveTimezone: 'user',
        heartbeatSession: 'heartbeat',
        heartbeatModel: 'anthropic/claude-haiku-4-5-20251001',
        defaultModel: 'anthropic/claude-opus-4-5',
        fallbackModels: ['openai/gpt-4.1-mini'],
        thinkingDefault: 'high',
      }),
    ).toEqual({
      agents: {
        defaults: {
          heartbeat: {
            every: '30m',
            session: 'heartbeat',
            model: 'anthropic/claude-haiku-4-5-20251001',
            activeHours: {
              start: '08:00',
              end: '20:00',
              timezone: 'user',
            },
          },
          thinkingDefault: 'high',
          model: {
            primary: 'anthropic/claude-opus-4-5',
            fallbacks: ['openai/gpt-4.1-mini'],
          },
          models: {
            'anthropic/claude-opus-4-5': {},
            'openai/gpt-4.1-mini': {},
          },
        },
      },
    });
  });

  it('keeps fallback order while dropping duplicates and the primary model', () => {
    expect(
      buildGatewayRuntimePatch({
        heartbeatEvery: '',
        heartbeatActiveStart: '',
        heartbeatActiveEnd: '',
        heartbeatActiveTimezone: '',
        heartbeatSession: '',
        heartbeatModel: '',
        defaultModel: 'openai/gpt-4.1',
        fallbackModels: [
          ' openai/gpt-4.1 ',
          'anthropic/claude-3-5-haiku',
          'openai/gpt-4.1-mini',
          'anthropic/claude-3-5-haiku',
          'openai/gpt-4.1-nano',
        ],
        thinkingDefault: '',
      }),
    ).toEqual({
      agents: {
        defaults: {
          heartbeat: {
            every: null,
            session: null,
            model: null,
            activeHours: null,
          },
          thinkingDefault: null,
          model: {
            primary: 'openai/gpt-4.1',
            fallbacks: [
              'anthropic/claude-3-5-haiku',
              'openai/gpt-4.1-mini',
              'openai/gpt-4.1-nano',
            ],
          },
          models: {
            'openai/gpt-4.1': {},
            'anthropic/claude-3-5-haiku': {},
            'openai/gpt-4.1-mini': {},
            'openai/gpt-4.1-nano': {},
          },
        },
      },
    });
  });

  it('clears heartbeat fields when empty and keeps model untouched when blank', () => {
    expect(
      buildGatewayRuntimePatch({
        heartbeatEvery: '',
        heartbeatActiveStart: '',
        heartbeatActiveEnd: '',
        heartbeatActiveTimezone: '',
        heartbeatSession: '',
        heartbeatModel: '',
        defaultModel: '',
        fallbackModels: [],
        thinkingDefault: '',
      }),
    ).toEqual({
      agents: {
        defaults: {
          heartbeat: {
            every: null,
            session: null,
            model: null,
            activeHours: null,
          },
          thinkingDefault: null,
        },
      },
    });
  });
});
