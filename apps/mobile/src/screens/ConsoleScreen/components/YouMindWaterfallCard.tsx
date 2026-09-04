import React, { useEffect, useMemo, useState } from 'react';
import { BrainCircuit, BrushIcon, Headphones, MessageSquareText } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import type { YouMindBoardEntry, YouMindBoardEntryCardVariant, YouMindBoardEntryIcon } from '../../../services/youmind';
import { useAppTheme } from '../../../theme';
import { FontSize, FontWeight, PresentationColor, Radius, Space, createSurfaceStyle } from '../../../theme/tokens';

type Props = {
  entry: YouMindBoardEntry;
  onPress: () => void;
  collapsed?: boolean;
  shouldLoadMedia?: boolean;
};

const imageAspectRatioCache = new Map<string, number | null>();

const groupPalette = {
  '--function-gray': {
    light: '#8E8E93',
    dark: '#98989D',
  },
  '--function-folder': {
    light: '#1FA9FF',
    dark: '#1FA9FF',
  },
  '--function-mint': {
    light: '#5DD6CC',
    dark: '#71EDE3',
  },
  '--function-purple': {
    light: '#A25AD9',
    dark: '#B262ED',
  },
  '--function-red': {
    light: '#EA4E43',
    dark: '#EA5243',
  },
  '--function-orange': {
    light: '#FF9500',
    dark: '#FF9F0A',
  },
} as const;

function resolveGroupColor(color: string | null | undefined, scheme: 'light' | 'dark'): string {
  const paletteEntry = color ? groupPalette[color as keyof typeof groupPalette] : null;
  return paletteEntry?.[scheme] || groupPalette['--function-folder'][scheme];
}

function GroupIcon({
  color,
  size = 28,
}: {
  color: string | null | undefined;
  size?: number;
}): React.JSX.Element {
  const { theme } = useAppTheme();
  const fill = resolveGroupColor(color, theme.scheme);
  const gradientId = useMemo(() => `waterfall-group-${Math.random().toString(36).slice(2, 10)}`, []);

  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Path
        d="M1.5 4.5C1.5 3.25736 2.50736 2.25 3.75 2.25H6.83917C7.27061 2.25 7.69296 2.37404 8.05587 2.60735L9.93971 3.81838C10.0607 3.89615 10.2015 3.9375 10.3453 3.9375H14.25C15.4926 3.9375 16.5 4.94486 16.5 6.1875V13.5C16.5 14.7426 15.4926 15.75 14.25 15.75H3.75C2.50736 15.75 1.5 14.7426 1.5 13.5V4.5Z"
        fill={fill}
      />
      <Path
        d="M3 6.75C3 5.92157 3.67157 5.25 4.5 5.25H13.5C14.3284 5.25 15 5.92157 15 6.75V7.5H3V6.75Z"
        fill="white"
        fillOpacity={0.8}
      />
      <Path
        d="M1.5 8.25C1.5 7.42157 2.17157 6.75 3 6.75H15C15.8284 6.75 16.5 7.42157 16.5 8.25V13.5C16.5 14.7426 15.4926 15.75 14.25 15.75H3.75C2.50736 15.75 1.5 14.7426 1.5 13.5V8.25Z"
        fill={`url(#${gradientId})`}
        fillOpacity={0.6}
      />
      <Defs>
        <LinearGradient id={gradientId} x1="9" y1="6.75" x2="9" y2="15.75">
          <Stop offset="0" stopColor={fill} stopOpacity={0.6} />
          <Stop offset="1" stopColor={fill} stopOpacity={0.5} />
        </LinearGradient>
      </Defs>
    </Svg>
  );
}

function formatRelativeTime(value: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  const diffMs = Date.now() - value;
  const diffMin = Math.max(0, Math.round(diffMs / 60000));

  if (diffMin < 1) return t('Just now');
  if (diffMin < 60) return t('{{count}}m ago', { count: diffMin });

  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return t('{{count}}h ago', { count: diffHour });

  const diffDay = Math.round(diffHour / 24);
  return t('{{count}}d ago', { count: diffDay });
}

function IconGlyph({
  variant,
  icon,
  color,
}: {
  variant: YouMindBoardEntryCardVariant;
  icon: YouMindBoardEntryIcon;
  color: string;
}): React.JSX.Element {
  if (variant === 'group' && icon.kind === 'group') {
    return <GroupIcon color={icon.color} size={30} />;
  }
  switch (variant) {
    case 'audio-pod':
      return <Headphones size={26} color={color} strokeWidth={2} />;
    case 'canvas':
      return <BrushIcon size={26} color={color} strokeWidth={2} />;
    case 'memory':
      return <BrainCircuit size={26} color={color} strokeWidth={2} />;
    case 'chat':
      return <MessageSquareText size={72} color={color} strokeWidth={1.6} />;
    default:
      return <GroupIcon color={icon.kind === 'group' ? icon.color : '--function-folder'} size={30} />;
  }
}

function RemoteImage({
  uri,
  fallbackUri,
  style,
  shouldLoad = true,
}: {
  uri?: string | null;
  fallbackUri?: string | null;
  style: any;
  shouldLoad?: boolean;
}): React.JSX.Element | null {
  const [sourceUri, setSourceUri] = useState(uri || null);

  useEffect(() => {
    setSourceUri(uri || null);
  }, [uri]);

  if (!shouldLoad || !sourceUri) return null;

  return (
    <Image
      source={{ uri: sourceUri }}
      style={style}
      onError={() => {
        if (fallbackUri && fallbackUri !== sourceUri) {
          setSourceUri(fallbackUri);
          return;
        }
        setSourceUri(null);
      }}
    />
  );
}

export function estimateYouMindWaterfallCardHeight(entry: YouMindBoardEntry): number {
  switch (entry.card.variant) {
    case 'article':
    case 'webpage':
    case 'page':
    case 'slides':
      return 208;
    case 'image':
      return Math.max(132, Math.min(280, Math.round(168 / Math.max(0.6, Math.min(entry.card.aspectRatio || 1, 1.8)))));
    case 'chat':
      return 176;
    case 'group':
      return 144;
    case 'audio-pod':
      return 188;
    default:
      return 164;
  }
}

export function YouMindWaterfallCard({
  entry,
  onPress,
  collapsed = false,
  shouldLoadMedia = true,
}: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const card = entry.card;
  const disabled = entry.kind !== 'group' && !entry.detailPath;
  const timeLabel = formatRelativeTime(entry.updatedAtMs, t);
  const title = card.title || entry.title;
  const description = card.description?.trim() || null;
  const subtitle = card.subtitle?.trim() || null;
  const media = card.imageUrl?.trim() || null;
  const [imageAspectRatio, setImageAspectRatio] = useState<number | null>(() => {
    if (card.aspectRatio && card.aspectRatio > 0) return card.aspectRatio;
    if (!media) return null;
    return imageAspectRatioCache.get(media) ?? null;
  });

  useEffect(() => {
    if (card.variant !== 'image') return;
    if (card.aspectRatio && card.aspectRatio > 0) {
      if (media) {
        imageAspectRatioCache.set(media, card.aspectRatio);
      }
      setImageAspectRatio(card.aspectRatio);
      return;
    }
    if (!shouldLoadMedia || !media) {
      setImageAspectRatio(null);
      return;
    }
    const cachedAspectRatio = imageAspectRatioCache.get(media);
    if (typeof cachedAspectRatio === 'number' && cachedAspectRatio > 0) {
      setImageAspectRatio(cachedAspectRatio);
      return;
    }
    let cancelled = false;
    Image.getSize(
      media,
      (width, height) => {
        if (cancelled || !width || !height) return;
        const nextAspectRatio = width / height;
        imageAspectRatioCache.set(media, nextAspectRatio);
        setImageAspectRatio(nextAspectRatio);
      },
      () => {
        if (!cancelled) {
          imageAspectRatioCache.set(media, null);
          setImageAspectRatio(null);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [card.aspectRatio, card.variant, media, shouldLoadMedia]);

  const renderGroup = () => (
    <View style={[styles.cardBody, styles.groupCardBody]}>
      <View style={[styles.groupIconBadge, { backgroundColor: theme.colors.surfaceMuted }]}>
        <GroupIcon color={entry.icon.kind === 'group' ? entry.icon.color : null} size={28} />
      </View>
      <Text style={[styles.groupTitle, { color: theme.colors.text }]} numberOfLines={2}>
        {title}
      </Text>
      <Text style={[styles.groupMeta, { color: theme.colors.textSubtle }]}>
        {collapsed ? t('Collapsed group') : t('Expanded group')}
      </Text>
    </View>
  );

  const renderChat = () => (
    <View style={[styles.cardBody, styles.chatCardBody]}>
      <View style={styles.chatBadgeRow}>
        <View style={[styles.chatBadge, { backgroundColor: theme.colors.surfaceMuted }]}>
          <IconGlyph variant="chat" icon={entry.icon} color={theme.colors.textMuted} />
        </View>
      </View>
      <Text style={[styles.chatTitle, { color: theme.colors.text }]} numberOfLines={4}>
        {title}
      </Text>
      <Text style={[styles.footerTime, { color: theme.colors.textSubtle }]}>{timeLabel}</Text>
    </View>
  );

  const renderMediaTopCard = (imageHeight: number, fallbackIcon?: React.JSX.Element) => (
    <View>
      <View style={[styles.mediaWrap, { height: imageHeight, backgroundColor: theme.colors.surfaceMuted }]}>
        {media ? (
          <RemoteImage
            uri={media}
            fallbackUri={entry.icon.kind === 'image' ? entry.icon.fallbackUrl : null}
            style={styles.mediaImage}
            shouldLoad={shouldLoadMedia}
          />
        ) : fallbackIcon ? (
          <View style={styles.centerFill}>{fallbackIcon}</View>
        ) : null}
        <View style={[styles.mediaShade, { backgroundColor: PresentationColor.mediaTintSoft }]} />
      </View>
      <View style={styles.cardBody}>
        {subtitle ? (
          <View style={styles.siteRow}>
            {card.faviconUrl ? (
              <RemoteImage uri={card.faviconUrl} style={styles.favicon} shouldLoad={shouldLoadMedia} />
            ) : (
              <View style={[styles.faviconFallback, { backgroundColor: theme.colors.surfaceMuted }]}>
                <Text style={[styles.faviconLetter, { color: theme.colors.textMuted }]}>
                  {(subtitle[0] || '?').toUpperCase()}
                </Text>
              </View>
            )}
            <Text style={[styles.siteText, { color: theme.colors.textMuted }]} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
        ) : null}
        <Text style={[styles.cardTitle, { color: theme.colors.text }]} numberOfLines={2}>
          {title}
        </Text>
        {description ? (
          <Text style={[styles.cardDescription, { color: theme.colors.textMuted }]} numberOfLines={3}>
            {description}
          </Text>
        ) : null}
        <Text style={[styles.footerTime, { color: theme.colors.textSubtle }]}>{timeLabel}</Text>
      </View>
    </View>
  );

  const renderImageOnlyCard = (fallbackIcon?: React.JSX.Element) => (
    <View>
      <View
        style={[
          styles.imageOnlyWrap,
          {
            backgroundColor: theme.colors.surfaceMuted,
            aspectRatio: imageAspectRatio && imageAspectRatio > 0 ? imageAspectRatio : 1,
          },
        ]}
      >
        {media ? (
          <RemoteImage
            uri={media}
            fallbackUri={entry.icon.kind === 'image' ? entry.icon.fallbackUrl : null}
            style={styles.imageOnlyMedia}
            shouldLoad={shouldLoadMedia}
          />
        ) : fallbackIcon ? (
          <View style={styles.centerFill}>{fallbackIcon}</View>
        ) : null}
      </View>
    </View>
  );

  const renderTextualCard = (fallbackIcon: React.JSX.Element) => (
    <View style={styles.cardBody}>
      <View style={[styles.smallHero, { backgroundColor: theme.colors.surfaceMuted }]}>
        {media ? (
          <RemoteImage
            uri={media}
            fallbackUri={entry.icon.kind === 'image' ? entry.icon.fallbackUrl : null}
            style={styles.mediaImage}
            shouldLoad={shouldLoadMedia}
          />
        ) : (
          fallbackIcon
        )}
        <View style={[styles.mediaShade, { backgroundColor: PresentationColor.mediaTintSoft }]} />
      </View>
      <Text style={[styles.cardTitle, { color: theme.colors.text }]} numberOfLines={2}>
        {title}
      </Text>
      {description ? (
        <Text style={[styles.cardDescription, { color: theme.colors.textMuted }]} numberOfLines={3}>
          {description}
        </Text>
      ) : null}
      <Text style={[styles.footerTime, { color: theme.colors.textSubtle }]}>{timeLabel}</Text>
    </View>
  );

  let content: React.JSX.Element;
  switch (card.variant) {
    case 'group':
      content = renderGroup();
      break;
    case 'chat':
      content = renderChat();
      break;
    case 'article':
    case 'webpage':
      content = renderMediaTopCard(104, <IconGlyph variant={card.variant} icon={entry.icon} color={theme.colors.textMuted} />);
      break;
    case 'image':
      content = renderImageOnlyCard(<IconGlyph variant={card.variant} icon={entry.icon} color={theme.colors.textMuted} />);
      break;
    case 'page':
    case 'slides':
    case 'memory':
      content = renderMediaTopCard(112, <IconGlyph variant={card.variant} icon={entry.icon} color={theme.colors.textMuted} />);
      break;
    case 'audio-pod':
    case 'canvas':
    case 'file':
    case 'note':
    default:
      content = renderTextualCard(
        <IconGlyph variant={card.variant} icon={entry.icon} color={theme.colors.textMuted} />,
      );
      break;
  }

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        createSurfaceStyle(theme.colors, theme.scheme, 'raised'),
        {
          opacity: disabled ? 0.78 : 1,
          transform: [{ translateY: pressed && !disabled ? -1 : 0 }],
        },
      ]}
      disabled={disabled}
      onPress={onPress}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  cardBody: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 8,
  },
  groupCardBody: {
    minHeight: 144,
    justifyContent: 'center',
  },
  groupIconBadge: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupTitle: {
    fontSize: FontSize.base,
    lineHeight: 21,
    fontWeight: FontWeight.semibold,
  },
  groupMeta: {
    fontSize: FontSize.xs,
  },
  chatCardBody: {
    minHeight: 176,
    justifyContent: 'space-between',
  },
  chatBadgeRow: {
    marginBottom: 2,
  },
  chatBadge: {
    width: 38,
    height: 38,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatTitle: {
    fontSize: FontSize.base,
    lineHeight: 21,
    fontWeight: FontWeight.semibold,
  },
  mediaWrap: {
    width: '100%',
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    overflow: 'hidden',
  },
  mediaImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  imageOnlyMedia: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  imageOnlyWrap: {
    width: '100%',
    borderRadius: Radius.lg,
    overflow: 'hidden',
    minHeight: 132,
  },
  mediaShade: {
    ...StyleSheet.absoluteFillObject,
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallHero: {
    width: '100%',
    height: 84,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  siteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 1,
  },
  favicon: {
    width: 18,
    height: 18,
    borderRadius: Radius.xs,
  },
  faviconFallback: {
    width: 18,
    height: 18,
    borderRadius: Radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faviconLetter: {
    fontSize: FontSize.micro,
    fontWeight: FontWeight.semibold,
  },
  siteText: {
    flex: 1,
    fontSize: FontSize.xs,
    lineHeight: 14,
  },
  cardTitle: {
    fontSize: FontSize.base,
    lineHeight: 21,
    fontWeight: FontWeight.semibold,
  },
  cardDescription: {
    fontSize: FontSize.xs,
    lineHeight: 16,
  },
  footerTime: {
    fontSize: FontSize.xs,
    marginTop: 2,
  },
});
