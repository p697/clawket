import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronRight, GripVertical, Plus, Trash2 } from 'lucide-react-native';
import DraggableFlatList, { ScaleDecorator, type RenderItemParams } from 'react-native-draggable-flatlist';
import { IconButton } from '../ui';
import type { ModelInfo } from '../chat/ModelPickerModal';
import { ThinkingLevelMenu } from '../chat/ThinkingLevelMenu';
import { triggerDragEndHaptic, triggerDragStartHaptic } from '../../services/haptics';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';

type Props = {
  model: string;
  fallbacks: string[];
  thinkingDefault?: string;
  onPickThinkingLevel?: () => void;
  onSelectThinkingLevel?: (value: string) => void;
  models: ModelInfo[];
  onPickPrimary: () => void;
  onPickFallback: () => void;
  onRemoveFallback: (index: number) => void;
  onMoveFallback?: (fromIndex: number, toIndex: number) => void;
  reorderEnabled?: boolean;
  disabled?: boolean;
};

export function ModelConfigSection({
  model,
  fallbacks,
  thinkingDefault,
  onPickThinkingLevel,
  onSelectThinkingLevel,
  models,
  onPickPrimary,
  onPickFallback,
  onRemoveFallback,
  onMoveFallback,
  reorderEnabled,
  disabled,
}: Props): React.JSX.Element {
  const { t } = useTranslation('console');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const fallbackItems = useMemo(
    () => fallbacks.map((value, index) => ({ key: `${value}_${index}`, value })),
    [fallbacks],
  );

  const renderFallbackRow = React.useCallback((
    item: { key: string; value: string },
    index: number,
    options?: { drag?: () => void; isActive?: boolean },
  ) => {
    const modelInfo = models.find((m) => m.id === item.value);

    return (
      <View key={item.key} style={[styles.fallbackItem, options?.isActive && styles.fallbackItemActive]}>
        <View style={styles.fallbackOrder}>
          <Text style={styles.fallbackOrderText}>{index + 1}</Text>
        </View>
        <View style={styles.fallbackTextWrap}>
          <Text style={styles.fallbackName} numberOfLines={1}>
            {modelInfo?.name || item.value}
          </Text>
          {modelInfo?.provider ? (
            <Text style={styles.fallbackProvider} numberOfLines={1}>
              {modelInfo.provider}
            </Text>
          ) : null}
        </View>
        {reorderEnabled && onMoveFallback ? (
          <IconButton
            icon={<GripVertical size={16} color={theme.colors.textMuted} strokeWidth={2} />}
            onPress={() => {}}
            onLongPress={options?.drag}
            disabled={disabled}
          />
        ) : null}
        <IconButton
          icon={<Trash2 size={16} color={theme.colors.error} strokeWidth={2} />}
          onPress={() => onRemoveFallback(index)}
          disabled={disabled}
        />
      </View>
    );
  }, [disabled, models, onMoveFallback, onRemoveFallback, reorderEnabled, styles, theme.colors.error, theme.colors.textMuted]);

  const renderFallbackItem = React.useCallback((params: RenderItemParams<{ key: string; value: string }>) => {
    const { item, getIndex, drag, isActive } = params;
    const index = getIndex() ?? 0;
    return (
      <ScaleDecorator>
        {renderFallbackRow(item, index, { drag, isActive })}
      </ScaleDecorator>
    );
  }, [renderFallbackRow]);

  return (
    <View>
      {/* Primary Model */}
      <Text style={styles.fieldLabel}>{t('Primary Model')}</Text>
      <TouchableOpacity
        style={styles.fieldRow}
        onPress={onPickPrimary}
        activeOpacity={0.7}
        disabled={disabled}
      >
        <Text
          style={[styles.fieldRowText, !model && { color: theme.colors.textSubtle }]}
          numberOfLines={1}
        >
          {model || 'Default'}
        </Text>
        <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
      </TouchableOpacity>

      {/* Fallback Models */}
      <View style={styles.fallbackHeader}>
        <Text style={styles.fieldLabel}>{t('Fallback Models')}</Text>
        <TouchableOpacity
          style={styles.addFallbackButton}
          onPress={onPickFallback}
          activeOpacity={0.7}
          disabled={disabled}
        >
          <Plus size={16} color={theme.colors.primary} strokeWidth={2.5} />
          <Text style={styles.addFallbackText}>{t('common:Add')}</Text>
        </TouchableOpacity>
      </View>

      {fallbacks.length === 0 ? (
        <View style={styles.emptyFallback}>
          <Text style={styles.emptyFallbackText}>
            {t('No fallback models configured. The agent will only use the primary model.')}
          </Text>
        </View>
      ) : (
        <View style={styles.fallbackList}>
          {reorderEnabled && onMoveFallback ? (
            <DraggableFlatList
              data={fallbackItems}
              keyExtractor={(item) => item.key}
              renderItem={renderFallbackItem}
              onDragBegin={() => {
                triggerDragStartHaptic();
              }}
              onDragEnd={({ from, to }) => {
                triggerDragEndHaptic();
                if (from !== to) onMoveFallback(from, to);
              }}
              activationDistance={8}
              containerStyle={styles.fallbackDraggableList}
              scrollEnabled={false}
            />
          ) : (
            fallbackItems.map((item, index) => renderFallbackRow(item, index))
          )}
        </View>
      )}

      {/* Default Thinking Level */}
      {(onPickThinkingLevel != null || onSelectThinkingLevel != null) && (
        <>
          <Text style={styles.fieldLabel}>{t('Default Thinking Level')}</Text>
          {onSelectThinkingLevel ? (
            <ThinkingLevelMenu
              current={thinkingDefault || 'off'}
              onSelect={onSelectThinkingLevel}
              disabled={disabled}
              title={t('Default Thinking Level')}
              style={styles.fullWidthMenuTrigger}
            >
              <View style={styles.fieldRow}>
                <Text
                  style={[styles.fieldRowText, !thinkingDefault && { color: theme.colors.textSubtle }]}
                  numberOfLines={1}
                >
                  {t(`thinking_${thinkingDefault || 'off'}`)}
                </Text>
                <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
              </View>
            </ThinkingLevelMenu>
          ) : (
            <TouchableOpacity
              style={styles.fieldRow}
              onPress={onPickThinkingLevel}
              activeOpacity={0.7}
              disabled={disabled}
            >
              <Text
                style={[styles.fieldRowText, !thinkingDefault && { color: theme.colors.textSubtle }]}
                numberOfLines={1}
              >
                {t(`thinking_${thinkingDefault || 'off'}`)}
              </Text>
              <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    fieldLabel: {
      fontSize: FontSize.md,
      fontWeight: FontWeight.medium,
      color: colors.textMuted,
      marginBottom: Space.xs,
      marginTop: Space.lg,
    },
    fieldRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.inputBackground,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: Radius.md,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm + 4,
    },
    fullWidthMenuTrigger: {
      width: '100%',
    },
    fieldRowText: {
      flex: 1,
      fontSize: FontSize.base,
      color: colors.text,
    },
    fallbackHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: Space.lg,
      marginBottom: Space.xs,
    },
    addFallbackButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
      paddingVertical: Space.xs,
      paddingHorizontal: Space.sm,
    },
    addFallbackText: {
      fontSize: FontSize.md,
      fontWeight: FontWeight.semibold,
      color: colors.primary,
    },
    emptyFallback: {
      backgroundColor: colors.inputBackground,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: Radius.md,
      padding: Space.md,
    },
    emptyFallbackText: {
      fontSize: FontSize.md,
      color: colors.textSubtle,
      textAlign: 'center',
    },
    fallbackList: {
      backgroundColor: colors.inputBackground,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: Radius.md,
      overflow: 'hidden',
    },
    fallbackItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: Space.md,
      paddingRight: Space.xs,
      paddingVertical: Space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    fallbackItemActive: {
      backgroundColor: colors.surfaceMuted,
    },
    fallbackDraggableList: {
      overflow: 'hidden',
    },
    fallbackOrder: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: Space.sm,
    },
    fallbackOrderText: {
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
      color: colors.textMuted,
    },
    fallbackTextWrap: {
      flex: 1,
      minWidth: 0,
    },
    fallbackName: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
      color: colors.text,
    },
    fallbackProvider: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
      marginTop: 1,
    },
  });
}
