import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { loadCompatFixture } from './loader';
import { findFrame, materializeFixtureValue } from './schema';

const execFileAsync = promisify(execFile);
const RELAY_CONTROL_PREFIX = '__clawket_relay_control__:';
const CLIENT_PINS = [
  ['2.1.0 production', 'c2bfe068da15837d94dce70c3247fb39759e9c59'],
  ['2.1.1 inferred', '31a857abe4aaa362ec335213c8e381135d3ef0a0'],
  ['2.1.2 anchor', '3e37a72e95615ace91c387571f0ef62acadd92e5'],
  ['latest pre-3.0', 'd9c1adae8192839c78cb6e10091551cf342c3a93'],
] as const;

type HistoricalHandler = {
  dispatch(rawData: unknown): void;
  readonly closeCalls: Array<{ code?: number; reason?: string }>;
  readonly forwarded: unknown[];
  readonly firstFrameCount: number;
  readonly ws: { readyState: number };
};

type HistoricalHandlerModule = {
  HistoricalGatewayHandlerHarness: new () => HistoricalHandler;
  parseRelayControlFrame(raw: string): { event: string; payload: Record<string, unknown> } | null;
};

describe('pinned 2.1.x client control compatibility', () => {
  it.each(CLIENT_PINS)('%s ignores unknown relay.ready and keeps dispatching', async (_label, commit) => {
    const fixture = await loadCompatFixture('relay-openclaw/unknown-control-v1.json');
    expect(fixture.sources.map(({ commit: sourceCommit }) => sourceCommit)).toContain(commit);
    const unknownControl = materializeFixtureValue(findFrame(fixture, 'relay-ready.unknown-control').payload);
    const followUp = materializeFixtureValue(findFrame(fixture, 'relay-ready.follow-up').payload);
    expect(typeof unknownControl).toBe('string');

    const historical = await loadHistoricalHandler(commit);
    expect(historical.parseRelayControlFrame(unknownControl as string)).toMatchObject({
      event: 'relay.ready',
      payload: {
        type: 'control',
        payload: { capabilities: ['bridge.capabilities.v2'] },
      },
    });

    const handler = new historical.HistoricalGatewayHandlerHarness();
    handler.dispatch(unknownControl);
    expect(handler.forwarded).toEqual([]);
    expect(handler.closeCalls).toEqual([]);
    expect(handler.ws.readyState).toBe(1);

    const followUpWire = JSON.stringify(followUp);
    handler.dispatch(followUpWire);
    expect(handler.forwarded).toEqual([followUpWire]);
    expect(handler.firstFrameCount).toBe(2);
    expect(handler.closeCalls).toEqual([]);
    expect(handler.ws.readyState).toBe(1);
  });

  it.each([
    ['c2bfe068da15837d94dce70c3247fb39759e9c59', 'getConnectScopes', 'connect.c2.request'],
    ['31a857abe4aaa362ec335213c8e381135d3ef0a0', 'getConnectScopes', 'connect.31a.request'],
    ['d9c1adae8192839c78cb6e10091551cf342c3a93', 'getDefaultConnectScopes', 'connect.d9c.request'],
  ] as const)('uses scopes returned by pinned source %s', async (commit, methodName, frameLabel) => {
    const [gatewaySource, fixture] = await Promise.all([
      gitShow(commit, 'apps/mobile/src/services/gateway.ts'),
      loadCompatFixture('relay-openclaw/openclaw-v1.json'),
    ]);
    const request = materializeFixtureValue(findFrame(fixture, frameLabel).payload);
    if (!isRecord(request) || !isRecord(request.params) || !Array.isArray(request.params.scopes)) {
      throw new Error(`${frameLabel} is missing connect scopes.`);
    }
    expect(request.params.scopes).toEqual(evaluateStringArrayMethod(
      extractClassMethod(gatewaySource, methodName),
      methodName,
    ));
  });
});

async function loadHistoricalHandler(commit: string): Promise<HistoricalHandlerModule> {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error(`Historical client pin is invalid: ${commit}`);
  const [gatewaySource, relaySource] = await Promise.all([
    gitShow(commit, 'apps/mobile/src/services/gateway.ts'),
    gitShow(commit, 'apps/mobile/src/services/gateway-relay.ts'),
  ]);
  expect(relaySource).toContain(`export const RELAY_CONTROL_PREFIX = '${RELAY_CONTROL_PREFIX}'`);

  const rawMethod = extractClassMethod(gatewaySource, 'handleRawMessage');
  const controlMethod = extractClassMethod(gatewaySource, 'handleRelayControlFrame');
  const relayModule = stripImports(relaySource);

  const harnessSource = `
    type GatewayConfig = any;
    function normalizeWsUrl(value: string): string { return value; }
    function resolveGatewayTransportKind(_config: GatewayConfig | null): string { return 'relay'; }
    ${relayModule}
    function handleGatewayRawMessage(context: { forwarded: unknown[] }, rawData: unknown): void {
      context.forwarded.push(rawData);
    }
    export class HistoricalGatewayHandlerHarness {
      readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
      readonly forwarded: unknown[] = [];
      firstFrameCount = 0;
      connectAttemptId = 1;
      activeRoute = 'relay';
      readonly ws: { readyState: number; close: (code?: number, reason?: string) => void } = {
        readyState: 1,
        close: (code?: number, reason?: string) => {
          this.closeCalls.push({ code, reason });
          this.ws.readyState = 3;
        },
      };
      markFirstFrameReceived(): void { this.firstFrameCount += 1; }
      acknowledgeRelayTick(_rawData: unknown): void {}
      logTelemetry(_event: string, _fields: Record<string, unknown>): void {}
      ${rawMethod}
      ${controlMethod}
      dispatch(rawData: unknown): void { this.handleRawMessage(rawData); }
    }
  `;
  const transpiled = ts.transpileModule(harnessSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
    reportDiagnostics: true,
  });
  const syntaxErrors = (transpiled.diagnostics ?? [])
    .filter(({ category }) => category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  if (syntaxErrors.length > 0) {
    throw new Error(`Could not transpile historical client handler ${commit}: ${syntaxErrors.join('; ')}`);
  }

  const exportsObject: Record<string, unknown> = {};
  new Function('exports', transpiled.outputText)(exportsObject);
  if (typeof exportsObject.HistoricalGatewayHandlerHarness !== 'function'
    || typeof exportsObject.parseRelayControlFrame !== 'function') {
    throw new Error(`Historical client handler exports are incomplete at ${commit}.`);
  }
  return exportsObject as HistoricalHandlerModule;
}

async function gitShow(commit: string, path: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['show', `${commit}:${path}`], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (!stdout.trim()) throw new Error(`Historical client source is empty: ${commit}:${path}`);
  return stdout;
}

function extractClassMethod(source: string, methodName: string): string {
  const file = ts.createSourceFile('gateway.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const gatewayClient = file.statements.find(
    (statement): statement is ts.ClassDeclaration => ts.isClassDeclaration(statement)
      && statement.name?.text === 'GatewayClient',
  );
  if (!gatewayClient) throw new Error('Historical gateway.ts is missing GatewayClient.');
  const method = gatewayClient.members.find(
    (member): member is ts.MethodDeclaration => ts.isMethodDeclaration(member)
      && member.name.getText(file) === methodName,
  );
  if (!method?.body) throw new Error(`Historical GatewayClient is missing ${methodName}.`);
  return method.getText(file);
}

function stripImports(source: string): string {
  const file = ts.createSourceFile('gateway-relay.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const statements = file.statements.filter((statement) => !ts.isImportDeclaration(statement));
  if (statements.length === file.statements.length) {
    throw new Error('Historical gateway-relay.ts unexpectedly has no import boundary.');
  }
  return statements.map((statement) => statement.getText(file)).join('\n');
}

function evaluateStringArrayMethod(methodSource: string, methodName: string): string[] {
  const transpiled = ts.transpileModule(`
    export class HistoricalScopeHarness {
      ${methodSource}
      read(): string[] { return this.${methodName}(); }
    }
  `, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  const syntaxError = (transpiled.diagnostics ?? []).find(
    ({ category }) => category === ts.DiagnosticCategory.Error,
  );
  if (syntaxError) {
    throw new Error(ts.flattenDiagnosticMessageText(syntaxError.messageText, '\n'));
  }
  const exportsObject: Record<string, unknown> = {};
  new Function('exports', transpiled.outputText)(exportsObject);
  const ScopeHarness = exportsObject.HistoricalScopeHarness;
  if (typeof ScopeHarness !== 'function') throw new Error('Historical scope harness did not compile.');
  const scopes = (new (ScopeHarness as new () => { read(): unknown })()).read();
  if (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === 'string')) {
    throw new Error(`Historical ${methodName} did not return string scopes.`);
  }
  return scopes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
