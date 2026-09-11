import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  PATCH_MARKER,
  PATCHED_SOURCE,
  applyTailFadePatch,
  patchTailFadeAnimator,
} from './patch-enriched-markdown-tail-fade.mjs';

// The upstream 1.0.2 shape this patch was reviewed against, reduced to the
// parts the validator checks.
const upstream = `#import "ENRMTailFadeInAnimator.h"

static const NSTimeInterval kFadeDuration = 0.20;

typedef struct {
  NSRange range;
  __unsafe_unretained RCTUIColor *color;
} ENRMColorEntry;

- (void)animateFrom:(NSUInteger)tailStart to:(NSUInteger)tailEnd
{
  [self cancel];
}

- (void)cleanupEntries
{
}
`;

test('replaces the upstream single-tail animator with the parallel one, idempotently', () => {
  const result = patchTailFadeAnimator(upstream);
  assert.equal(result, PATCHED_SOURCE);
  assert.ok(result.includes(PATCH_MARKER));
  assert.ok(!result.includes('[self cancel];\n\n  NSTextStorage'));
  assert.ok(result.includes('UIAccessibilityIsReduceMotionEnabled()'));
  assert.equal(patchTailFadeAnimator(result), result);
});

test('fails closed for empty, malformed, drifted upstream or edited patched sources', () => {
  for (const bad of [
    '',
    null,
    '{}',
    upstream + upstream,
    upstream.replace('[self cancel];', '[self stop];'),
    upstream.replace('kFadeDuration = 0.20', 'kFadeDuration = 0.30'),
    PATCHED_SOURCE.replace('kFadeDuration = 0.25', 'kFadeDuration = 0.10'),
  ]) {
    assert.throws(() => patchTailFadeAnimator(bad));
  }
});

for (const hoisted of [true, false]) {
  test(`validates the ${hoisted ? 'hoisted' : 'standalone'} installation and rejects missing input`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'clawket-tail-fade-'));
    const mobile = path.join(root, 'apps/mobile');
    const relative = 'node_modules/react-native-enriched-markdown/ios/utils/ENRMTailFadeInAnimator.m';
    const file = path.join(hoisted ? root : mobile, relative);
    try {
      await mkdir(mobile, { recursive: true });
      assert.throws(() => applyTailFadePatch(mobile), /missing/);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, upstream);
      assert.equal(applyTailFadePatch(mobile), 1);
      assert.equal(await readFile(file, 'utf8'), PATCHED_SOURCE);
      assert.equal(applyTailFadePatch(mobile), 1);
      await writeFile(file, 'corrupted');
      assert.throws(() => applyTailFadePatch(mobile), /upstream/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
