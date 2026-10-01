import type { SessionPermissionMode } from '@clawket/agent-protocol';
import type { ModelInfo } from './ModelPickerModal';
import { FontSize, Space } from '../../theme/tokens';
import { normalizeModelProvider, resolveProviderModel } from './model-picker-data';

/** Models the first page offers before "All N models" (owner request 2026-10-01: at least three). */
export const FEATURED_MODEL_COUNT = 3;
/** A catalog this small is listed whole on the first page, with no second page. */
export const INLINE_CATALOG_LIMIT = 4;
/** Permission presets from the least to the most the Agent may do on its own. */
export const PERMISSION_MODE_ORDER: readonly SessionPermissionMode[] = ['read-only', 'workspace', 'full-access'];

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** Stable identity of a catalog row across renders, searches and pages. */
export function modelRowKey(model: ModelInfo): string {
  return `${normalizeModelProvider(model.provider)}:${model.id || model.name}`;
}

/**
 * Whether `model` is the conversation's model. Native settings name it by its
 * id or resolved model; OpenClaw sessions by id (or name for id-less rows)
 * with an optional provider.
 */
export function isCurrentModel(model: ModelInfo, currentModel?: string | null, currentProvider?: string | null): boolean {
  const want = normalize(currentModel);
  if (!want) return false;
  if (currentProvider && normalize(model.provider) !== normalize(currentProvider)) return false;
  return [model.id || model.name, model.resolvedModel, resolveProviderModel(model)].some((value) => normalize(value) === want);
}

function compareCatalogOrder(a: ModelInfo, b: ModelInfo): number {
  const aOrder = typeof a.sortOrder === 'number' && Number.isFinite(a.sortOrder) ? a.sortOrder : Infinity;
  const bOrder = typeof b.sortOrder === 'number' && Number.isFinite(b.sortOrder) ? b.sortOrder : Infinity;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return normalize(a.name || a.id).localeCompare(normalize(b.name || b.id));
}

/**
 * The first page's models: the current one, then the ones chosen recently on
 * this device, then the configured default, then the catalog's own order
 * (native recommendation order where the backend ranks it). A small catalog
 * is listed whole in catalog order.
 */
export function featuredModels(args: Readonly<{
  models: readonly ModelInfo[];
  current?: ModelInfo | null;
  recentRefs?: readonly string[];
  defaultRef?: string | null;
  limit?: number;
}>): ModelInfo[] {
  const ordered = [...args.models].sort(compareCatalogOrder);
  if (ordered.length <= INLINE_CATALOG_LIMIT) return ordered;
  const limit = args.limit ?? FEATURED_MODEL_COUNT;
  const byRef = new Map<string, ModelInfo>();
  for (const model of ordered) {
    const ref = normalize(resolveProviderModel(model));
    if (!byRef.has(ref)) byRef.set(ref, model);
  }
  const picked: ModelInfo[] = [];
  const seen = new Set<string>();
  const add = (model: ModelInfo | null | undefined) => {
    if (!model || picked.length >= limit) return;
    const key = modelRowKey(model);
    if (seen.has(key)) return;
    seen.add(key);
    picked.push(model);
  };
  add(args.current);
  for (const ref of args.recentRefs ?? []) add(byRef.get(normalize(ref)));
  if (args.defaultRef) add(byRef.get(normalize(args.defaultRef)));
  for (const model of ordered) add(model);
  return picked;
}

/** Width of a one-line label at `fontSize`: CJK glyphs are square, Latin ones about half as wide. */
export function estimateLabelWidth(label: string, fontSize: number): number {
  let width = 0;
  for (const char of label) {
    width += /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/.test(char) ? fontSize : fontSize * 0.58;
  }
  return width;
}

export type ThinkingLayout = Readonly<{ kind: 'inline' | 'segments' | 'chips'; fontSize: number }>;

const INLINE_SEGMENT_MAX = 5;
/** Segment labels use the caption step (the system segmented control's 13 points), then the meta step. */
const SEGMENT_FONT_STEPS: readonly (readonly [fontSize: number, padding: number])[] = [
  [FontSize.caption, 10],
  [FontSize.caption, 8],
  [FontSize.meta, 6],
];

/**
 * How the thinking depth fits a card `cardWidth` wide: beside its label when
 * a few short options fit, as a full-width segmented control when every label
 * fits its segment (stepping the label down to 12 points), else as wrapping
 * chips (long translations such as "Extra High" in seven options).
 */
export function resolveThinkingLayout(args: Readonly<{
  labels: readonly string[];
  cardWidth: number;
  /** The row's own label ("Thinking"), which the inline layout sits beside. */
  rowLabel: string;
  /** The text scale the labels render at (already capped by the caller). */
  fontScale: number;
}>): ThinkingLayout {
  const { labels, cardWidth, rowLabel, fontScale } = args;
  const regular = FontSize.caption;
  const rowLabelWidth = estimateLabelWidth(rowLabel, FontSize.body * fontScale) + Space.md;
  if (labels.length === 0) return { kind: 'chips', fontSize: regular };
  const widest = (size: number) => Math.max(...labels.map((label) => estimateLabelWidth(label, size * fontScale)));
  // Inline: the row's 16-point leading inset, the label and its gap, the 10-point trailing inset.
  const inlineTrack = cardWidth - 16 - rowLabelWidth - 10;
  if (labels.length <= INLINE_SEGMENT_MAX && (widest(regular) + 12) * labels.length <= inlineTrack) {
    return { kind: 'inline', fontSize: regular };
  }
  // Full width: 12-point insets on both sides of the track.
  for (const [size, padding] of SEGMENT_FONT_STEPS) {
    if ((widest(size) + padding) * labels.length <= cardWidth - 24) return { kind: 'segments', fontSize: size };
  }
  return { kind: 'chips', fontSize: regular };
}
