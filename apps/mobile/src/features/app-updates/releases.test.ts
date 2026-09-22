import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SUPPORTED_LOCALES } from '../../i18n/supported-locales';
import {
  APP_UPDATE_RELEASES,
  BRIDGE_UPGRADE_ENTRY,
  MAX_ANNOUNCED_RELEASES,
  collectUnannouncedReleases,
  compareAppVersions,
  getAppUpdateRelease,
  getAppUpdateReleaseHistory,
  getLatestAppUpdateRelease,
  toAppUpdateAnnouncement,
  type AppUpdateRelease,
} from './releases';

const LOCALES_ROOT = join(__dirname, '..', '..', 'i18n', 'locales');

function chatCatalog(locale: string): Record<string, string> {
  return JSON.parse(readFileSync(join(LOCALES_ROOT, locale, 'chat.json'), 'utf8')) as Record<string, string>;
}

function releaseCopyKeys(release: AppUpdateRelease): string[] {
  const keys = [release.title, release.summary].filter((value): value is string => Boolean(value));
  for (const entry of release.entries) {
    keys.push(entry.title);
    if (entry.subtitle) keys.push(entry.subtitle);
    if (entry.tag) keys.push(entry.tag);
  }
  return keys;
}

describe('release catalog', () => {
  it('restores the complete 1.x–3.x history newest first with unique versions and real dates', () => {
    const versions = APP_UPDATE_RELEASES.map((release) => release.version);
    expect(versions).toEqual([
      '3.0.0', '2.1.1', '2.1.0', '1.10.0', '1.9.0', '1.8.0', '1.7.0', '1.6.0', '1.5.0', '1.2.0', '1.1.0',
    ]);
    expect(new Set(versions).size).toBe(versions.length);
    for (let index = 1; index < versions.length; index += 1) {
      expect(compareAppVersions(versions[index - 1]!, versions[index]!)).toBe(1);
    }
    for (const release of APP_UPDATE_RELEASES) {
      expect(release.releasedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(release.entries.length).toBeGreaterThan(0);
      expect(new Set(release.entries.map((entry) => entry.id)).size).toBe(release.entries.length);
    }
    expect(getAppUpdateRelease('2.1.0')?.releasedAt).toBe('2026-04-17');
    expect(getAppUpdateRelease('2.1.1')?.silent).toBe(true);
    expect(getLatestAppUpdateRelease()?.version).toBe('3.0.0');
    expect(getAppUpdateReleaseHistory()).toBe(APP_UPDATE_RELEASES);
  });

  it('keeps 3.0.0 as one short announcement: hero copy, five inert entries, no Pro pitch', () => {
    const release = getAppUpdateRelease('3.0.0');
    expect(release?.title).toBe('Meet Clawket 3.0');
    expect(release?.summary).toBeTruthy();
    expect(release?.entries.map((entry) => entry.id)).toEqual(['roster', 'session-panel', 'search', 'connections', 'design']);
    expect(release?.entries.every((entry) => entry.action.type === 'none')).toBe(true);
    // Owner asked for copy a schoolchild could read: one short line per entry.
    for (const entry of release?.entries ?? []) {
      expect(entry.subtitle?.length ?? 0).toBeLessThanOrEqual(60);
    }
  });

  it('translates every release copy key in every locale so no note falls back to English', () => {
    const keys = new Set([...APP_UPDATE_RELEASES.flatMap(releaseCopyKeys), BRIDGE_UPGRADE_ENTRY.title, BRIDGE_UPGRADE_ENTRY.subtitle!]);
    expect(keys.size).toBeGreaterThan(40);
    for (const { code } of SUPPORTED_LOCALES) {
      const catalog = chatCatalog(code);
      const missing = [...keys].filter((key) => typeof catalog[key] !== 'string' || catalog[key]!.trim() === '');
      expect({ locale: code, missing }).toEqual({ locale: code, missing: [] });
    }
  });
});

describe('compareAppVersions', () => {
  it('compares dotted numbers, not strings', () => {
    expect(compareAppVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareAppVersions('2.1', '2.1.0')).toBe(0);
    expect(compareAppVersions(' 3.0.0 ', '3.0.0')).toBe(0);
    expect(compareAppVersions('2.1.1', '3.0.0')).toBe(-1);
    expect(compareAppVersions('x.y', '0.0.1')).toBe(-1);
  });
});

describe('collectUnannouncedReleases', () => {
  const releases: AppUpdateRelease[] = [
    { version: '3.2.0', entries: [{ id: 'c', icon: 'rocket', title: 'C', action: { type: 'none' } }] },
    { version: '3.1.1', silent: true, entries: [{ id: 'fix', icon: 'wrench', title: 'Fix', action: { type: 'none' } }] },
    { version: '3.1.0', entries: [{ id: 'b', icon: 'rocket', title: 'B', action: { type: 'none' } }] },
    { version: '3.0.1', entries: [] },
    { version: '3.0.0', entries: [{ id: 'a', icon: 'rocket', title: 'A', action: { type: 'none' } }] },
    { version: '2.1.0', entries: [{ id: 'old', icon: 'rocket', title: 'Old', action: { type: 'none' } }] },
  ];

  it('announces only the current release when the device has no baseline (2.x upgrade)', () => {
    expect(collectUnannouncedReleases('3.0.0', null, releases).map((release) => release.version)).toEqual(['3.0.0']);
    expect(collectUnannouncedReleases('3.0.1', null, releases)).toEqual([]);
    expect(collectUnannouncedReleases('9.9.9', null, releases)).toEqual([]);
  });

  it('merges skipped non-silent releases newest first and never announces the future', () => {
    expect(collectUnannouncedReleases('3.2.0', '3.0.0', releases).map((release) => release.version))
      .toEqual(['3.2.0', '3.1.0']);
    expect(collectUnannouncedReleases('3.1.1', '3.1.0', releases)).toEqual([]);
    expect(collectUnannouncedReleases('3.1.0', '3.2.0', releases)).toEqual([]);
    expect(collectUnannouncedReleases('', '3.0.0', releases)).toEqual([]);
  });

  it('caps a long gap at the newest few releases', () => {
    const many: AppUpdateRelease[] = Array.from({ length: 6 }, (_, index) => ({
      version: `4.${index}.0`,
      entries: [{ id: `v${index}`, icon: 'rocket', title: `V${index}`, action: { type: 'none' } }],
    }));
    const result = collectUnannouncedReleases('4.5.0', '1.0.0', many);
    expect(result).toHaveLength(MAX_ANNOUNCED_RELEASES);
    expect(result[0]?.version).toBe('4.5.0');
  });
});

describe('toAppUpdateAnnouncement', () => {
  it('drops empty releases and returns null when nothing remains', () => {
    expect(toAppUpdateAnnouncement('3.0.0', [{ version: '3.0.0', entries: [] }])).toBeNull();
    const announcement = toAppUpdateAnnouncement('3.0.0', [getAppUpdateRelease('3.0.0')!], 'hint');
    expect(announcement).toMatchObject({ currentVersion: '3.0.0', debugHint: 'hint' });
    expect(announcement?.releases).toHaveLength(1);
  });
});
