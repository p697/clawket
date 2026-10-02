import { newerVersion, parseRelease, stableVersion, upgradeCommand, usesBridge } from './bridge-release';
it('compares stable releases numerically and rejects prereleases/malformed command versions', () => {
  expect(newerVersion('3.1.11', '3.1.9')).toBe(true); expect(newerVersion('3.1.9', '3.1.11')).toBe(false);
  for (const value of ['3.1.11-rc.1', '03.1.11', '3.1.11;echo', '3.1']) expect(stableVersion(value)).toBe(false);
  expect(newerVersion('3.2.0', 'unknown')).toBe(false);
});
it('pins commands to a validated actually published update capability', () => {
  expect(upgradeCommand(parseRelease({ name: '@p697/clawket', version: '3.1.10' }, 1))).toBeNull();
  expect(upgradeCommand(parseRelease({ name: '@p697/clawket', version: '3.1.11', clawket: { updateProtocol: 1 } }, 2))).toBe('npx -y @p697/clawket@3.1.11 update');
  expect(parseRelease({ name: 'other', version: '3.1.11' }, 1)).toBeNull();
});
it('covers every Bridge backend but excludes direct Gateway connections', () => {
  expect(usesBridge({ backendKind: 'openclaw', transportKind: 'local' })).toBe(false); expect(usesBridge({ backendKind: 'openclaw', transportKind: 'relay' })).toBe(true); expect(usesBridge({ backendKind: 'codex', transportKind: 'local' })).toBe(true);
});
