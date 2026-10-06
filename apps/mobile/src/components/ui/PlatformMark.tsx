import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { getGatewayBackendDescriptor } from '@clawket/agent-protocol';
import Svg, { Path, Rect } from 'react-native-svg';
import { ControlSize, Radius } from '../../theme/tokens';
import { useAppTheme } from '../../theme';

const marks = {
  'claude-code': require('../../../assets/brands/claude-code.png'),
  codex: require('../../../assets/brands/codex.png'),
  pi: require('../../../assets/brands/pi.png'),
  openclaw: require('../../../assets/brands/openclaw.png'),
  hermes: require('../../../assets/brands/hermes.png'),
} as const;

type Platform = keyof typeof marks | 'local-model';
export type PlatformKind = Platform;

/**
 * Backends whose Agent is the product itself — one Agent per connection with no identity of its own —
 * so the official mark is that Agent's face wherever it appears (owner decision 2026-09-27). OpenClaw
 * Agents keep their own avatars and carry the mark as a corner badge instead.
 */
const PRODUCT_FACE_PLATFORMS: ReadonlySet<Platform> = new Set(['hermes', 'codex', 'claude-code', 'pi', 'local-model']);

export function isProductFacePlatform(platform: Platform | null | undefined): platform is Platform {
  return platform != null && PRODUCT_FACE_PLATFORMS.has(platform);
}

/**
 * The brand a product face shows, so a name beside it need not repeat it; null when the face is
 * the Agent's own. The local model's chip names no brand.
 */
export function productFaceBrand(platform: Platform | null | undefined): string | null {
  return isProductFacePlatform(platform) && platform !== 'local-model' ? getGatewayBackendDescriptor(platform).label : null;
}

/**
 * Share of its image box each bundled artwork covers (measured from the PNG alpha). App artwork is a
 * tile with its own ground, so a disc shows its inside; a bare mark sits on the disc.
 */
const ARTWORK: Readonly<Record<keyof typeof marks, Readonly<{ fill: number; tile: boolean }>>> = {
  openclaw: { fill: 0.92, tile: false },
  'claude-code': { fill: 0.85, tile: false },
  pi: { fill: 0.59, tile: false },
  codex: { fill: 0.81, tile: true },
  hermes: { fill: 0.79, tile: true },
};

/** A dense mark reads larger than a sparse one of the same width; tuned by eye on the device roster. */
const DISC_OPTICAL_SCALE: Readonly<Partial<Record<Platform, number>>> = { openclaw: 1.08, pi: 0.92 };

/** App artwork overscans the disc slightly so its tile corners and drop shadow never show inside it. */
const TILE_OVERSCAN = 1.02;

/**
 * Drawn size of each mark in the 44-point chooser slot, tuned by eye on a device screenshot (owner
 * request 2026-09-27) so a list of brands reads as one size: app artwork brings its own tile and safe
 * area (Pi's logo keeps 20%), and a filled tile reads larger than a bare glyph of the same width.
 * Sizes above 44 only spill transparent margin.
 */
const BALANCED_SIZE: Readonly<Record<Platform, number>> = {
  openclaw: 36,
  'claude-code': 39,
  hermes: 46,
  codex: 45,
  pi: 50,
  'local-model': 41,
};

/**
 * Product marks; bundled artwork provenance is recorded in assets/brands/SOURCES.md. `balanced` sizes
 * the mark beside other brands in a slot set by `size` (44 points by default); otherwise `size` sets the image box.
 */
export function PlatformMark({ platform, size, balanced = false }: { platform: Platform; size?: number; balanced?: boolean }) {
  const drawn = balanced ? BALANCED_SIZE[platform] * ((size ?? ControlSize.floatingButton) / ControlSize.floatingButton) : size;
  if (platform === 'local-model') return <LocalModelMark size={drawn} />;
  return <Image accessible={false} source={marks[platform]} resizeMode="contain" style={[platform === 'hermes' || platform === 'codex' ? styles.appIcon : styles.mark, drawn ? { width: drawn, height: drawn } : null]} />;
}

/** Processor outline in the 52-point frame, sized to sit inside the 42-point tile like the app-icon artwork. */
const LOCAL_MODEL_CHIP = 'M21.75 18.5h8.5a3.25 3.25 0 0 1 3.25 3.25v8.5a3.25 3.25 0 0 1-3.25 3.25h-8.5a3.25 3.25 0 0 1-3.25-3.25v-8.5a3.25 3.25 0 0 1 3.25-3.25Z'
  + 'M24.25 23h3.5a1.25 1.25 0 0 1 1.25 1.25v3.5a1.25 1.25 0 0 1-1.25 1.25h-3.5a1.25 1.25 0 0 1-1.25-1.25v-3.5a1.25 1.25 0 0 1 1.25-1.25Z'
  + 'M22.5 15v3M26 15v3M29.5 15v3M22.5 34v3M26 34v3M29.5 34v3M15 22.5h3M15 26h3M15 29.5h3M34 22.5h3M34 26h3M34 29.5h3';

/**
 * Clawket-drawn mark for the brand-less local-model backend (owner request 2026-09-26: an outline
 * on a quiet tile, never a dark backing). Theme ink and surface keep it readable in both schemes.
 */
function LocalModelMark({ size = ControlSize.settingsRow }: { size?: number }) {
  const { theme: { colors } } = useAppTheme();
  // Hold the outline at 1.2 points or more when drawn small (connection list, avatar badge).
  const strokeWidth = Math.max(1.9, (1.2 * ControlSize.settingsRow) / size);
  return <Svg testID="platform-mark-local-model" accessible={false} width={size} height={size} viewBox="0 0 52 52">
    <Rect x={5} y={5} width={42} height={42} rx={10.5} fill={colors.surface} />
    <Path d={LOCAL_MODEL_CHIP} fill="none" stroke={colors.ink} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}

/** The chip alone, cropped to its own bounds, for a disc that already is the quiet ground. */
const LOCAL_MODEL_CHIP_VIEWBOX = '13 13 26 26';
const LOCAL_MODEL_CHIP_EXTENT = 26;
const DISC_OUTLINE_WIDTH = 1.4;

function LocalModelGlyph({ size, ink }: { size: number; ink?: string }) {
  const { theme: { colors } } = useAppTheme();
  return <Svg testID="platform-disc-local-model-glyph" accessible={false} width={size} height={size} viewBox={LOCAL_MODEL_CHIP_VIEWBOX}>
    <Path d={LOCAL_MODEL_CHIP} fill="none" stroke={ink ?? colors.ink} strokeWidth={(DISC_OUTLINE_WIDTH * LOCAL_MODEL_CHIP_EXTENT) / size}
      strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}

/**
 * The official mark fitted to a circle of `size` points: app artwork fills the circle edge to edge (its
 * tile is the ground) and a bare mark spans `glyph` of the diameter on the `ground` surface. Used as a
 * product Agent's face (floating white with a hairline edge from the caller) and as the corner badge of
 * an Agent with its own avatar (`surface` grey: a white disc vanished on the canvas, as the conversation
 * badge showed on 2026-09-27); the caller owns rings.
 */
export function PlatformDisc({ platform, size, glyph, ground = 'floating', artworkColors, testID }: {
  platform: Platform;
  size: number;
  glyph: number;
  ground?: 'floating' | 'surface';
  /** Fixed colours for exported artwork (share posters) that must not follow the app's dark mode. */
  artworkColors?: Readonly<{ ground: string; ink: string }>;
  testID?: string;
}) {
  const { theme: { colors } } = useAppTheme();
  let content: React.ReactNode;
  if (platform === 'local-model') {
    content = <LocalModelGlyph size={size * glyph} ink={artworkColors?.ink} />;
  } else {
    const artwork = ARTWORK[platform];
    const box = artwork.tile
      ? (size / artwork.fill) * TILE_OVERSCAN
      : (size * glyph * (DISC_OPTICAL_SCALE[platform] ?? 1)) / artwork.fill;
    content = <Image testID={testID ? `${testID}-image` : undefined} accessible={false} source={marks[platform]}
      resizeMode="contain" style={{ width: box, height: box }} />;
  }
  return <View testID={testID} style={[styles.disc, {
    width: size,
    height: size,
    backgroundColor: artworkColors?.ground ?? (ground === 'surface' ? colors.surface : colors.surfaceFloating),
  }]}>
    {content}
  </View>;
}

const styles = StyleSheet.create({
  // The official app artwork already includes its corner shape and safe area.
  appIcon: { width: ControlSize.settingsRow, height: ControlSize.settingsRow },
  mark: { width: ControlSize.pill, height: ControlSize.pill, borderRadius: Radius.settingsGroup },
  disc: { borderRadius: Radius.full, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
