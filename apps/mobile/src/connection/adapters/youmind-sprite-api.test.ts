import type { YouMindAuthSession } from '../../services/storage';
import { HttpStreamError, HttpStreamTransport } from '../transports';
import {
  mapYouMindSpriteApiError,
  parseYouMindSuccessPayload,
  YouMindSpriteApiClient,
  youMindSseDecoder,
} from './youmind-sprite-api';

describe('YouMindSpriteApiClient', () => {
  it('sends and verifies email OTP with the existing scoped session storage', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ sent: true }))
      .mockResolvedValueOnce(response({
        accessToken: 'access-one',
        refreshToken: 'refresh-one',
        expiresIn: 3_600,
        user: { id: 'user-one', email: 'person@example.invalid' },
      }));
    const storage = {
      getYouMindAuthSession: jest.fn(async () => null),
      setYouMindAuthSession: jest.fn(async () => undefined),
      clearYouMindAuthSession: jest.fn(async () => undefined),
      getYouMindDeviceId: jest.fn(async () => 'device-one'),
      setYouMindDeviceId: jest.fn(async () => undefined),
    };
    const api = new YouMindSpriteApiClient(
      'https://youmind.example.invalid/',
      'account-one',
      {
        storage,
        fetchImpl,
        now: () => 100_000,
        platform: 'ios',
        timeZone: () => 'Asia/Tokyo',
        appSecret: 'test-app-secret',
      },
    );

    await api.sendOtp(' person@example.invalid ');
    const session = await api.verifyOtp(' person@example.invalid ', '123456');

    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://youmind.example.invalid/api/v1/auth/signInWithOTP',
    );
    expect(fetchImpl.mock.calls[0][1].headers).toEqual(expect.objectContaining({
      'x-app-id': '0',
      'x-timestamp': '100000',
      'x-signature': expect.any(String),
      'User-Agent': expect.stringMatching(/^YouMindClawket\/\d+\.\d+\.\d+ \(Clawket; iOS [^;]+; Build \d+; (Development|AppStore)\)$/),
    }));
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      email: 'person@example.invalid',
      timeZone: 'Asia/Tokyo',
    });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({
      formData: {
        email: 'person@example.invalid',
        token: ['1', '2', '3', '4', '5', '6'],
      },
      timeZone: 'Asia/Tokyo',
    });
    expect(session).toEqual(expect.objectContaining({
      accessToken: 'access-one',
      refreshToken: 'refresh-one',
      createdAtMs: 100_000,
    }));
    expect(storage.setYouMindAuthSession).toHaveBeenCalledWith(
      'https://youmind.example.invalid',
      session,
      'account-one',
    );
  });

  it('refreshes an expiring session before an authenticated request and persists it', async () => {
    let stored: YouMindAuthSession | null = {
      accessToken: 'expired-access',
      refreshToken: 'refresh-one',
      expiresIn: 60,
      createdAtMs: 1,
      user: { id: 'user-one' },
    };
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({
        accessToken: 'fresh-access',
        refreshToken: 'refresh-two',
        expiresIn: 3_600,
      }))
      .mockResolvedValueOnce(response({
        sprite: { id: 'sprite-one', creatorId: 'user-one' },
      }));
    const storage = {
      getYouMindAuthSession: jest.fn(async () => stored),
      setYouMindAuthSession: jest.fn(async (_url: string, next: YouMindAuthSession) => {
        stored = next;
      }),
      clearYouMindAuthSession: jest.fn(async () => undefined),
      getYouMindDeviceId: jest.fn(async () => 'device-one'),
      setYouMindDeviceId: jest.fn(async () => undefined),
    };
    const api = new YouMindSpriteApiClient(
      'https://youmind.example.invalid/',
      'account-one',
      { storage, fetchImpl, now: () => 100_000, platform: 'ios', timeZone: () => 'UTC' },
    );

    await expect(api.ensureDefaultSprite()).resolves.toMatchObject({ id: 'sprite-one' });

    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://youmind.example.invalid/api/v1/auth/mobile/refreshToken',
    );
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ refreshToken: 'refresh-one' });
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh-access');
    expect(storage.setYouMindAuthSession).toHaveBeenCalledWith(
      'https://youmind.example.invalid',
      expect.objectContaining({ accessToken: 'fresh-access', user: { id: 'user-one' } }),
      'account-one',
    );
  });

  it('retries one authenticated JSON request after a 401', async () => {
    let stored: YouMindAuthSession | null = {
      accessToken: 'old-access',
      refreshToken: 'refresh-one',
      expiresIn: 3_600,
      createdAtMs: 100_000,
    };
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ message: 'expired' }, 401))
      .mockResolvedValueOnce(response({
        accessToken: 'fresh-access',
        refreshToken: 'refresh-two',
        expiresIn: 3_600,
      }))
      .mockResolvedValueOnce(response({ sprite: { id: 'sprite-one' } }));
    const api = new YouMindSpriteApiClient(
      'https://youmind.example.invalid',
      'account-one',
      {
        now: () => 100_001,
        timeZone: () => 'UTC',
        fetchImpl,
        storage: {
          getYouMindAuthSession: jest.fn(async () => stored),
          setYouMindAuthSession: jest.fn(async (_url: string, next: YouMindAuthSession) => {
            stored = next;
          }),
          clearYouMindAuthSession: jest.fn(async () => { stored = null; }),
          getYouMindDeviceId: jest.fn(async () => 'device-one'),
          setYouMindDeviceId: jest.fn(async () => undefined),
        },
      },
    );

    await expect(api.ensureDefaultSprite()).resolves.toMatchObject({ id: 'sprite-one' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[2][1].headers.Authorization).toBe('Bearer fresh-access');
  });

  it('clears the scoped session when one refresh still leaves the request unauthorized', async () => {
    let stored: YouMindAuthSession | null = {
      accessToken: 'old-access',
      refreshToken: 'refresh-one',
      expiresIn: 3_600,
      createdAtMs: 100_000,
    };
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ message: 'expired' }, 401))
      .mockResolvedValueOnce(response({
        accessToken: 'fresh-access',
        refreshToken: 'refresh-two',
        expiresIn: 3_600,
      }))
      .mockResolvedValueOnce(response({ message: 'sign in again' }, 401));
    const storage = {
      getYouMindAuthSession: jest.fn(async () => stored),
      setYouMindAuthSession: jest.fn(async (_url: string, next: YouMindAuthSession) => {
        stored = next;
      }),
      clearYouMindAuthSession: jest.fn(async () => { stored = null; }),
      getYouMindDeviceId: jest.fn(async () => 'device-one'),
      setYouMindDeviceId: jest.fn(async () => undefined),
    };
    const api = new YouMindSpriteApiClient(
      'https://youmind.retry.invalid',
      'account-one',
      { storage, fetchImpl, now: () => 100_001, platform: 'ios', timeZone: () => 'UTC' },
    );

    await expect(api.ensureDefaultSprite()).rejects.toMatchObject({ status: 401 });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(storage.clearYouMindAuthSession).toHaveBeenCalledWith(
      'https://youmind.retry.invalid',
      'account-one',
    );
    expect(stored).toBeNull();
  });

  it('shares one rotating refresh across clients for the same account scope', async () => {
    let stored: YouMindAuthSession | null = {
      accessToken: 'expired-access',
      refreshToken: 'refresh-one',
      expiresIn: 60,
      createdAtMs: 1,
      user: { id: 'user-one' },
    };
    let resolveRefresh: ((value: Response) => void) | undefined;
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const firstFetch = jest.fn()
      .mockImplementationOnce(() => refreshResponse)
      .mockResolvedValueOnce(response({ sprite: { id: 'sprite-one' } }));
    const secondFetch = jest.fn()
      .mockResolvedValueOnce(response({ sprite: { id: 'sprite-one' } }));
    const storage = {
      getYouMindAuthSession: jest.fn(async () => stored),
      setYouMindAuthSession: jest.fn(async (_url: string, next: YouMindAuthSession) => {
        stored = next;
      }),
      clearYouMindAuthSession: jest.fn(async () => { stored = null; }),
      getYouMindDeviceId: jest.fn(async () => 'device-one'),
      setYouMindDeviceId: jest.fn(async () => undefined),
    };
    const options = { storage, now: () => 100_000, platform: 'ios', timeZone: () => 'UTC' };
    const first = new YouMindSpriteApiClient(
      'https://youmind.shared.invalid',
      'account-one',
      { ...options, fetchImpl: firstFetch },
    );
    const second = new YouMindSpriteApiClient(
      'https://youmind.shared.invalid',
      'account-one',
      { ...options, fetchImpl: secondFetch },
    );

    const firstRequest = first.ensureDefaultSprite();
    const secondRequest = second.ensureDefaultSprite();
    await flushPromises();

    expect(firstFetch).toHaveBeenCalledTimes(1);
    expect(secondFetch).not.toHaveBeenCalled();
    resolveRefresh?.(response({
      accessToken: 'fresh-access',
      refreshToken: 'refresh-two',
      expiresIn: 3_600,
    }));

    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([
      expect.objectContaining({ id: 'sprite-one' }),
      expect.objectContaining({ id: 'sprite-one' }),
    ]);
    expect(firstFetch).toHaveBeenCalledTimes(2);
    expect(secondFetch).toHaveBeenCalledTimes(1);
    expect(storage.setYouMindAuthSession).toHaveBeenCalledTimes(1);
  });

  it('builds the production Sprite prompt body without unsupported context fields', async () => {
    const stream = async function* () { yield { mode: 'event', event: 'task-ended' } as const; };
    const streamMethod = jest.fn(async (
      _path: string,
      _options: Record<string, unknown>,
    ) => stream());
    const api = new YouMindSpriteApiClient(
      'https://youmind.example.invalid',
      'account-one',
      {
        now: () => Date.parse('2026-09-01T10:00:00.000Z'),
        timeZone: () => 'UTC',
        streamTransport: { stream: streamMethod } as unknown as HttpStreamTransport,
      },
    );

    await api.streamSpriteMessage({
      spriteId: 'sprite-one',
      userId: 'user-one',
      text: 'hello',
    });

    const request = streamMethod.mock.calls[0]?.[1];
    expect(request).toBeDefined();
    if (!request) throw new Error('stream request was not captured');
    expect(request.body).toEqual(expect.objectContaining({
      spriteId: 'sprite-one',
      userId: 'user-one',
      useComputer: false,
      messages: [expect.objectContaining({
        role: 'user',
        content: 'hello',
        messageContext: expect.objectContaining({
          schema: 'youmind.sprite.message_context.v1',
          surface: 'saas',
          conversationType: 'direct',
        }),
      })],
    }));
    expect(request.body).not.toHaveProperty('additionalContexts');
  });
});

describe('parseYouMindSuccessPayload', () => {
  it('keeps legacy success-body parsing while the old screens are being removed', () => {
    expect(parseYouMindSuccessPayload<void>('   ')).toBeUndefined();
    expect(parseYouMindSuccessPayload<{ ok: boolean }>('{"ok":true}')).toEqual({ ok: true });
    expect(parseYouMindSuccessPayload<number>('1')).toBe(1);
    expect(parseYouMindSuccessPayload<boolean>('true')).toBe(true);
    expect(parseYouMindSuccessPayload<string>(' deleted ')).toBe('deleted');
  });
});

describe('youMindSseDecoder', () => {
  it('retains partial events and parses multiple CRLF-delimited chunks', () => {
    const first = youMindSseDecoder(
      'event: message\r\ndata: {"mode":"event","event":"task-started"}\r\n',
      { final: false },
    );
    expect(first.values).toEqual([]);

    const second = youMindSseDecoder(
      `${first.rest}\r\ndata: {"mode":"event","event":"task-ended"}\r\n\r\n`,
      { final: false },
    );
    expect(second.values).toEqual([
      { mode: 'event', event: 'task-started' },
      { mode: 'event', event: 'task-ended' },
    ]);
    expect(second.rest).toBe('');
  });

  it('ignores the terminal SSE sentinel', () => {
    expect(youMindSseDecoder('data: [DONE]', { final: true })).toEqual({
      values: [],
      rest: '',
    });
  });
});

describe('mapYouMindSpriteApiError', () => {
  it('classifies malformed stream payloads as server responses', () => {
    expect(mapYouMindSpriteApiError(
      new HttpStreamError('decode_error', 'invalid stream'),
    )).toMatchObject({ status: 500 });
  });
});

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? 'Unauthorized' : 'OK',
    text: async () => JSON.stringify(body),
  } as Response;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
