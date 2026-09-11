import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCompatFixture, type CompatFixture } from './schema';

const FIXTURE_ROOT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'v1');

export async function loadCompatFixture(pathWithinV1: string): Promise<CompatFixture> {
  const path = join(FIXTURE_ROOT, pathWithinV1);
  const within = relative(FIXTURE_ROOT, path);
  if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
    throw new Error(`Fixture path escapes v1 root: ${pathWithinV1}`);
  }
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  return validateCompatFixture(parsed);
}

export async function loadAllCompatFixtures(): Promise<Array<{ path: string; fixture: CompatFixture }>> {
  const paths = await walkJson(FIXTURE_ROOT);
  return Promise.all(paths.map(async (path) => ({
    path: relative(FIXTURE_ROOT, path).split(sep).join('/'),
    fixture: validateCompatFixture(JSON.parse(await readFile(path, 'utf8')) as unknown),
  })));
}

async function walkJson(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walkJson(path);
    return entry.isFile() && entry.name.endsWith('.json') ? [path] : [];
  }));
  return nested.flat().sort();
}
