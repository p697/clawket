import React, { useEffect, useMemo, useState } from 'react';
import { BrainCircuit, BrushIcon, Headphones } from 'lucide-react-native';
import { ChevronRight } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { useAppTheme } from '../../../theme';
import { FontSize, FontWeight, Radius } from '../../../theme/tokens';
import type { YouMindBoardEntry, YouMindBoardEntryIcon } from '../../../services/youmind';

type Props = {
  entry: YouMindBoardEntry;
  onPress: () => void;
  collapsed?: boolean;
};

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
  size = 22,
}: {
  color: string | null | undefined;
  size?: number;
}): React.JSX.Element {
  const { theme } = useAppTheme();
  const fill = resolveGroupColor(color, theme.scheme);
  const gradientId = useMemo(() => `group-${Math.random().toString(36).slice(2, 10)}`, []);

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

function DocumentIcon({ color }: { color: string }): React.JSX.Element {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M14 2.2V6C14 6.53043 14.2107 7.03914 14.5858 7.41421C14.9609 7.78928 15.4696 8 16 8H19.8"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M4 5.4V7.2V18.6C4 20.4778 5.52223 22 7.4 22H16H16.6C18.4778 22 20 20.4778 20 18.6V8.40833C20 7.50659 19.6418 6.64179 19.0042 6.00416L17.5 4.5L15.9958 2.99584C15.3582 2.35821 14.4934 2 13.5917 2H7.4C5.52223 2 4 3.52223 4 5.4Z"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path d="M8 16H16M8 12H12" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

function WebpageIcon({ color }: { color: string }): React.JSX.Element {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M18 4H6C4.34315 4 3 5.34315 3 7V17C3 18.6569 4.34315 20 6 20H18C19.6569 20 21 18.6569 21 17V7C21 5.34315 19.6569 4 18 4Z"
        stroke={color}
        strokeWidth={2}
      />
      <Path d="M3.5 8H20" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M7 4.5V7.5" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M10.5 4.5V7.5" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

function SlidesIcon({ color }: { color: string }): React.JSX.Element {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path d="M12 16V21" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M7 21H17" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path
        d="M20 3H4V13C4 14.6569 5.34315 16 7 16H17C18.6569 16 20 14.6569 20 13V3Z"
        stroke={color}
        strokeWidth={2}
      />
      <Path d="M3 3H21" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path
        d="M14.4148 9.09038L10.7867 6.55071C10.4553 6.31874 10 6.55582 10 6.96033V12.0397C10 12.4442 10.4553 12.6813 10.7867 12.4493L14.4148 9.90962C14.6992 9.71057 14.6992 9.28943 14.4148 9.09038Z"
        fill={color}
      />
    </Svg>
  );
}

function CraftGlyph({
  icon,
  color,
}: {
  icon: YouMindBoardEntryIcon;
  color: string;
}): React.JSX.Element {
  switch (icon.kind) {
    case 'group':
      return <GroupIcon color={icon.color} />;
    case 'document':
      return <DocumentIcon color={color} />;
    case 'webpage':
      return <WebpageIcon color={color} />;
    case 'slides':
      return <SlidesIcon color={color} />;
    case 'audio-pod':
      return <Headphones size={22} color={color} strokeWidth={2} />;
    case 'canvas':
      return <BrushIcon size={22} color={color} strokeWidth={2} />;
    case 'memory':
      return <BrainCircuit size={22} color={color} strokeWidth={2} />;
    default:
      return <DocumentIcon color={color} />;
  }
}

function EntryIcon({ icon }: { icon: YouMindBoardEntryIcon }): React.JSX.Element {
  const { theme } = useAppTheme();
  const [uri, setUri] = useState(icon.kind === 'image' ? icon.url : null);

  useEffect(() => {
    setUri(icon.kind === 'image' ? icon.url : null);
  }, [icon]);

  if (icon.kind === 'image' && uri) {
    return (
      <Image
        source={{ uri }}
        style={styles.imageIcon}
        onError={() => {
          const fallback = icon.fallbackUrl?.trim();
          if (fallback && fallback !== uri) {
            setUri(fallback);
            return;
          }
          setUri(null);
        }}
      />
    );
  }

  return (
    <View style={styles.vectorIconWrap}>
      <CraftGlyph icon={icon.kind === 'image' ? { kind: 'webpage' } : icon} color={theme.colors.textMuted} />
    </View>
  );
}

export function YouMindEntryRow({ entry, onPress, collapsed = false }: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const disabled = entry.kind !== 'group' && !entry.detailPath;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        {
          marginLeft: entry.depth * 12,
          opacity: disabled ? 0.72 : 1,
          backgroundColor: pressed && !disabled ? theme.colors.surfaceMuted : 'transparent',
        },
      ]}
      disabled={disabled}
      onPress={onPress}
    >
      <EntryIcon icon={entry.icon} />
      <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>
        {entry.title}
      </Text>
      {entry.kind === 'group' ? (
        <ChevronRight
          size={18}
          color={theme.colors.textSubtle}
          style={{ transform: [{ rotate: collapsed ? '0deg' : '90deg' }] }}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: Radius.md,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  title: {
    flex: 1,
    fontSize: FontSize.lg,
    lineHeight: 20,
    fontWeight: FontWeight.medium,
  },
  imageIcon: {
    width: 22,
    height: 22,
    borderRadius: Radius.sm,
    resizeMode: 'cover',
  },
  vectorIconWrap: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
