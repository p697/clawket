/**
 * globals.d.ts — Type declarations for Node.js 22 globals
 * that @types/node may not expose depending on version/resolution.
 */

/* global fetch — available in Node.js 18+ */
declare function fetch(input: string | URL, init?: {
  method?: string;
  headers?: Record<string, string> | Headers;
  body?: string | Buffer | ReadableStream | null;
  signal?: AbortSignal;
}): Promise<Response>;

interface Response {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  json(): Promise<unknown>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface Headers {
  get(name: string): string | null;
  has(name: string): boolean;
  set(name: string, value: string): void;
  append(name: string, value: string): void;
  delete(name: string): void;
  forEach(callback: (value: string, key: string) => void): void;
}

/* Request — used only as a cast target for resolveRelayAuthToken shim */
interface Request {
  readonly headers: Headers;
  readonly method: string;
  readonly url: string;
}
