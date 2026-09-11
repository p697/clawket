import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// react-native-enriched-markdown 1.0.2: `animateFrom:` cancels the previous
// tail fade before starting the next one, so a word-paced stream (a new tail
// every ~33 ms) snaps each earlier word fully opaque long before its fade
// completes and the cascade never reads. This reviewed replacement keeps every
// in-flight tail fading in parallel under one display link, re-snapshots their
// target colors after each text replacement, and honors Reduce Motion.
export const PATCH_MARKER = '// Clawket patch: parallel tail fade-in';

const UPSTREAM_SENTINELS = [
  'static const NSTimeInterval kFadeDuration = 0.20;',
  '- (void)animateFrom:(NSUInteger)tailStart to:(NSUInteger)tailEnd\n{\n  [self cancel];',
  '} ENRMColorEntry;',
  '- (void)cleanupEntries',
];

export const PATCHED_SOURCE = `#import "ENRMTailFadeInAnimator.h"
#import "LinkTapUtils.h"
#import <QuartzCore/QuartzCore.h>
#include <TargetConditionals.h>

${PATCH_MARKER}
// Applied by apps/mobile/scripts/patch-enriched-markdown-tail-fade.mjs on top
// of react-native-enriched-markdown 1.0.2. Multiple tails animate in parallel:
// starting a new fade does NOT cancel the ones already in flight.

static const NSTimeInterval kFadeDuration = 0.25;

/// Clamps a character range to the current storage length. Tail ranges stay
/// valid across streaming updates because the text is append-only, but the
/// storage can transiently shrink (e.g. the streaming filter hiding
/// incomplete syntax), so every application must be bounds-checked.
static NSRange ENRMClampRangeToLength(NSRange range, NSUInteger length)
{
  if (range.location >= length) {
    return NSMakeRange(0, 0);
  }
  NSUInteger end = MIN(NSMaxRange(range), length);
  return NSMakeRange(range.location, end - range.location);
}

/// One contiguous foreground-color run inside a fade entry's tail range.
@interface ENRMFadeColorRun : NSObject
@property (nonatomic, assign) NSRange range;
@property (nonatomic, strong) RCTUIColor *color;
@property (nonatomic, assign) CGFloat baseAlpha;
@end

@implementation ENRMFadeColorRun
@end

/// One in-flight tail fade. Entries animate in parallel and are all driven by
/// a single display link.
@interface ENRMFadeEntry : NSObject
@property (nonatomic, assign) NSRange range;
@property (nonatomic, assign) CFTimeInterval startTime;
@property (nonatomic, assign) CGFloat easedAlpha;
@property (nonatomic, copy) NSArray<ENRMFadeColorRun *> *runs;
@end

@implementation ENRMFadeEntry
@end

@implementation ENRMTailFadeInAnimator {
  __weak ENRMPlatformTextView *_textView;
#if !TARGET_OS_OSX
  CADisplayLink *_displayLink;
#endif
  NSMutableArray<ENRMFadeEntry *> *_entries;
}

- (instancetype)initWithTextView:(ENRMPlatformTextView *)textView
{
  self = [super init];
  if (self) {
    _textView = textView;
    _entries = [NSMutableArray array];
  }
  return self;
}

- (void)dealloc
{
#if !TARGET_OS_OSX
  [_displayLink invalidate];
  _displayLink = nil;
#endif
}

/// Starts a fade-in for the appended [tailStart, tailEnd) range.
///
/// Must be called right after the text view's attributed text has been
/// replaced with the new (fully opaque) content: besides starting the new
/// fade, it re-snapshots the original colors of every in-flight fade from the
/// fresh storage and re-applies their current alpha before the next frame is
/// rendered, so earlier tails keep fading instead of flashing fully opaque.
- (void)animateFrom:(NSUInteger)tailStart to:(NSUInteger)tailEnd
{
  NSTextStorage *storage = _textView.textStorage;
  if (!storage) {
    return;
  }

  // The storage has just been replaced with fully opaque content. Re-snapshot
  // the in-flight entries' colors from it so their fade target stays correct
  // even when earlier text was retroactively re-styled by the new parse
  // (e.g. a streamed-in link or code span closing).
  for (ENRMFadeEntry *entry in _entries) {
    entry.runs = [self snapshotColorRunsInRange:entry.range storage:storage];
  }

  BOOL hasNewTail = tailEnd > tailStart && tailEnd <= storage.length;

#if !TARGET_OS_OSX
  if (hasNewTail && !UIAccessibilityIsReduceMotionEnabled()) {
    ENRMFadeEntry *entry = [[ENRMFadeEntry alloc] init];
    entry.range = NSMakeRange(tailStart, tailEnd - tailStart);
    entry.startTime = CACurrentMediaTime();
    entry.easedAlpha = 0.0;
    entry.runs = [self snapshotColorRunsInRange:entry.range storage:storage];
    [_entries addObject:entry];
  }
#else
  // macOS has no CADisplayLink; the freshly set text is already fully opaque,
  // so displaying it directly requires no work here.
  (void)hasNewTail;
#endif

  if (_entries.count == 0) {
    return;
  }

  // Re-apply the current alpha of every entry before the next frame renders;
  // without this, tails still fading from previous updates would flash fully
  // opaque for one frame after the text replacement. The entry appended above
  // starts at alpha 0.
  [storage beginEditing];
  for (ENRMFadeEntry *entry in _entries) {
    [self applyEntryColors:entry toStorage:storage];
  }
  [storage endEditing];

#if !TARGET_OS_OSX
  [self ensureDisplayLink];
#endif
}

#if !TARGET_OS_OSX
- (void)ensureDisplayLink
{
  if (_displayLink) {
    return;
  }

  // CADisplayLink retains its target. The cycle is transient: step: invalidates
  // the link as soon as the last entry finishes, and cancel invalidates it eagerly.
  _displayLink = [CADisplayLink displayLinkWithTarget:self selector:@selector(step:)];
  // 0 tells the system to use the display's maximum frame rate — 60 Hz on standard displays and 120 Hz on ProMotion ones
  _displayLink.preferredFramesPerSecond = 0;
  [_displayLink addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
}

- (void)step:(CADisplayLink *)link
{
  NSTextStorage *storage = _textView.textStorage;
  if (!storage || _entries.count == 0) {
    // Text view is gone or nothing is left to animate; stop the display link.
    [self cancel];
    return;
  }

  CFTimeInterval now = CACurrentMediaTime();
  NSMutableArray<ENRMFadeEntry *> *finished = [NSMutableArray array];

  [storage beginEditing];
  for (ENRMFadeEntry *entry in _entries) {
    CGFloat progress = fmin((now - entry.startTime) / kFadeDuration, 1.0);
    // Quadratic ease-out: fast start, gentle landing.
    entry.easedAlpha = 1.0 - (1.0 - progress) * (1.0 - progress);
    [self applyEntryColors:entry toStorage:storage];
    if (progress >= 1.0) {
      [finished addObject:entry];
    }
  }
  [storage endEditing];

  [_entries removeObjectsInArray:finished];

  if (_entries.count == 0) {
    [_displayLink invalidate];
    _displayLink = nil;
  }
}
#endif

/// Applies the entry's current alpha to all of its color runs. At alpha 1 the
/// exact original color object is restored (preserving dynamic colors and any
/// intrinsic alpha the run had before the fade started).
- (void)applyEntryColors:(ENRMFadeEntry *)entry toStorage:(NSTextStorage *)storage
{
  CGFloat alpha = entry.easedAlpha;
  for (ENRMFadeColorRun *run in entry.runs) {
    NSRange clamped = ENRMClampRangeToLength(run.range, storage.length);
    if (clamped.length == 0) {
      continue;
    }
    RCTUIColor *color = alpha >= 1.0 ? run.color : [run.color colorWithAlphaComponent:run.baseAlpha * alpha];
    [storage addAttribute:NSForegroundColorAttributeName value:color range:clamped];
  }
}

/// Snapshots the fully opaque foreground colors currently in the given range.
/// Must be called before any fade alpha is applied to that range.
- (NSArray<ENRMFadeColorRun *> *)snapshotColorRunsInRange:(NSRange)range storage:(NSTextStorage *)storage
{
  NSRange clamped = ENRMClampRangeToLength(range, storage.length);
  if (clamped.length == 0) {
    return @[];
  }

  NSMutableArray<ENRMFadeColorRun *> *runs = [NSMutableArray array];
  [storage enumerateAttribute:NSForegroundColorAttributeName
                      inRange:clamped
                      options:0
                   usingBlock:^(RCTUIColor *color, NSRange subRange, BOOL *stop) {
                     ENRMFadeColorRun *run = [[ENRMFadeColorRun alloc] init];
                     run.color = color ?: [RCTUIColor labelColor];
                     run.baseAlpha = CGColorGetAlpha(run.color.CGColor);
                     run.range = subRange;
                     [runs addObject:run];
                   }];
  return runs;
}

/// Cancels every in-flight fade and restores the affected ranges to their
/// original, fully opaque foreground colors.
- (void)cancel
{
#if !TARGET_OS_OSX
  [_displayLink invalidate];
  _displayLink = nil;
#endif

  if (_entries.count == 0) {
    return;
  }

  NSTextStorage *storage = _textView.textStorage;
  if (storage) {
    [storage beginEditing];
    for (ENRMFadeEntry *entry in _entries) {
      entry.easedAlpha = 1.0;
      [self applyEntryColors:entry toStorage:storage];
    }
    [storage endEditing];
  }

  [_entries removeAllObjects];
}

@end
`;

export function patchTailFadeAnimator(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Tail fade animator source is empty or malformed.');
  if (source.includes(PATCH_MARKER)) {
    if (source !== PATCHED_SOURCE) throw new Error('Tail fade animator carries a stale or edited Clawket patch; reinstall react-native-enriched-markdown.');
    return source;
  }
  for (const sentinel of UPSTREAM_SENTINELS) {
    if (source.split(sentinel).length !== 2) {
      throw new Error('Tail fade animator source does not match the reviewed react-native-enriched-markdown 1.0.2 upstream.');
    }
  }
  return PATCHED_SOURCE;
}

export function applyTailFadePatch(mobileRoot) {
  const relative = 'node_modules/react-native-enriched-markdown/ios/utils/ENRMTailFadeInAnimator.m';
  const candidates = [path.join(mobileRoot, relative), path.resolve(mobileRoot, '../..', relative)];
  const files = [...new Set(candidates.filter((file) => fs.existsSync(file)).map((file) => fs.realpathSync(file)))];
  if (!files.length) throw new Error('Tail fade animator source is missing. Install mobile dependencies first.');
  // Validate every copy before writing any of them.
  const validated = files.map((file) => {
    const source = fs.readFileSync(file, 'utf8');
    return { file, source, patched: patchTailFadeAnimator(source) };
  });
  for (const { file, source, patched } of validated) if (patched !== source) fs.writeFileSync(file, patched);
  return files.length;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const count = applyTailFadePatch(process.env.CLAWKET_MOBILE_ROOT || path.resolve(path.dirname(scriptPath), '..'));
  console.log(`Verified enriched-markdown parallel tail fade patch: ${count} source file(s).`);
}
