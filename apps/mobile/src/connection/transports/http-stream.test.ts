import {
  HttpStreamError,
  HttpStreamTransport,
  type HttpStreamDecoder,
  type XMLHttpRequestLike,
} from './http-stream';

class FakeXmlHttpRequest implements XMLHttpRequestLike {
  status = 0;
  statusText = '';
  responseText = '';
  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  method = '';
  url = '';
  async = false;
  body: string | undefined;
  aborted = false;
  readonly headers: Record<string, string> = {};

  open(method: string, url: string, async: boolean): void {
    this.method = method;
    this.url = url;
    this.async = async;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  send(body?: string): void {
    this.body = body;
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }

  progress(text: string, status = 200): void {
    this.status = status;
    this.responseText += text;
    this.onprogress?.();
  }

  load(status: number, text = '', statusText = ''): void {
    this.status = status;
    this.statusText = statusText;
    this.responseText += text;
    this.onload?.();
  }
}

describe('HttpStreamTransport', () => {
  it('emits only newly appended XHR response text', async () => {
    const requests: FakeXmlHttpRequest[] = [];
    const transport = new HttpStreamTransport({
      baseUrl: 'https://api.example/',
      getAccessToken: () => 'token-1',
      xhrFactory: () => {
        const request = new FakeXmlHttpRequest();
        requests.push(request);
        return request;
      },
    });

    const stream = await transport.stream('/stream', { body: { hello: 'world' } });
    const resultPromise = collect(stream);
    await flushPromises();
    requests[0].progress('first');
    requests[0].progress(' second');
    requests[0].load(200, ' third');

    await expect(resultPromise).resolves.toEqual(['first', ' second', ' third']);
    expect(requests[0].url).toBe('https://api.example/stream');
    expect(requests[0].method).toBe('POST');
    expect(requests[0].headers).toMatchObject({
      Accept: 'text/event-stream',
      Authorization: 'Bearer token-1',
    });
    expect(requests[0].body).toBe(JSON.stringify({ hello: 'world' }));
  });

  it('supports incremental buffering through an adapter-provided decoder', async () => {
    const request = new FakeXmlHttpRequest();
    const decoder: HttpStreamDecoder<string> = (buffer, { final }) => {
      const parts = buffer.split('\n');
      const rest = final ? '' : parts.pop() ?? '';
      const values = (final ? parts : parts).filter(Boolean);
      if (final && parts.length === 0 && buffer.trim()) values.push(buffer.trim());
      return { values, rest };
    };
    const transport = new HttpStreamTransport({
      baseUrl: 'https://api.example',
      xhrFactory: () => request,
    });

    const stream = await transport.stream<string>('/stream', { decoder });
    const resultPromise = collect(stream);
    await flushPromises();
    request.progress('one\ntw');
    request.progress('o\nthree');
    request.load(200);

    await expect(resultPromise).resolves.toEqual(['one', 'two', 'three']);
  });

  it('refreshes bearer authentication once after a 401 and retries the stream', async () => {
    const requests: FakeXmlHttpRequest[] = [];
    let token = 'expired';
    const refreshAccessToken = jest.fn(async () => {
      token = 'fresh';
      return true;
    });
    const transport = new HttpStreamTransport({
      baseUrl: 'https://api.example',
      getAccessToken: () => token,
      refreshAccessToken,
      xhrFactory: () => {
        const request = new FakeXmlHttpRequest();
        requests.push(request);
        return request;
      },
    });

    const stream = await transport.stream('/stream');
    const resultPromise = collect(stream);
    await flushPromises();
    requests[0].load(401, JSON.stringify({ message: 'expired' }));
    await waitForRequestCount(requests, 2);
    requests[1].progress('ok');
    requests[1].load(200);

    await expect(resultPromise).resolves.toEqual(['ok']);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(requests[0].headers.Authorization).toBe('Bearer expired');
    expect(requests[1].headers.Authorization).toBe('Bearer fresh');
  });

  it('fails closed as unauthorized when the retried request is also 401', async () => {
    const requests: FakeXmlHttpRequest[] = [];
    const transport = new HttpStreamTransport({
      baseUrl: 'https://api.example',
      refreshAccessToken: () => true,
      xhrFactory: () => {
        const request = new FakeXmlHttpRequest();
        requests.push(request);
        return request;
      },
    });
    const stream = await transport.stream('/stream');
    const resultPromise = collect(stream);
    await flushPromises();
    requests[0].load(401);
    await waitForRequestCount(requests, 2);
    requests[1].load(401, JSON.stringify({ error: { code: 'bad_token', message: 'log in' } }));

    await expect(resultPromise).rejects.toMatchObject({
      name: 'HttpStreamError',
      code: 'unauthorized',
      status: 401,
      detailCode: 'bad_token',
    });
  });

  it('does not retry a 401 after any response value has been emitted', async () => {
    const request = new FakeXmlHttpRequest();
    const refreshAccessToken = jest.fn();
    const transport = new HttpStreamTransport({
      baseUrl: 'https://api.example',
      refreshAccessToken,
      xhrFactory: () => request,
    });
    const stream = await transport.stream('/stream');
    const resultPromise = collect(stream);
    await flushPromises();
    request.progress('partial', 200);
    request.load(401, JSON.stringify({ message: 'expired late' }));

    await expect(resultPromise).rejects.toBeInstanceOf(HttpStreamError);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('aborts the active XHR and rejects the iterator with a stable code', async () => {
    const request = new FakeXmlHttpRequest();
    const controller = new AbortController();
    const transport = new HttpStreamTransport({
      baseUrl: 'https://api.example',
      xhrFactory: () => request,
    });
    const stream = await transport.stream('/stream', { signal: controller.signal });
    const resultPromise = collect(stream);
    await flushPromises();

    controller.abort();

    await expect(resultPromise).rejects.toMatchObject({ code: 'aborted' });
    expect(request.aborted).toBe(true);
  });

  it('maps XHR network failure to a stable transport error', async () => {
    const request = new FakeXmlHttpRequest();
    const transport = new HttpStreamTransport({
      baseUrl: 'https://api.example',
      xhrFactory: () => request,
    });
    const stream = await transport.stream('/stream');
    const resultPromise = collect(stream);
    await flushPromises();
    request.onerror?.();

    await expect(resultPromise).rejects.toMatchObject({ code: 'network' });
  });
});

async function collect<T>(stream: AsyncGenerator<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForRequestCount(
  requests: FakeXmlHttpRequest[],
  expected: number,
): Promise<void> {
  for (let index = 0; index < 20 && requests.length < expected; index += 1) {
    await Promise.resolve();
  }
  expect(requests).toHaveLength(expected);
}
