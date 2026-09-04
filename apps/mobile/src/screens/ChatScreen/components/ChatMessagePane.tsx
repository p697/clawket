import React, { RefObject, useMemo } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { ChevronDown } from 'lucide-react-native';
import { CircleButton } from '../../../components/ui';
import { SlashSuggestions } from '../../../components/chat/SlashSuggestions';
import { useAppTheme } from '../../../theme';
import { Radius, Shadow, Space, createThemedShadowStyle } from '../../../theme/tokens';
import { SlashCommand } from '../../../data/slash-commands';
import { UiMessage } from '../../../types/chat';

type Props = {
  extraData?: unknown;
  flatListRef: RefObject<any>;
  gatewayEpoch: number;
  listData: UiMessage[];
  listFadeAnim: Animated.Value;
  loadingMoreHistory: boolean;
  newMessageIds: Set<string>;
  onEndReached: () => void;
  onListContentSizeChange?: () => void;
  onScroll: (atBottom: boolean) => void;
  onScrollBeginDrag: () => void;
  onScrollEndDrag: () => void;
  onScrollToBottom: () => void;
  onSelectSlashCommand: (command: SlashCommand) => void;
  renderMessageBubble: (item: UiMessage) => React.ReactElement | null;
  sessionKey: string;
  showScrollButton: boolean;
  showSlashSuggestions: boolean;
  slashSuggestions: SlashCommand[];
  slashInputValue: string;
  slashSuggestionsMaxHeight: number;
  theme: ReturnType<typeof useAppTheme>['theme'];
  onDismissSlashSuggestions: () => void;
};

function AnimatedEntrance({ children }: { children: React.ReactNode }) {
  const opacity = React.useRef(new Animated.Value(0)).current;
  const translateY = React.useRef(new Animated.Value(6)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 240,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 240,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

export function ChatMessagePane({
  extraData,
  flatListRef,
  gatewayEpoch,
  listData,
  listFadeAnim,
  loadingMoreHistory,
  newMessageIds,
  onDismissSlashSuggestions,
  onEndReached,
  onListContentSizeChange,
  onScroll,
  onScrollBeginDrag,
  onScrollEndDrag,
  onScrollToBottom,
  onSelectSlashCommand,
  renderMessageBubble,
  sessionKey,
  showScrollButton,
  showSlashSuggestions,
  slashInputValue,
  slashSuggestions,
  slashSuggestionsMaxHeight,
  theme,
}: Props): React.JSX.Element {
  const styles = useMemo(() => createStyles(theme.colors, theme.scheme), [theme]);

  return (
    <View style={styles.listArea}>
      <Animated.View style={[styles.listAreaContent, { opacity: listFadeAnim }]}>
        <FlashList
          key={`chat:${gatewayEpoch}:${sessionKey || 'none'}`}
          ref={flatListRef}
          inverted
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          data={listData}
          extraData={extraData}
          keyExtractor={(item) => item.id}
          onContentSizeChange={onListContentSizeChange}
          onScroll={(event) => {
            const atBottom = event.nativeEvent.contentOffset.y < 60;
            onScroll(atBottom);
          }}
          scrollEventThrottle={16}
          onScrollBeginDrag={onScrollBeginDrag}
          onScrollEndDrag={onScrollEndDrag}
          onEndReachedThreshold={0.3}
          onEndReached={onEndReached}
          ListFooterComponent={loadingMoreHistory ? <ActivityIndicator style={styles.historyLoadingMore} /> : null}
          renderItem={({ item, target }) => {
            const animateEntrance = target === 'Cell' && newMessageIds.has(item.id);
            const bubble = renderMessageBubble(item);
            if (!bubble) return null;
            if (animateEntrance) {
              return <AnimatedEntrance key={item.id}>{bubble}</AnimatedEntrance>;
            }
            return bubble;
          }}
        />

        {showScrollButton ? (
          <CircleButton
            icon={<ChevronDown size={20} color={theme.colors.textMuted} strokeWidth={2.5} />}
            onPress={onScrollToBottom}
            size={36}
            color={theme.colors.surfaceElevated}
            shadow
            style={styles.scrollToBottomWrap}
          />
        ) : null}

        <View style={styles.slashOverlay} pointerEvents={showSlashSuggestions ? 'auto' : 'none'}>
          {showSlashSuggestions ? (
            <Pressable style={styles.slashDismissArea} onPress={onDismissSlashSuggestions} />
          ) : null}
          <View style={styles.slashPopupWrap}>
            <SlashSuggestions
              visible={showSlashSuggestions}
              inputValue={slashInputValue}
              suggestions={slashSuggestions}
              maxHeight={slashSuggestionsMaxHeight}
              onSelect={onSelectSlashCommand}
            />
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

function createStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
  scheme: ReturnType<typeof useAppTheme>['theme']['scheme'],
) {
  return StyleSheet.create({
    historyLoadingMore: {
      paddingVertical: Space.md,
    },
    listArea: {
      flex: 1,
      minHeight: 0,
    },
    listAreaContent: {
      flex: 1,
    },
    listContent: {
      paddingHorizontal: Space.sm,
      // FlashList is inverted, so paddingTop becomes the visual bottom inset.
      paddingTop: Space.lg,
      paddingBottom: Space.md,
    },
    scrollToBottomWrap: {
      position: 'absolute',
      right: Space.lg,
      bottom: Space.lg,
      borderRadius: Radius.full,
      ...createThemedShadowStyle(colors, scheme, Shadow.md),
    },
    slashDismissArea: {
      ...StyleSheet.absoluteFillObject,
    },
    slashOverlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'flex-end',
    },
    slashPopupWrap: {
      paddingHorizontal: Space.sm,
      paddingBottom: Space.sm - 8,
    },
  });
}
