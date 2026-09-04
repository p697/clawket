export type CompatBackend = 'registry' | 'openclaw' | 'hermes' | 'bridge';

export type CompatFrameKind = 'connection' | 'http' | 'websocket' | 'close';

export type CompatFrameDirection =
  | 'bridge-to-registry'
  | 'registry-to-bridge'
  | 'client-to-registry'
  | 'registry-to-client'
  | 'gateway-to-relay'
  | 'relay-to-gateway'
  | 'client-to-relay'
  | 'relay-to-client'
  | 'relay-to-bridge'
  | 'bridge-to-relay'
  | 'bridge-to-local'
  | 'local-to-bridge';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface GeneratedBase64Value {
  $base64: {
    decodedBytes: number;
    fillByte: number;
    prefixBase64?: string;
    sha256?: string;
  };
}

export interface CompatFixtureSource {
  label: string;
  commit: string;
  provenance: 'production-build' | 'version-bump' | 'inferred-protocol' | 'pre-3.0-snapshot';
}

export interface CompatFrame {
  sequence: number;
  label: string;
  kind: CompatFrameKind;
  direction: CompatFrameDirection;
  annotation?: string;
  payload: JsonValue;
}

export interface CompatFixture {
  schemaVersion: 1;
  id: string;
  backend: CompatBackend;
  recordedAt: string;
  description: string;
  captureMethod: string;
  sources: CompatFixtureSource[];
  ignoredPaths: string[];
  frames: CompatFrame[];
}

export interface CompatComparisonContext {
  readonly captures: Map<string, unknown>;
}

const VALID_BACKENDS = new Set<CompatBackend>(['registry', 'openclaw', 'hermes', 'bridge']);
const VALID_KINDS = new Set<CompatFrameKind>(['connection', 'http', 'websocket', 'close']);
const VALID_DIRECTIONS = new Set<CompatFrameDirection>([
  'bridge-to-registry',
  'registry-to-bridge',
  'client-to-registry',
  'registry-to-client',
  'gateway-to-relay',
  'relay-to-gateway',
  'client-to-relay',
  'relay-to-client',
  'relay-to-bridge',
  'bridge-to-relay',
  'bridge-to-local',
  'local-to-bridge',
]);
const VALID_PROVENANCE = new Set<CompatFixtureSource['provenance']>([
  'production-build',
  'version-bump',
  'inferred-protocol',
  'pre-3.0-snapshot',
]);

export function validateCompatFixture(input: unknown): CompatFixture {
  const errors: string[] = [];
  if (!isRecord(input)) {
    throw new Error('Compatibility fixture must be a JSON object.');
  }

  if (input.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!isNonEmptyString(input.id)) errors.push('id must be a non-empty string');
  if (!VALID_BACKENDS.has(input.backend as CompatBackend)) errors.push('backend is invalid');
  if (!isIsoDate(input.recordedAt)) errors.push('recordedAt must be an ISO-8601 timestamp');
  if (!isNonEmptyString(input.description)) errors.push('description must be a non-empty string');
  if (!isNonEmptyString(input.captureMethod)) errors.push('captureMethod must be a non-empty string');

  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    errors.push('sources must contain at least one pinned source');
  } else {
    input.sources.forEach((source, index) => validateSource(source, `sources[${index}]`, errors));
  }

  if (!Array.isArray(input.ignoredPaths)
    || !input.ignoredPaths.every((path) => typeof path === 'string' && /^\/(?:[^/]|~[01])+(?:\/(?:[^/]|~[01])+)*$/.test(path))) {
    errors.push('ignoredPaths must be an array of JSON Pointer paths');
  }

  if (!Array.isArray(input.frames) || input.frames.length === 0) {
    errors.push('frames must contain at least one frame');
  } else {
    const labels = new Set<string>();
    input.frames.forEach((frame, index) => {
      validateFrame(frame, index, errors);
      if (isRecord(frame) && isNonEmptyString(frame.label)) {
        if (labels.has(frame.label)) errors.push(`frames[${index}].label must be unique`);
        labels.add(frame.label);
      }
    });
  }

  if (errors.length > 0) {
    throw new Error(`Invalid compatibility fixture:\n- ${errors.join('\n- ')}`);
  }
  return input as unknown as CompatFixture;
}

export function findFrame(fixture: CompatFixture, label: string): CompatFrame {
  const frame = fixture.frames.find((candidate) => candidate.label === label);
  if (!frame) throw new Error(`Fixture ${fixture.id} is missing frame ${label}`);
  return frame;
}

export function materializeFixtureValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(materializeFixtureValue);
  if (!isRecord(value)) return value;
  if (isGeneratedBase64Value(value)) {
    const { decodedBytes, fillByte, prefixBase64 } = value.$base64;
    const bytes = Buffer.alloc(decodedBytes, fillByte);
    if (prefixBase64) Buffer.from(prefixBase64, 'base64').copy(bytes);
    return bytes.toString('base64');
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, materializeFixtureValue(entry as JsonValue)]),
  );
}

export function compareCompatValues(
  actual: unknown,
  expected: JsonValue,
  ignoredPaths: readonly string[] = [],
  context: CompatComparisonContext = createCompatComparisonContext(),
): string[] {
  const ignored = new Set(ignoredPaths);
  const errors: string[] = [];
  compareValue(actual, expected, '', ignored, context, errors);
  return errors;
}

export function createCompatComparisonContext(): CompatComparisonContext {
  return { captures: new Map() };
}

function validateSource(source: unknown, path: string, errors: string[]): void {
  if (!isRecord(source)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (!isNonEmptyString(source.label)) errors.push(`${path}.label must be a non-empty string`);
  if (typeof source.commit !== 'string' || !/^[a-f0-9]{40}$/.test(source.commit)) {
    errors.push(`${path}.commit must be a full git SHA`);
  }
  if (!VALID_PROVENANCE.has(source.provenance as CompatFixtureSource['provenance'])) {
    errors.push(`${path}.provenance is invalid`);
  }
}

function validateFrame(frame: unknown, index: number, errors: string[]): void {
  const path = `frames[${index}]`;
  if (!isRecord(frame)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (frame.sequence !== index + 1) errors.push(`${path}.sequence must equal ${index + 1}`);
  if (!isNonEmptyString(frame.label)) errors.push(`${path}.label must be a non-empty string`);
  if (frame.annotation !== undefined && !isNonEmptyString(frame.annotation)) {
    errors.push(`${path}.annotation must be a non-empty string when present`);
  }
  if (!VALID_KINDS.has(frame.kind as CompatFrameKind)) errors.push(`${path}.kind is invalid`);
  if (!VALID_DIRECTIONS.has(frame.direction as CompatFrameDirection)) {
    errors.push(`${path}.direction is invalid`);
  }
  if (!isJsonValue(frame.payload)) errors.push(`${path}.payload must be valid JSON`);
  validateGeneratedValues(frame.payload, `${path}.payload`, errors);
}

function validateGeneratedValues(value: unknown, path: string, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateGeneratedValues(entry, `${path}[${index}]`, errors));
    return;
  }
  if (!isRecord(value)) return;
  if ('$base64' in value) {
    if (!isGeneratedBase64Value(value)) {
      errors.push(`${path} has an invalid $base64 generator`);
    }
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    validateGeneratedValues(entry, `${path}.${key}`, errors);
  }
}

function compareValue(
  actual: unknown,
  expected: JsonValue,
  path: string,
  ignored: ReadonlySet<string>,
  context: CompatComparisonContext,
  errors: string[],
): void {
  if (typeof expected === 'string' && expected.startsWith('$capture:')) {
    const match = expected.match(/^\$capture:([A-Za-z][A-Za-z0-9_-]*):([a-z0-9-]+)$/);
    if (!match || !matchesSentinel(actual, `$any:${match?.[2] ?? ''}`)) {
      errors.push(`${displayPath(path)} expected ${expected}, received ${describe(actual)}`);
      return;
    }
    const previous = context.captures.get(match[1]);
    if (context.captures.has(match[1]) && !deepEqual(previous, actual)) {
      errors.push(`${displayPath(path)} changed capture ${match[1]} from ${describe(previous)} to ${describe(actual)}`);
      return;
    }
    context.captures.set(match[1], cloneJson(actual));
    return;
  }

  if (typeof expected === 'string' && expected.startsWith('$ref:')) {
    const name = expected.slice('$ref:'.length);
    if (!context.captures.has(name)) {
      errors.push(`${displayPath(path)} references missing capture ${name}`);
      return;
    }
    const captured = context.captures.get(name);
    if (!deepEqual(captured, actual)) {
      errors.push(`${displayPath(path)} expected captured ${name}=${describe(captured)}, received ${describe(actual)}`);
    }
    return;
  }

  if (typeof expected === 'string' && expected.startsWith('$any:')) {
    if (!matchesSentinel(actual, expected)) {
      errors.push(`${displayPath(path)} expected ${expected}, received ${describe(actual)}`);
    }
    return;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      errors.push(`${displayPath(path)} expected array, received ${describe(actual)}`);
      return;
    }
    if (actual.length !== expected.length) {
      errors.push(`${displayPath(path)} expected array length ${expected.length}, received ${actual.length}`);
      return;
    }
    expected.forEach((entry, index) => compareValue(actual[index], entry, joinPointer(path, String(index)), ignored, context, errors));
    return;
  }

  if (isRecord(expected)) {
    if (!isRecord(actual)) {
      errors.push(`${displayPath(path)} expected object, received ${describe(actual)}`);
      return;
    }
    const expectedKeys = Object.keys(expected).filter((key) => !ignored.has(joinPointer(path, key))).sort();
    const actualKeys = Object.keys(actual).filter((key) => !ignored.has(joinPointer(path, key))).sort();
    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
      errors.push(`${displayPath(path)} expected keys ${expectedKeys.join(',')}, received ${actualKeys.join(',')}`);
      return;
    }
    for (const key of expectedKeys) {
      compareValue(actual[key], expected[key] as JsonValue, joinPointer(path, key), ignored, context, errors);
    }
    return;
  }

  if (!Object.is(actual, expected)) {
    errors.push(`${displayPath(path)} expected ${describe(expected)}, received ${describe(actual)}`);
  }
}

function joinPointer(path: string, segment: string): string {
  return `${path}/${segment.replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

function displayPath(path: string): string {
  return path || '/';
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function matchesSentinel(actual: unknown, sentinel: string): boolean {
  switch (sentinel) {
    case '$any:string':
      return typeof actual === 'string';
    case '$any:nonempty-string':
      return isNonEmptyString(actual);
    case '$any:number':
      return typeof actual === 'number' && Number.isFinite(actual);
    case '$any:integer':
      return typeof actual === 'number' && Number.isInteger(actual);
    case '$any:iso8601':
      return isIsoDate(actual);
    case '$any:url':
      return typeof actual === 'string' && isUrl(actual);
    case '$any:gateway-id':
      return typeof actual === 'string' && /^gw_[a-f0-9]{32}$/.test(actual);
    case '$any:bridge-id':
      return typeof actual === 'string' && /^hbg_[a-f0-9]{32}$/.test(actual);
    case '$any:session-id':
      return typeof actual === 'string' && /^ps_[a-f0-9]{64}$/.test(actual);
    case '$any:sha256':
      return typeof actual === 'string' && /^[a-f0-9]{64}$/.test(actual);
    default:
      return false;
  }
}

function isGeneratedBase64Value(value: Record<string, unknown>): value is GeneratedBase64Value {
  if (Object.keys(value).length !== 1 || !isRecord(value.$base64)) return false;
  const decodedBytes = value.$base64.decodedBytes;
  const prefix = value.$base64.prefixBase64;
  const sha256 = value.$base64.sha256;
  return Number.isSafeInteger(decodedBytes)
    && (value.$base64.decodedBytes as number) > 0
    && Number.isInteger(value.$base64.fillByte)
    && (value.$base64.fillByte as number) >= 0
    && (value.$base64.fillByte as number) <= 255
    && (prefix === undefined || (typeof prefix === 'string' && Buffer.from(prefix, 'base64').byteLength <= (decodedBytes as number)))
    && (sha256 === undefined || (typeof sha256 === 'string' && /^[a-f0-9]{64}$/.test(sha256)));
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoDate(value: unknown): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function describe(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
