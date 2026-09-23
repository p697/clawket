import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./auth', () => ({ verifyRequest: vi.fn() }));
vi.mock('./admission', () => ({ SpeechAdmission: class {} }));
vi.mock('./session', () => ({ serveSession: vi.fn() }));
import worker from './index';
import { verifyRequest } from './auth';
import { serveSession } from './session';

const NativeResponse = Response;
describe('speech admission and upgrade', () => {
  const reserve = vi.fn(), release = vi.fn(), upstream = vi.fn(), waitUntil = vi.fn();
  let server: { binaryType: string; accept: ReturnType<typeof vi.fn> };
  const env = { SPEECH_ENABLED: 'true', ALIYUN_SPEECH_API_KEY: 'test-secret',
    ALIYUN_SPEECH_URL: 'https://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference',
    ADMISSION: { getByName: () => ({ reserveDetailed: reserve, release }) } } as unknown as Env & { ALIYUN_SPEECH_API_KEY: string };
  const request = () => new Request('https://speech.example/v1/speech', { headers: { Upgrade: 'websocket' } });
  const run = () => worker.fetch(request(), env, { waitUntil } as unknown as ExecutionContext);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyRequest).mockResolvedValue({ device: 'device', nonce: 'nonce' });
    reserve.mockResolvedValue({ allowed: true }); release.mockResolvedValue(undefined);
    server = { binaryType: 'blob', accept: vi.fn(() => expect(server.binaryType).toBe('arraybuffer')) };
    vi.stubGlobal('WebSocketPair', class { 0 = {}; 1 = server; });
    vi.stubGlobal('Response', class extends NativeResponse {
      constructor(body?: BodyInit | null, init?: ResponseInit) {
        super(body, init?.status === 101 ? { status: 200 } : init);
        if (init?.status === 101) Object.defineProperty(this, 'status', { value: 101 });
      }
    });
    upstream.mockImplementation(async (_url, options) => {
      // The edge runtime rejects redirect:error before making a network request.
      expect(options.redirect).toBe('manual');
      expect(options.headers.Authorization).toBe('Bearer test-secret');
      return { status: 101, webSocket: { accept: vi.fn() } };
    });
    vi.stubGlobal('fetch', upstream);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  function fakeUpgradeClock() {
    vi.useFakeTimers();
    // Native AbortSignal.timeout is not driven by Vitest's fake clock.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
  }
  it('does not abort an upgraded provider socket when the handshake deadline passes', async () => {
    fakeUpgradeClock();
    expect((await run()).status).toBe(101);
    const signal = upstream.mock.calls[0]![1].signal as AbortSignal;
    const disconnected = vi.fn();
    signal.addEventListener('abort', disconnected);
    await vi.advanceTimersByTimeAsync(120000);
    expect(disconnected).not.toHaveBeenCalled();
    expect(signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('still aborts a stalled provider handshake and releases its device lease', async () => {
    fakeUpgradeClock();
    let started!: () => void;
    const fetching = new Promise<void>((resolve) => { started = resolve; });
    upstream.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('timed out')));
      started();
    }));
    const response = run();
    await fetching;
    await vi.advanceTimersByTimeAsync(10000);
    expect((await response).status).toBe(502);
    expect(release).toHaveBeenCalledWith('nonce');
    expect(serveSession).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['rejected', 'http-error'])('clears the handshake timer after %s upgrade', async (mode) => {
    fakeUpgradeClock();
    if (mode === 'rejected') upstream.mockRejectedValue(new Error('network failed'));
    else upstream.mockResolvedValue({ status: 503 });
    expect((await run()).status).toBe(502);
    expect(vi.getTimerCount()).toBe(0);
    expect(release).toHaveBeenCalledWith('nonce');
  });
  it('accepts PCM as ArrayBuffer before upgrading and reserves all three quotas', async () => {
    expect((await run()).status).toBe(101);
    expect(reserve).toHaveBeenCalledTimes(3); expect(server.accept).toHaveBeenCalled(); expect(serveSession).toHaveBeenCalled();
  });
  it('rejects redirects instead of forwarding credentials to another host', async () => {
    upstream.mockResolvedValue({ status: 302 });
    expect((await run()).status).toBe(502); expect(upstream).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith('nonce'); expect(serveSession).not.toHaveBeenCalled();
  });
  it('rejects unauthenticated requests before allocating admission state', async () => {
    vi.mocked(verifyRequest).mockResolvedValue(null);
    expect((await run()).status).toBe(401); expect(reserve).not.toHaveBeenCalled(); expect(upstream).not.toHaveBeenCalled();
  });
  it('quota failure never starts a paid provider task', async () => {
    reserve.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false, reason: 'quota', retryAfterMs: 5000 });
    expect((await run()).status).toBe(429); expect(upstream).not.toHaveBeenCalled(); expect(release).toHaveBeenCalled();
  });
  it.each([
    ['busy', 'speech_busy', 0], ['quota', 'speech_device_limit', 0],
    ['quota', 'speech_ip_limit', 1], ['quota', 'speech_daily_limit', 2],
    ['storage', 'speech_admission_failed', 0],
  ])('v2 reports %s / %s without starting provider work', async (reason, code, passed) => {
    server.accept.mockImplementation(() => {});
    const send = vi.fn(), close = vi.fn(); Object.assign(server, { send, close });
    for (let n = 0; n < Number(passed); n++) reserve.mockResolvedValueOnce({ allowed: true });
    reserve.mockResolvedValueOnce({ allowed: false, reason, retryAfterMs: 1234 });
    const request = new Request('https://speech.example/v1/speech', { headers: { Upgrade: 'websocket', 'x-speech-protocol': '2' } });
    expect((await worker.fetch(request, env, { waitUntil } as unknown as ExecutionContext)).status).toBe(101);
    expect(JSON.parse(send.mock.calls[0]![0])).toMatchObject({ type: 'error', code, retryAfterMs: 1234, requestId: expect.any(String) });
    expect(upstream).not.toHaveBeenCalled(); expect(close).toHaveBeenCalled();
  });

});
