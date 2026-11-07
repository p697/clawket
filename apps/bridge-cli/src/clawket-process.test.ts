import { expect, it } from 'vitest';
import { isClawketBridgeRuntimeCommand } from './clawket-process.js';

it('recognizes a runtime started by another Clawket install, not unrelated scripts', () => {
  const npx = '/Users/a/.npm/_npx/123/node_modules/@p697/clawket/dist/index.js';
  const managed = '/opt/homebrew/bin/node /Users/a/.clawket/runtime/releases/3.1.17-x/node_modules/@p697/clawket/dist/index.js hermes relay run';
  expect(isClawketBridgeRuntimeCommand(managed, npx)).toBe(true);
  expect(isClawketBridgeRuntimeCommand(`node ${npx} hermes run --port 4319`, npx)).toBe(true);
  expect(isClawketBridgeRuntimeCommand('node /repo/apps/bridge-cli/dist/index.js hermes run', '')).toBe(true);
  expect(isClawketBridgeRuntimeCommand('node /tmp/other/dist/index.js hermes relay run', npx)).toBe(false);
  expect(isClawketBridgeRuntimeCommand('node /tmp/@p697/clawket/dist/index.jsx hermes run', '')).toBe(false);
});
