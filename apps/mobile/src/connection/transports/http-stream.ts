export type HttpHeaders = Record<string, string>;

export type HttpStreamDecodeResult<T> = {
  values: T[];
  rest: string;
};

export type HttpStreamDecoder<T> = (
  buffer: string,
  context: { final: boolean },
) => HttpStreamDecodeResult<T>;

export interface XMLHttpRequestLike {
  readonly status: number;
  readonly statusText: string;
  readonly responseText: string;
  onprogress: (() => void) | null;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  open(method: string, url: string, async: boolean): void;
  setRequestHeader(name: string, value: string): void;
  send(body?: string): void;
  abort(): void;
}

export type XMLHttpRequestFactory = () => XMLHttpRequestLike;

export type HttpStreamTransportOptions = {
  baseUrl: string;
  headers?: HttpHeaders;
  getHeaders?: () => HttpHeaders | Promise<HttpHeaders>;
  getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>;
  refreshAccessToken?: () => boolean | void | Promise<boolean | void>;
  xhrFactory?: XMLHttpRequestFactory;
};

export type HttpStreamRequestOptions<T> = {
  method?: string;
  headers?: HttpHeaders;
  body?: unknown;
  bodyText?: string;
  signal?: AbortSignal;
  decoder?: HttpStreamDecoder<T>;
};

export type HttpStreamErrorCode =
  | 'aborted'
  | 'decode_error'
  | 'http_error'
  | 'network'
  | 'unauthorized';

export class HttpStreamError extends Error {
  constructor(
    public readonly code: HttpStreamErrorCode,
    message: string,
    public readonly status?: number,
    public readonly detailCode?: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'HttpStreamError';
  }
}

/**
 * Incremental XHR transport for React Native. Authentication is expressed in
 * generic HTTP terms so refresh policy can be supplied by any adapter.
 */
export class HttpStreamTransport {
  private readonly baseUrl: string;
  private readonly defaultHeaders: HttpHeaders;
  private readonly getHeaders?: HttpStreamTransportOptions['getHeaders'];
  private readonly getAccessToken?: HttpStreamTransportOptions['getAccessToken'];
  private readonly refreshAccessToken?: HttpStreamTransportOptions['refreshAccessToken'];
  private readonly xhrFactory: XMLHttpRequestFactory;

  constructor(options: HttpStreamTransportOptions) {
    const baseUrl = options.baseUrl.trim();
    if (!baseUrl) throw new TypeError('HTTP transport base URL is required');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.defaultHeaders = { ...(options.headers ?? {}) };
    this.getHeaders = options.getHeaders;
    this.getAccessToken = options.getAccessToken;
    this.refreshAccessToken = options.refreshAccessToken;
    this.xhrFactory = options.xhrFactory ?? createNativeXmlHttpRequest;
  }

  public async stream(
    path: string,
    options?: HttpStreamRequestOptions<string>,
  ): Promise<AsyncGenerator<string>>;
  public async stream<T>(
    path: string,
    options: HttpStreamRequestOptions<T> & { decoder: HttpStreamDecoder<T> },
  ): Promise<AsyncGenerator<T>>;
  public async stream<T = string>(
    path: string,
    options: HttpStreamRequestOptions<T> = {},
  ): Promise<AsyncGenerator<T>> {
    const queue = createAsyncQueue<T>();
    const method = options.method?.trim().toUpperCase() || 'POST';
    const url = resolveUrl(this.baseUrl, path);
    const bodyText = options.bodyText
      ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    const decoder = options.decoder
      ?? rawIncrementalDecoder as unknown as HttpStreamDecoder<T>;
    let activeXhr: XMLHttpRequestLike | null = null;
    let buffer = '';
    let emittedValues = 0;
    let refreshed = false;
    let settled = false;

    const cleanup = () => {
      options.signal?.removeEventListener('abort', handleAbort);
    };

    const settleFailure = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      queue.fail(error);
    };

    const settleSuccess = () => {
      if (settled) return;
      try {
        consumeText('', true);
      } catch (cause) {
        settleFailure(toDecodeError(cause));
        return;
      }
      settled = true;
      cleanup();
      queue.end();
    };

    const consumeText = (text: string, final: boolean) => {
      buffer += text;
      const decoded = decoder(buffer, { final });
      if (!decoded || !Array.isArray(decoded.values) || typeof decoded.rest !== 'string') {
        throw new TypeError('HTTP stream decoder returned an invalid result');
      }
      buffer = decoded.rest;
      emittedValues += decoded.values.length;
      decoded.values.forEach((value) => queue.push(value));
    };

    const handleAbort = () => {
      if (settled) return;
      activeXhr?.abort();
      settleFailure(new HttpStreamError('aborted', 'HTTP stream aborted'));
    };

    const startAttempt = async (): Promise<void> => {
      if (settled) return;
      if (options.signal?.aborted) {
        handleAbort();
        return;
      }

      let headers: HttpHeaders;
      try {
        headers = await this.buildHeaders(options.headers);
      } catch (cause) {
        settleFailure(new HttpStreamError(
          'network',
          cause instanceof Error ? cause.message : 'Failed to prepare HTTP request',
          undefined,
          undefined,
          cause,
        ));
        return;
      }
      if (settled) return;

      let xhr: XMLHttpRequestLike;
      try {
        xhr = this.xhrFactory();
      } catch (cause) {
        settleFailure(new HttpStreamError(
          'network',
          cause instanceof Error ? cause.message : 'Failed to create HTTP request',
          undefined,
          undefined,
          cause,
        ));
        return;
      }
      activeXhr = xhr;
      let processedLength = 0;

      const consumeAvailableSuccessText = () => {
        if (xhr.status < 200 || xhr.status >= 300) return;
        const nextText = xhr.responseText.slice(processedLength);
        processedLength = xhr.responseText.length;
        if (!nextText) return;
        try {
          consumeText(nextText, false);
        } catch (cause) {
          settleFailure(toDecodeError(cause));
          xhr.abort();
        }
      };

      xhr.onprogress = consumeAvailableSuccessText;
      xhr.onload = () => {
        if (settled || activeXhr !== xhr) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          consumeAvailableSuccessText();
          settleSuccess();
          return;
        }
        if (
          xhr.status === 401
          && !refreshed
          && emittedValues === 0
          && this.refreshAccessToken
        ) {
          refreshed = true;
          buffer = '';
          activeXhr = null;
          void Promise.resolve()
            .then(() => this.refreshAccessToken?.())
            .then((didRefresh) => {
              if (didRefresh === false) {
                settleFailure(createHttpError(xhr));
                return;
              }
              return startAttempt();
            })
            .catch((cause) => settleFailure(new HttpStreamError(
              'unauthorized',
              cause instanceof Error ? cause.message : 'Authentication refresh failed',
              401,
              undefined,
              cause,
            )));
          return;
        }
        settleFailure(createHttpError(xhr));
      };
      xhr.onerror = () => {
        if (activeXhr !== xhr) return;
        settleFailure(new HttpStreamError('network', 'HTTP streaming request failed'));
      };
      xhr.onabort = () => {
        if (activeXhr !== xhr || settled) return;
        settleFailure(new HttpStreamError('aborted', 'HTTP stream aborted'));
      };

      try {
        xhr.open(method, url, true);
        Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, value));
        xhr.send(bodyText);
      } catch (cause) {
        settleFailure(new HttpStreamError(
          'network',
          cause instanceof Error ? cause.message : 'HTTP streaming request failed',
          undefined,
          undefined,
          cause,
        ));
      }
    };

    if (options.signal) {
      options.signal.addEventListener('abort', handleAbort);
    }
    void startAttempt();

    const iterate = async function* (): AsyncGenerator<T> {
      try {
        yield* queue.iterate();
      } finally {
        if (!settled) {
          activeXhr?.abort();
          settleFailure(new HttpStreamError('aborted', 'HTTP stream consumer closed'));
        }
      }
    };
    return iterate();
  }

  private async buildHeaders(requestHeaders?: HttpHeaders): Promise<HttpHeaders> {
    const dynamicHeaders = await this.getHeaders?.() ?? {};
    const headers: HttpHeaders = {
      Accept: 'text/event-stream',
      ...this.defaultHeaders,
      ...dynamicHeaders,
      ...(requestHeaders ?? {}),
    };
    const accessToken = (await this.getAccessToken?.())?.trim();
    if (accessToken && !hasHeader(headers, 'authorization')) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    return headers;
  }
}

function createNativeXmlHttpRequest(): XMLHttpRequestLike {
  return new XMLHttpRequest() as unknown as XMLHttpRequestLike;
}

function resolveUrl(baseUrl: string, path: string): string {
  const trimmedPath = path.trim();
  if (/^https?:\/\//i.test(trimmedPath)) return trimmedPath;
  return `${baseUrl}/${trimmedPath.replace(/^\/+/, '')}`;
}

function hasHeader(headers: HttpHeaders, wantedName: string): boolean {
  return Object.keys(headers).some((name) => name.toLowerCase() === wantedName.toLowerCase());
}

function rawIncrementalDecoder(buffer: string): HttpStreamDecodeResult<string> {
  return buffer ? { values: [buffer], rest: '' } : { values: [], rest: '' };
}

function toDecodeError(cause: unknown): HttpStreamError {
  return new HttpStreamError(
    'decode_error',
    cause instanceof Error ? cause.message : 'HTTP stream decoding failed',
    undefined,
    undefined,
    cause,
  );
}

function createHttpError(xhr: XMLHttpRequestLike): HttpStreamError {
  const parsed = parseErrorPayload(xhr.responseText);
  const message = parsed.message || xhr.statusText || (xhr.status === 401 ? 'Unauthorized' : 'Request failed');
  return new HttpStreamError(
    xhr.status === 401 ? 'unauthorized' : 'http_error',
    message,
    xhr.status,
    parsed.code,
  );
}

function parseErrorPayload(text: string): { message?: string; code?: string } {
  try {
    const value = JSON.parse(text) as {
      message?: unknown;
      code?: unknown;
      error?: { message?: unknown; code?: unknown };
    };
    return {
      message: readString(value.message) ?? readString(value.error?.message),
      code: readString(value.code) ?? readString(value.error?.code),
    };
  } catch {
    return {};
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function createAsyncQueue<T>(): {
  push(value: T): void;
  end(): void;
  fail(error: unknown): void;
  iterate(): AsyncGenerator<T>;
} {
  const values: T[] = [];
  const waiters: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: unknown) => void;
  }> = [];
  let done = false;
  let failure: unknown;

  const flush = () => {
    while (waiters.length > 0) {
      if (failure) {
        waiters.shift()?.reject(failure);
      } else if (values.length > 0) {
        waiters.shift()?.resolve({ value: values.shift() as T, done: false });
      } else if (done) {
        waiters.shift()?.resolve({ value: undefined as T, done: true });
      } else {
        return;
      }
    }
  };

  return {
    push(value) {
      if (done || failure) return;
      values.push(value);
      flush();
    },
    end() {
      if (done || failure) return;
      done = true;
      flush();
    },
    fail(error) {
      if (done || failure) return;
      failure = error;
      flush();
    },
    async *iterate() {
      while (true) {
        const result = await new Promise<IteratorResult<T>>((resolve, reject) => {
          waiters.push({ resolve, reject });
          flush();
        });
        if (result.done) return;
        yield result.value;
      }
    },
  };
}
