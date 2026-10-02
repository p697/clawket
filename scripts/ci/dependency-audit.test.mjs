import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUDIT_EXCEPTIONS,
  advisoryId,
  evaluateAuditReport,
  unusedExceptions,
  validateExceptions,
} from './dependency-audit.mjs';

const FORGE = {
  source: 1240912,
  name: 'node-forge',
  dependency: 'node-forge',
  title: 'node-forge RSA PKCS#1 v1.5 signature verification accepts extra nested DigestAlgorithm elements',
  url: 'https://github.com/advisories/GHSA-86w9-cpqp-85rv',
  severity: 'high',
  range: '<=1.4.0',
};
const EXCEPTION = {
  advisory: 'GHSA-86w9-cpqp-85rv',
  package: 'node-forge',
  expires: '2026-11-01',
  reason: 'No patched release; build tooling only.',
};

function report(vulnerabilities) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  for (const entry of Object.values(vulnerabilities)) {
    counts[entry.severity] += 1;
    counts.total += 1;
  }
  return { auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: counts } };
}

// node-forge and the Expo packages that depend on it, as npm audit lists them.
const forgeChain = {
  'node-forge': { name: 'node-forge', severity: 'high', via: [FORGE] },
  '@expo/cli': { name: '@expo/cli', severity: 'high', via: ['@expo/code-signing-certificates', 'node-forge'] },
  expo: { name: 'expo', severity: 'high', via: ['@expo/cli'] },
};

test('the excepted advisory passes once, however many dependents npm counts', () => {
  const result = evaluateAuditReport(report(forgeChain), [EXCEPTION], '2026-10-02');
  assert.deepEqual(result.blocking, []);
  assert.deepEqual(result.excepted.map((finding) => [finding.advisory, finding.package, finding.expires]),
    [['GHSA-86w9-cpqp-85rv', 'node-forge', '2026-11-01']]);
  assert.equal(result.totals.high, 3);
});

test('any other high or critical advisory still blocks, and lower ones never do', () => {
  const other = { ...FORGE, name: 'tar', url: 'https://github.com/advisories/GHSA-r6q2-hw4h-h46w', severity: 'critical', title: 'tar' };
  const sameIdOtherPackage = { ...FORGE, name: 'forge-fork' };
  const moderate = { ...FORGE, name: 'uuid', url: 'https://github.com/advisories/GHSA-w5hq-g745-h8pq', severity: 'moderate' };
  const result = evaluateAuditReport(report({
    ...forgeChain,
    tar: { name: 'tar', severity: 'critical', via: [other] },
    'forge-fork': { name: 'forge-fork', severity: 'high', via: [sameIdOtherPackage] },
    uuid: { name: 'uuid', severity: 'moderate', via: [moderate] },
  }), [EXCEPTION], '2026-10-02');
  assert.deepEqual(result.blocking.map((finding) => `${finding.advisory} ${finding.package}`),
    ['GHSA-r6q2-hw4h-h46w tar', 'GHSA-86w9-cpqp-85rv forge-fork']);
  assert.equal(result.excepted.length, 1);
});

test('an exception holds through its expiry day and blocks the day after', () => {
  assert.equal(evaluateAuditReport(report(forgeChain), [EXCEPTION], '2026-11-01').blocking.length, 0);
  const expired = evaluateAuditReport(report(forgeChain), [EXCEPTION], '2026-11-02');
  assert.deepEqual(expired.blocking.map((finding) => [finding.advisory, finding.expired]), [['GHSA-86w9-cpqp-85rv', '2026-11-01']]);
  assert.equal(expired.excepted.length, 0);
});

test('an exception no lockfile reports any more must be removed', () => {
  const clean = evaluateAuditReport(report({}), [EXCEPTION], '2026-10-02');
  const stillThere = evaluateAuditReport(report(forgeChain), [EXCEPTION], '2026-10-02');
  assert.deepEqual(unusedExceptions([clean], [EXCEPTION]), [EXCEPTION]);
  assert.deepEqual(unusedExceptions([clean, stillThere], [EXCEPTION]), []);
});

test('a report it cannot read fails rather than passing', () => {
  for (const corrupted of [
    null,
    {},
    { vulnerabilities: [] },
    { vulnerabilities: {} },
    { vulnerabilities: {}, metadata: { vulnerabilities: {} } },
    { error: { code: 'ENOAUDIT', summary: 'Your configured registry does not support audit requests.' } },
    report({ broken: { name: 'broken', severity: 'high' } }),
  ]) {
    assert.throws(() => evaluateAuditReport(corrupted, [EXCEPTION], '2026-10-02'), /npm audit report/, JSON.stringify(corrupted));
  }
});

test('exceptions must name one GHSA advisory, a package, a reason and a real expiry date', () => {
  assert.doesNotThrow(() => validateExceptions(AUDIT_EXCEPTIONS));
  assert.ok(AUDIT_EXCEPTIONS.length > 0);
  for (const broken of [
    'not a list',
    [null],
    [{ ...EXCEPTION, advisory: 'CVE-2026-85393' }],
    [{ ...EXCEPTION, package: ' ' }],
    [{ ...EXCEPTION, reason: 'short' }],
    [{ ...EXCEPTION, expires: '2026-02-30' }],
    [{ ...EXCEPTION, expires: undefined }],
  ]) {
    assert.throws(() => validateExceptions(broken), /audit exception/, JSON.stringify(broken));
  }
});

test('advisories are identified by their GHSA link, else by npm source number', () => {
  assert.equal(advisoryId(FORGE), 'GHSA-86w9-cpqp-85rv');
  assert.equal(advisoryId({ source: 42 }), 'npm:42');
  assert.equal(advisoryId({}), 'unknown');
});
