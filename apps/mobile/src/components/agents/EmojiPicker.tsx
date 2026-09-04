import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { FontSize, Radius, Space } from '../../theme/tokens';

// Curated emoji set grouped by category
const EMOJI_SECTIONS: { label: string; emojis: string[] }[] = [
  {
    label: 'Faces',
    emojis: [
      // Row 1: happy / positive
      '\u{1F600}', '\u{1F603}', '\u{1F604}', '\u{1F601}', '\u{1F606}',
      '\u{1F605}', '\u{1F602}', '\u{1F923}', '\u{1F60A}', '\u{1F607}',
      // Row 2: love / affection
      '\u{1F970}', '\u{1F60D}', '\u{1F929}', '\u{1F618}', '\u{1F617}',
      '\u{1F61A}', '\u{1F619}', '\u{263A}\u{FE0F}', '\u{1F972}', '\u{1F979}',
      // Row 3: playful / tongue
      '\u{1F60B}', '\u{1F61B}', '\u{1F61C}', '\u{1F92A}', '\u{1F61D}',
      '\u{1F911}', '\u{1F917}', '\u{1F92D}', '\u{1F92B}', '\u{1F914}',
      // Row 4: neutral / skeptical
      '\u{1F910}', '\u{1F928}', '\u{1F610}', '\u{1F611}', '\u{1F636}',
      '\u{1F60F}', '\u{1F612}', '\u{1F644}', '\u{1F62C}', '\u{1F925}',
      // Row 5: cool / special
      '\u{1F60E}', '\u{1F913}', '\u{1F9D0}', '\u{1F615}', '\u{1F61F}',
      '\u{1F641}', '\u{2639}\u{FE0F}', '\u{1F62E}', '\u{1F632}', '\u{1F633}',
      // Row 6: surprised / scared
      '\u{1F631}', '\u{1F628}', '\u{1F630}', '\u{1F625}', '\u{1F622}',
      '\u{1F62D}', '\u{1F624}', '\u{1F621}', '\u{1F620}', '\u{1F92F}',
      // Row 7: sick / sleepy / misc
      '\u{1F975}', '\u{1F976}', '\u{1F974}', '\u{1F971}', '\u{1F634}',
      '\u{1F62A}', '\u{1F924}', '\u{1F922}', '\u{1F92E}', '\u{1F927}',
      // Row 8: costume / fantasy faces
      '\u{1F916}', '\u{1F47B}', '\u{1F47D}', '\u{1F4A9}', '\u{1F921}',
      '\u{1F47F}', '\u{1F608}', '\u{1F480}', '\u{1F383}', '\u{1F47E}',
    ],
  },
  {
    label: 'Gestures & People',
    emojis: [
      '\u{1F44B}', '\u{1F44D}', '\u{1F44E}', '\u{1F44F}', '\u{1F64C}',
      '\u{1F4AA}', '\u{270C}\u{FE0F}', '\u{1F918}', '\u{1F919}', '\u{1F91D}',
      '\u{1F9D1}\u{200D}\u{1F4BB}', '\u{1F468}\u{200D}\u{1F4BB}', '\u{1F469}\u{200D}\u{1F4BB}',
      '\u{1F9D1}\u{200D}\u{1F52C}', '\u{1F9D1}\u{200D}\u{1F3A8}', '\u{1F9D1}\u{200D}\u{1F680}',
      '\u{1F9D1}\u{200D}\u{1F3EB}', '\u{1F9D1}\u{200D}\u{2695}\u{FE0F}',
      '\u{1F977}', '\u{1F9D9}', '\u{1F9DA}', '\u{1F9B8}', '\u{1F9BE}',
      '\u{1F464}', '\u{1F465}',
    ],
  },
  {
    label: 'Animals',
    emojis: [
      '\u{1F431}', '\u{1F436}', '\u{1F43B}', '\u{1F98A}', '\u{1F981}',
      '\u{1F42F}', '\u{1F984}', '\u{1F434}', '\u{1F437}', '\u{1F430}',
      '\u{1F428}', '\u{1F43C}', '\u{1F427}', '\u{1F426}', '\u{1F985}',
      '\u{1F409}', '\u{1F40D}', '\u{1F422}', '\u{1F419}', '\u{1F42C}',
      '\u{1F433}', '\u{1F41D}', '\u{1F98B}', '\u{1F99C}', '\u{1F98E}',
      '\u{1F9A5}', '\u{1F43A}', '\u{1F99D}', '\u{1F994}', '\u{1F987}',
    ],
  },
  {
    label: 'Symbols',
    emojis: [
      '\u{2764}\u{FE0F}', '\u{1F525}', '\u{2B50}', '\u{26A1}', '\u{1F4A1}',
      '\u{1F4AB}', '\u{1F31F}', '\u{1F308}', '\u{1F680}', '\u{1F389}',
      '\u{1F388}', '\u{1F381}', '\u{1F3C6}', '\u{1F3C5}', '\u{1F396}\u{FE0F}',
      '\u{1F4A5}', '\u{1F4A2}', '\u{1F4AF}', '\u{2728}', '\u{1F4AC}',
    ],
  },
  {
    label: 'Objects',
    emojis: [
      '\u{1F4BB}', '\u{1F5A5}\u{FE0F}', '\u{2328}\u{FE0F}', '\u{1F4F1}',
      '\u{1F50D}', '\u{1F512}', '\u{1F513}', '\u{1F527}', '\u{2699}\u{FE0F}',
      '\u{1F6E0}\u{FE0F}', '\u{1F4E6}', '\u{1F4DA}', '\u{1F4DD}', '\u{1F4CB}',
      '\u{1F3AF}', '\u{1F3B2}', '\u{1F9E9}', '\u{1F4A3}', '\u{1F4E1}',
      '\u{1F52E}', '\u{1F9F2}', '\u{1F9EA}', '\u{1F9EC}', '\u{1F52D}',
      '\u{1F4D0}', '\u{1F4CE}', '\u{1F4CC}', '\u{1F58A}\u{FE0F}', '\u{1F4C8}',
      '\u{1F4CA}',
    ],
  },
  {
    label: 'Nature',
    emojis: [
      '\u{1F332}', '\u{1F335}', '\u{1F33F}', '\u{1F340}', '\u{1F33B}',
      '\u{1F337}', '\u{1F339}', '\u{1F33A}', '\u{1F338}', '\u{1F490}',
      '\u{1F30A}', '\u{1F30D}', '\u{1F30C}', '\u{2600}\u{FE0F}', '\u{1F319}',
      '\u{26C8}\u{FE0F}', '\u{1F300}', '\u{1F30B}', '\u{1F48E}', '\u{1FAA8}',
    ],
  },
  {
    label: 'Food & Drink',
    emojis: [
      '\u{2615}', '\u{1F375}', '\u{1F37A}', '\u{1F377}', '\u{1F379}',
      '\u{1F9C9}', '\u{1F355}', '\u{1F354}', '\u{1F32E}', '\u{1F363}',
      '\u{1F370}', '\u{1F382}', '\u{1F34E}', '\u{1F353}', '\u{1F349}',
      '\u{1F36D}', '\u{1F36B}', '\u{1F369}', '\u{1F95C}', '\u{1F9C1}',
    ],
  },
];

const ALL_EMOJIS = EMOJI_SECTIONS.flatMap((s) => s.emojis);

/** Return a random emoji from the curated set. */
export function getRandomEmoji(): string {
  return ALL_EMOJIS[Math.floor(Math.random() * ALL_EMOJIS.length)];
}

type Props = {
  value: string;
  onSelect: (emoji: string) => void;
  disabled?: boolean;
};

const MIN_CELL = 40;

export function EmojiPicker({ value, onSelect, disabled }: Props): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const scrollRef = useRef<ScrollView>(null);
  const [columns, setColumns] = useState(0);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width;
    setColumns(Math.max(7, Math.floor(width / MIN_CELL)));
  }, []);

  return (
    <View style={styles.container} onLayout={onLayout}>
      {/* Selected emoji preview */}
      <View style={styles.previewRow}>
        <View style={[styles.previewBubble, { backgroundColor: theme.colors.surfaceMuted }]}>
          <Text style={styles.previewEmoji}>{value || '\u{2753}'}</Text>
        </View>
      </View>

      {/* Emoji grid */}
      {columns > 0 && (
        <ScrollView
          ref={scrollRef}
          style={styles.gridScroll}
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {EMOJI_SECTIONS.map((section) => (
            <View key={section.label}>
              {section.label !== 'Faces' && (
                <Text style={styles.sectionLabel}>{t(section.label)}</Text>
              )}
              <View style={styles.grid}>
                {section.emojis.map((emoji) => {
                  const selected = emoji === value;
                  const cellPct = 100 / columns;
                  return (
                    <TouchableOpacity
                      key={emoji}
                      style={[styles.cell, { width: `${cellPct}%` }]}
                      onPress={() => onSelect(emoji)}
                      activeOpacity={0.6}
                      disabled={disabled}
                    >
                      <View style={[styles.cellInner, selected && styles.cellSelected]}>
                        <Text style={styles.cellEmoji}>{emoji}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    container: {
      gap: Space.sm,
    },
    previewRow: {
      alignItems: 'center',
      paddingVertical: Space.xs,
    },
    previewBubble: {
      width: 56,
      height: 56,
      borderRadius: Radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    previewEmoji: {
      fontSize: FontSize.displayHero,
    },
    gridScroll: {
      maxHeight: 200,
    },
    gridContent: {
      paddingBottom: Space.xs,
    },
    sectionLabel: {
      fontSize: FontSize.xs,
      color: colors.textSubtle,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: Space.xs,
      marginTop: Space.sm,
      paddingHorizontal: 2,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    cell: {
      alignItems: 'center',
      paddingVertical: 2,
    },
    cellInner: {
      width: 36,
      height: 36,
      borderRadius: Radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cellSelected: {
      backgroundColor: colors.primarySoft,
    },
    cellEmoji: {
      fontSize: FontSize.emoji,
      lineHeight: 28,
      textAlign: 'center',
      textAlignVertical: 'center',
      includeFontPadding: false,
    },
  });
}
