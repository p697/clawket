import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { loadCompatFixture } from './loader';
import { findFrame, materializeFixtureValue } from './schema';

const execFileAsync = promisify(execFile);
const IMAGE_SOURCE_PATH = 'apps/mobile/src/screens/ChatScreen/hooks/preparePendingImagesForSend.ts';
const GATEWAY_SOURCE_PATH = 'apps/mobile/src/services/gateway.ts';
const HARD_LIMIT_BYTES = 5 * 1024 * 1024;
const ONE_AND_A_HALF_MIB_BYTES = 1_572_864;
const IMAGE_PINS = [
  ['2.1.0 production', 'c2bfe068da15837d94dce70c3247fb39759e9c59'],
  ['2.1.1 inferred', '31a857abe4aaa362ec335213c8e381135d3ef0a0'],
  ['2.1.2 anchor', '3e37a72e95615ace91c387571f0ef62acadd92e5'],
  ['latest pre-3.0', 'd9c1adae8192839c78cb6e10091551cf342c3a93'],
] as const;

type PendingImage = {
  uri: string;
  base64: string;
  mimeType: string;
  width?: number;
  height?: number;
};

type PreparedImageResult = {
  images: PendingImage[];
  changed: boolean;
};

type ManipulatorCall = {
  uri: string;
  actions: unknown[];
  options: { base64: boolean; compress: number; format: string };
};

type HistoricalImagePipeline = {
  hardLimitBytes: number;
  preparePendingImagesForSend(images: PendingImage[]): Promise<PreparedImageResult>;
};

type HistoricalGatewayHarness = {
  sendChat(
    sessionKey: string,
    text: string,
    attachments?: Array<{ type: string; mimeType: string; content: string }>,
    options?: { idempotencyKey?: string },
  ): Promise<{ runId: string }>;
};

type HistoricalGatewayHarnessConstructor = new (
  onWire: (wire: string) => void,
) => HistoricalGatewayHarness;

const imagePipelineCache = new Map<string, Promise<{
  create(candidateDecodedBytes: readonly number[]): {
    pipeline: HistoricalImagePipeline;
    calls: ManipulatorCall[];
  };
}>>();
const gatewayHarnessCache = new Map<string, Promise<HistoricalGatewayHarnessConstructor>>();

describe('pinned 2.1.x historical image send pipeline', () => {
  it('materializes the reviewed 1.5 MiB fixture to an exact WebSocket wire size', async () => {
    const fixture = await loadCompatFixture('relay-openclaw/openclaw-v1.json');
    const payload = materializeFixtureValue(findFrame(fixture, 'chat-send-1.5m.request').payload);
    const attachment = readFirstAttachment(payload);
    const wire = JSON.stringify(payload);

    expect(Buffer.from(attachment.content, 'base64').byteLength).toBe(ONE_AND_A_HALF_MIB_BYTES);
    expect(attachment.content.length).toBe(2_097_152);
    expect(Buffer.byteLength(wire, 'utf8')).toBe(2_097_412);
  });

  it.each(IMAGE_PINS)(
    '%s executes the extracted compressor and returns a best candidate above its 5 MiB hard limit',
    async (_label, commit) => {
      const loaded = await loadHistoricalImagePipeline(commit);
      const aboveLimitSizes = [
        HARD_LIMIT_BYTES + 303,
        HARD_LIMIT_BYTES + 202,
        HARD_LIMIT_BYTES + 101,
      ] as const;
      const { pipeline, calls } = loaded.create(aboveLimitSizes);
      const originalBytes = HARD_LIMIT_BYTES + 1_024;

      const result = await pipeline.preparePendingImagesForSend([{
        uri: 'file:///historical-input.jpg',
        base64: zeroFilledBase64(originalBytes),
        mimeType: 'image/jpeg',
        width: 4_032,
        height: 3_024,
      }]);

      expect(pipeline.hardLimitBytes).toBe(HARD_LIMIT_BYTES);
      expect(calls.map(({ options }) => options.compress)).toEqual([0.82, 0.76, 0.7]);
      expect(calls.every(({ options }) => options.format === 'jpeg')).toBe(true);
      expect(result.changed).toBe(true);
      expect(result.images).toHaveLength(1);
      expect(decodedBase64Bytes(result.images[0].base64)).toBe(HARD_LIMIT_BYTES + 101);
      expect(decodedBase64Bytes(result.images[0].base64)).toBeGreaterThan(pipeline.hardLimitBytes);
      expect(result.images[0].uri).toBe('mock://candidate-3');
    },
  );

  it.each(IMAGE_PINS)(
    '%s serializes image attachments through extracted sendChat and WebSocket send boundaries',
    async (_label, commit) => {
      const fixture = await loadCompatFixture('relay-openclaw/openclaw-v1.json');
      const fixturePayload = materializeFixtureValue(findFrame(fixture, 'chat-send-1.5m.request').payload);
      const fixtureAttachment = readFirstAttachment(fixturePayload);
      const GatewayHarness = await loadHistoricalGatewayHarness(commit);

      const fixtureWire = captureChatWire(GatewayHarness, fixtureAttachment.content);
      expect(fixtureWire).toBe(JSON.stringify(fixturePayload));
      expect(Buffer.byteLength(fixtureWire, 'utf8')).toBe(2_097_412);

      const hardLimitBase64 = zeroFilledBase64(HARD_LIMIT_BYTES);
      const hardLimitWire = captureChatWire(GatewayHarness, hardLimitBase64);
      expect(hardLimitBase64.length).toBe(6_990_508);
      expect(Buffer.from(hardLimitBase64, 'base64').byteLength).toBe(HARD_LIMIT_BYTES);
      expect(Buffer.byteLength(hardLimitWire, 'utf8')).toBe(6_990_768);
    },
  );
});

async function loadHistoricalImagePipeline(commit: string): Promise<{
  create(candidateDecodedBytes: readonly number[]): {
    pipeline: HistoricalImagePipeline;
    calls: ManipulatorCall[];
  };
}> {
  const cached = imagePipelineCache.get(commit);
  if (cached) return cached;
  const pending = (async () => {
    const source = await gitShowPinnedSource(commit, IMAGE_SOURCE_PATH);
    const sourceFile = parseHistoricalSource(source, `${commit}:${IMAGE_SOURCE_PATH}`);
    const extractedSource = extractImagePipelineSource(sourceFile);
    const compiled = compileImagePipeline(extractedSource, commit);

    return {
      create(candidateDecodedBytes: readonly number[]) {
        if (candidateDecodedBytes.length !== 3) {
          throw new Error(`Historical image mock requires all three compression candidates at ${commit}.`);
        }
        const calls: ManipulatorCall[] = [];
        let candidateIndex = 0;
        const expoImageManipulator = {
          SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
          async manipulateAsync(uri: string, actions: unknown[], options: ManipulatorCall['options']) {
            const decodedBytes = candidateDecodedBytes[candidateIndex];
            if (decodedBytes === undefined) {
              throw new Error(`Historical image pipeline requested an unexpected fourth candidate at ${commit}.`);
            }
            candidateIndex += 1;
            calls.push({ uri, actions, options });
            return {
              uri: `mock://candidate-${candidateIndex}`,
              base64: zeroFilledBase64(decodedBytes),
              width: 1_280,
              height: 960,
            };
          },
        };
        const exportsObject: Record<string, unknown> = {};
        compiled(
          async () => expoImageManipulator,
          async () => {
            throw new Error(`Historical image pipeline unexpectedly read an on-device file at ${commit}.`);
          },
          exportsObject,
        );
        if (typeof exportsObject.preparePendingImagesForSend !== 'function'
          || typeof exportsObject.historicalImageHardLimitBytes !== 'number') {
          throw new Error(`Historical image pipeline exports are incomplete at ${commit}.`);
        }
        return {
          pipeline: {
            hardLimitBytes: exportsObject.historicalImageHardLimitBytes,
            preparePendingImagesForSend: exportsObject.preparePendingImagesForSend,
          } as HistoricalImagePipeline,
          calls,
        };
      },
    };
  })();
  imagePipelineCache.set(commit, pending);
  return pending;
}

function extractImagePipelineSource(sourceFile: ts.SourceFile): string {
  const requiredTypes = new Set(['PendingImageWithFile', 'PreparedImageResult', 'CompressionPreset']);
  const requiredConstants = new Set([
    'IMAGE_SEND_PRESETS',
    'IMAGE_SOFT_TARGET_BYTES',
    'IMAGE_HARD_LIMIT_BYTES',
  ]);
  const requiredFunctions = new Set([
    'estimateBase64Bytes',
    'normalizedMimeType',
    'isGifMimeType',
    'shouldAttemptLocalCompression',
    'readImageDimensions',
    'buildResizeAction',
    'encodeWithManipulator',
    'readOriginalImage',
    'compressImageForSend',
    'preparePendingImagesForSend',
  ]);
  const foundTypes = new Map<string, number>();
  const foundConstants = new Map<string, number>();
  const foundFunctions = new Map<string, number>();
  const selected: ts.Statement[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(statement) && requiredTypes.has(statement.name.text)) {
      increment(foundTypes, statement.name.text);
      selected.push(statement);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      const selectedNames = statement.declarationList.declarations
        .filter(({ name }) => ts.isIdentifier(name) && requiredConstants.has(name.text))
        .map(({ name }) => (name as ts.Identifier).text);
      if (selectedNames.length > 0) {
        if (selectedNames.length !== statement.declarationList.declarations.length) {
          throw new Error(`Historical image constant declaration is mixed with unreviewed bindings: ${selectedNames.join(', ')}.`);
        }
        selectedNames.forEach((name) => increment(foundConstants, name));
        selected.push(statement);
        continue;
      }
    }
    if (ts.isFunctionDeclaration(statement) && statement.name && requiredFunctions.has(statement.name.text)) {
      increment(foundFunctions, statement.name.text);
      selected.push(statement);
    }
  }

  assertExactInventory('image type', requiredTypes, foundTypes);
  assertExactInventory('image constant', requiredConstants, foundConstants);
  assertExactInventory('image function', requiredFunctions, foundFunctions);

  const compressor = selected.find(
    (statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement)
      && statement.name?.text === 'compressImageForSend',
  );
  const publicPrepare = selected.find(
    (statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement)
      && statement.name?.text === 'preparePendingImagesForSend',
  );
  if (!compressor || !publicPrepare) throw new Error('Historical image pipeline entry points are missing.');
  assertNoStaticImageRejection(compressor, publicPrepare);

  return [
    ...selected.map((statement) => statement.getText(sourceFile)),
    'export { preparePendingImagesForSend };',
    'export const historicalImageHardLimitBytes = IMAGE_HARD_LIMIT_BYTES;',
  ].join('\n');
}

function assertNoStaticImageRejection(
  compressor: ts.FunctionDeclaration,
  publicPrepare: ts.FunctionDeclaration,
): void {
  let hardLimitReferences = 0;
  let bestCandidateReturns = 0;
  let rejectionCount = 0;
  visit(compressor);
  visit(publicPrepare);
  if (hardLimitReferences !== 1 || bestCandidateReturns !== 1 || rejectionCount !== 0) {
    throw new Error(
      `Historical image rejection shape changed: hardLimitReferences=${hardLimitReferences}, `
      + `bestCandidateReturns=${bestCandidateReturns}, rejectionCount=${rejectionCount}.`,
    );
  }

  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) && node.text === 'IMAGE_HARD_LIMIT_BYTES') hardLimitReferences += 1;
    if (ts.isReturnStatement(node) && node.expression
      && ts.isIdentifier(node.expression) && node.expression.text === 'bestCandidate') {
      bestCandidateReturns += 1;
    }
    if (ts.isThrowStatement(node)) rejectionCount += 1;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === 'Promise'
      && node.expression.name.text === 'reject') {
      rejectionCount += 1;
    }
    ts.forEachChild(node, visit);
  }
}

function compileImagePipeline(
  source: string,
  commit: string,
): (
  importExpoImageManipulator: () => Promise<unknown>,
  readFileAsBase64: (uri: string) => Promise<string>,
  exportsObject: Record<string, unknown>,
) => void {
  let expoDynamicImports = 0;
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
    fileName: `${commit}-preparePendingImagesForSend.ts`,
    reportDiagnostics: true,
    transformers: {
      before: [(context) => {
        const visit: ts.Visitor = (node) => {
          if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            if (node.arguments.length !== 1
              || !ts.isStringLiteral(node.arguments[0])
              || node.arguments[0].text !== 'expo-image-manipulator') {
              throw new Error(`Historical image pipeline has an unreviewed dynamic import at ${commit}.`);
            }
            expoDynamicImports += 1;
            return context.factory.createCallExpression(
              context.factory.createIdentifier('__importExpoImageManipulator'),
              undefined,
              [],
            );
          }
          return ts.visitEachChild(node, visit, context);
        };
        return (node: ts.SourceFile): ts.SourceFile => ts.visitNode(node, visit) as ts.SourceFile;
      }],
    },
  });
  assertNoTranspileErrors(transpiled, `historical image pipeline ${commit}`);
  if (expoDynamicImports !== 1) {
    throw new Error(`Historical image pipeline expected one Expo manipulator import at ${commit}, got ${expoDynamicImports}.`);
  }
  return new Function(
    '__importExpoImageManipulator',
    'readFileAsBase64',
    'exports',
    transpiled.outputText,
  ) as ReturnType<typeof compileImagePipeline>;
}

async function loadHistoricalGatewayHarness(commit: string): Promise<HistoricalGatewayHarnessConstructor> {
  const cached = gatewayHarnessCache.get(commit);
  if (cached) return cached;
  const pending = (async () => {
    const source = await gitShowPinnedSource(commit, GATEWAY_SOURCE_PATH);
    const sourceFile = parseHistoricalSource(source, `${commit}:${GATEWAY_SOURCE_PATH}`);
    const gatewayClass = sourceFile.statements.filter(
      (statement): statement is ts.ClassDeclaration => ts.isClassDeclaration(statement)
        && statement.name?.text === 'GatewayClient',
    );
    if (gatewayClass.length !== 1) {
      throw new Error(`Expected one historical GatewayClient at ${commit}, got ${gatewayClass.length}.`);
    }
    const sendChat = extractUniqueClassMethod(gatewayClass[0], sourceFile, 'sendChat', commit);
    const sendRequest = extractUniqueClassMethod(gatewayClass[0], sourceFile, 'sendRequest', commit);
    assertGatewaySerializationBoundary(sendChat.node, sendRequest.node, commit);

    const harnessSource = `
      const REQUEST_TIMEOUT_MS = 60_000;
      const WebSocket = { OPEN: 1 };
      const setTimeout = (_callback: () => void, _delay: number): number => 0;
      const clearTimeout = (_timer: unknown): void => {};
      export class HistoricalGatewayHarness {
        private readonly ws: { readyState: number; send: (wire: string) => void };
        private readonly pendingRequests = new Map<string, any>();
        private readonly state = 'ready';
        private readonly connectAttemptId = 1;
        private readonly activeRoute = 'relay';
        private readonly connectStartedAt = 0;
        constructor(onWire: (wire: string) => void) {
          this.ws = { readyState: WebSocket.OPEN, send: onWire };
        }
        private shouldTraceRequest(_method: string): boolean { return false; }
        private logTelemetry(_event: string, _fields: Record<string, unknown>): void {}
        private recoverStaleTransport(_reason: string): void {}
        private maybeReconnectAfterTimeout(): void {}
        ${sendChat.source}
        ${sendRequest.source}
      }
    `;
    const transpiled = ts.transpileModule(harnessSource, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        strict: true,
      },
      fileName: `${commit}-gateway-image-boundary.ts`,
      reportDiagnostics: true,
    });
    assertNoTranspileErrors(transpiled, `historical Gateway image boundary ${commit}`);
    const exportsObject: Record<string, unknown> = {};
    new Function('exports', 'generateId', transpiled.outputText)(
      exportsObject,
      () => 'chat-image-v1',
    );
    if (typeof exportsObject.HistoricalGatewayHarness !== 'function') {
      throw new Error(`Historical Gateway image boundary export is missing at ${commit}.`);
    }
    return exportsObject.HistoricalGatewayHarness as HistoricalGatewayHarnessConstructor;
  })();
  gatewayHarnessCache.set(commit, pending);
  return pending;
}

function extractUniqueClassMethod(
  declaration: ts.ClassDeclaration,
  sourceFile: ts.SourceFile,
  name: string,
  commit: string,
): { node: ts.MethodDeclaration; source: string } {
  const matches = declaration.members.filter(
    (member): member is ts.MethodDeclaration => ts.isMethodDeclaration(member)
      && ts.isIdentifier(member.name)
      && member.name.text === name,
  );
  if (matches.length !== 1) {
    throw new Error(`Expected one historical GatewayClient.${name} at ${commit}, got ${matches.length}.`);
  }
  return { node: matches[0], source: matches[0].getText(sourceFile) };
}

function assertGatewaySerializationBoundary(
  sendChat: ts.MethodDeclaration,
  sendRequest: ts.MethodDeclaration,
  commit: string,
): void {
  let chatSendCalls = 0;
  let wireSendCalls = 0;
  visitSendChat(sendChat);
  visitSendRequest(sendRequest);
  if (chatSendCalls !== 1 || wireSendCalls !== 1) {
    throw new Error(
      `Historical Gateway image boundary changed at ${commit}: `
      + `chatSendCalls=${chatSendCalls}, JSONWebSocketSends=${wireSendCalls}.`,
    );
  }

  function visitSendChat(node: ts.Node): void {
    if (ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.kind === ts.SyntaxKind.ThisKeyword
      && node.expression.name.text === 'sendRequest'
      && node.arguments.length >= 2
      && ts.isStringLiteral(node.arguments[0])
      && node.arguments[0].text === 'chat.send') {
      chatSendCalls += 1;
    }
    ts.forEachChild(node, visitSendChat);
  }

  function visitSendRequest(node: ts.Node): void {
    if (ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isPropertyAccessExpression(node.expression.expression)
      && node.expression.expression.expression.kind === ts.SyntaxKind.ThisKeyword
      && node.expression.expression.name.text === 'ws'
      && node.expression.name.text === 'send'
      && node.arguments.length === 1
      && isJsonStringifyCall(node.arguments[0])) {
      wireSendCalls += 1;
    }
    ts.forEachChild(node, visitSendRequest);
  }
}

function isJsonStringifyCall(node: ts.Expression): boolean {
  return ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === 'JSON'
    && node.expression.name.text === 'stringify'
    && node.arguments.length === 1
    && ts.isIdentifier(node.arguments[0])
    && node.arguments[0].text === 'frame';
}

function captureChatWire(GatewayHarness: HistoricalGatewayHarnessConstructor, content: string): string {
  let wire = '';
  const gateway = new GatewayHarness(
    (value) => {
      if (wire) throw new Error('Historical Gateway emitted more than one image wire frame.');
      wire = value;
    },
  );
  void gateway.sendChat('agent:main:main', 'compat image', [{
    type: 'image',
    mimeType: 'image/jpeg',
    content,
  }], { idempotencyKey: 'compat-image-1' });
  if (!wire) throw new Error('Historical Gateway did not synchronously emit the image wire frame.');
  return wire;
}

async function gitShowPinnedSource(commit: string, path: string): Promise<string> {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`Historical image pin is not a full SHA: ${commit}.`);
  const { stdout: resolvedStdout } = await execFileAsync(
    'git',
    ['rev-parse', '--verify', `${commit}^{commit}`],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  const resolved = resolvedStdout.trim();
  if (resolved !== commit) {
    throw new Error(`Historical image pin resolved unexpectedly: ${commit} -> ${resolved}.`);
  }
  const { stdout } = await execFileAsync('git', ['show', `${commit}:${path}`], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (!stdout.trim()) throw new Error(`Historical image source is empty: ${commit}:${path}.`);
  return stdout;
}

function parseHistoricalSource(source: string, label: string): ts.SourceFile {
  const sourceFile = ts.createSourceFile(label, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] })
    .parseDiagnostics ?? [];
  const errors = diagnostics
    .filter(({ category }) => category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  if (errors.length > 0) throw new Error(`Could not parse ${label}: ${errors.join('; ')}`);
  if (sourceFile.statements.length === 0) throw new Error(`Historical source has no AST statements: ${label}.`);
  return sourceFile;
}

function assertNoTranspileErrors(result: ts.TranspileOutput, label: string): void {
  const errors = (result.diagnostics ?? [])
    .filter(({ category }) => category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  if (errors.length > 0) throw new Error(`Could not transpile ${label}: ${errors.join('; ')}`);
}

function increment(counts: Map<string, number>, name: string): void {
  counts.set(name, (counts.get(name) ?? 0) + 1);
}

function assertExactInventory(label: string, expected: Set<string>, counts: Map<string, number>): void {
  const missing = [...expected].filter((name) => counts.get(name) !== 1);
  const unexpected = [...counts].filter(([, count]) => count !== 1).map(([name]) => name);
  if (missing.length > 0 || unexpected.length > 0 || counts.size !== expected.size) {
    throw new Error(
      `Historical ${label} inventory changed: missing/duplicate=${[...new Set([...missing, ...unexpected])].join(', ') || 'none'}.`,
    );
  }
}

function zeroFilledBase64(decodedBytes: number): string {
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes <= 0) {
    throw new Error(`Decoded base64 size must be a positive safe integer, got ${decodedBytes}.`);
  }
  const completeGroups = Math.floor(decodedBytes / 3);
  const remainder = decodedBytes % 3;
  return 'AAAA'.repeat(completeGroups) + (remainder === 1 ? 'AA==' : remainder === 2 ? 'AAA=' : '');
}

function decodedBase64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function readFirstAttachment(payload: unknown): { content: string } {
  if (!isRecord(payload) || !isRecord(payload.params) || !Array.isArray(payload.params.attachments)) {
    throw new Error('Historical image fixture is missing params.attachments.');
  }
  const attachment = payload.params.attachments[0];
  if (!isRecord(attachment) || typeof attachment.content !== 'string') {
    throw new Error('Historical image fixture is missing base64 attachment content.');
  }
  return { content: attachment.content };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
