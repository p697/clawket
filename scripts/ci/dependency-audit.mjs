#!/usr/bin/env node
// Fails CI on any high or critical npm advisory in the root or the standalone
// Mobile lockfile. The only way past one is an owner-approved exception below:
// one advisory in one package, with a reason and an expiry date. An expired
// exception blocks again, an exception no report needs any more fails until it
// is removed, and a report that cannot be read fails rather than passing.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BLOCKING_SEVERITIES = new Set(['high', 'critical']);

/** Owner-approved exceptions. Each names one advisory in one package and expires. */
export const AUDIT_EXCEPTIONS = [
  {
    advisory: 'GHSA-86w9-cpqp-85rv',
    package: 'node-forge',
    expires: '2026-11-01',
    reason: 'node-forge <=1.4.0 has no patched release. It reaches Clawket only through '
      + 'expo -> @expo/cli -> @expo/code-signing-certificates, build-machine tooling that '
      + 'neither the app nor the Bridge ships (owner approval 2026-10-02).',
  },
];

/** Throws unless every exception names a GHSA advisory, a package, a reason and a real expiry date. */
export function validateExceptions(exceptions) {
  if (!Array.isArray(exceptions)) throw new Error('audit exceptions must be a list');
  for (const exception of exceptions) {
    const label = JSON.stringify(exception);
    if (!exception || typeof exception !== 'object') throw new Error(`audit exception is not an object: ${label}`);
    if (!/^GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}$/.test(exception.advisory ?? '')) throw new Error(`audit exception needs a GHSA id: ${label}`);
    if (typeof exception.package !== 'string' || !exception.package.trim()) throw new Error(`audit exception needs a package: ${label}`);
    if (typeof exception.reason !== 'string' || exception.reason.trim().length < 20) throw new Error(`audit exception needs a reason: ${label}`);
    const expires = typeof exception.expires === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(exception.expires)
      ? new Date(`${exception.expires}T00:00:00Z`) : null;
    if (!expires || Number.isNaN(expires.getTime()) || expires.toISOString().slice(0, 10) !== exception.expires) {
      throw new Error(`audit exception needs an expiry date (YYYY-MM-DD): ${label}`);
    }
  }
  return exceptions;
}

/** The GHSA id an npm advisory links to, or its npm source number. */
export function advisoryId(advisory) {
  const match = /GHSA(?:-[a-z0-9]{4}){3}/i.exec(String(advisory?.url ?? ''));
  return match ? match[0] : advisory?.source !== undefined ? `npm:${advisory.source}` : 'unknown';
}

/**
 * Splits one `npm audit --json` report's high and critical advisories into
 * excepted and blocking ones. `today` is a YYYY-MM-DD date; an exception is
 * valid through its expiry day. Throws on a report it cannot read.
 */
export function evaluateAuditReport(report, exceptions, today) {
  const vulnerabilities = report?.vulnerabilities;
  const totals = report?.metadata?.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== 'object' || Array.isArray(vulnerabilities)
    || !totals || typeof totals !== 'object' || typeof totals.total !== 'number') {
    const npmError = report?.error?.summary ?? report?.error?.code;
    throw new Error(`npm audit report is missing or malformed${npmError ? `: ${npmError}` : ''}`);
  }
  const blocking = [];
  const excepted = [];
  const seen = new Set();
  for (const vulnerability of Object.values(vulnerabilities)) {
    if (!vulnerability || !Array.isArray(vulnerability.via)) throw new Error('npm audit report lists a vulnerability without its advisories');
    for (const via of vulnerability.via) {
      // A string names a vulnerable dependency; its advisory is listed under that package.
      if (!via || typeof via !== 'object' || !BLOCKING_SEVERITIES.has(via.severity)) continue;
      const finding = { package: String(via.name ?? 'unknown'), advisory: advisoryId(via), severity: via.severity, title: String(via.title ?? '') };
      const key = `${finding.package}|${finding.advisory}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const exception = exceptions.find((entry) => entry.advisory === finding.advisory && entry.package === finding.package);
      if (exception && today <= exception.expires) excepted.push({ ...finding, expires: exception.expires });
      else blocking.push({ ...finding, expired: exception ? exception.expires : undefined });
    }
  }
  return { blocking, excepted, totals };
}

/** Exceptions no report needed: the advisory is gone, so the exception must go too. */
export function unusedExceptions(results, exceptions) {
  const used = new Set(results.flatMap((result) => [...result.excepted, ...result.blocking])
    .map((finding) => `${finding.package}|${finding.advisory}`));
  return exceptions.filter((exception) => !used.has(`${exception.package}|${exception.advisory}`));
}

function runAudit(args) {
  const result = spawnSync('npm', ['audit', '--json', ...args], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`npm audit ${args.join(' ')} did not print a JSON report (exit ${result.status})`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const today = new Date().toISOString().slice(0, 10);
  let failed = false;
  try {
    validateExceptions(AUDIT_EXCEPTIONS);
    const lockfiles = [
      { label: 'root lockfile', args: [] },
      { label: 'apps/mobile lockfile', args: ['--prefix', 'apps/mobile', '--workspaces=false'] },
    ];
    const results = lockfiles.map(({ label, args }) => ({ label, ...evaluateAuditReport(runAudit(args), AUDIT_EXCEPTIONS, today) }));
    for (const result of results) {
      const { totals } = result;
      console.log(`${result.label}: ${totals.total} vulnerable packages (${totals.critical ?? 0} critical, ${totals.high ?? 0} high); `
        + `high/critical advisories: ${result.blocking.length} blocking, ${result.excepted.length} excepted`);
      for (const finding of result.excepted) console.log(`  excepted until ${finding.expires}: ${finding.advisory} ${finding.package} (${finding.severity})`);
      for (const finding of result.blocking) {
        failed = true;
        console.error(`  BLOCKING ${finding.advisory} ${finding.package} (${finding.severity}): ${finding.title}`
          + (finding.expired ? ` — exception expired ${finding.expired}; review it` : ''));
      }
    }
    for (const exception of unusedExceptions(results, AUDIT_EXCEPTIONS)) {
      failed = true;
      console.error(`unused audit exception ${exception.advisory} ${exception.package}: no lockfile reports it any more; remove it`);
    }
    console.log(`checked ${results.length} lockfiles against ${AUDIT_EXCEPTIONS.length} audit exception(s)`);
  } catch (error) {
    failed = true;
    console.error(`dependency audit failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exit(failed ? 1 : 0);
}
