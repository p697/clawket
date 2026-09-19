import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ChevronUp, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { FloatingButton } from '../../components/ui/FloatingButton';
import {
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
} from '../../components/ui/SettingsGroup';
import { Sheet } from '../../components/ui/Sheet';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, LineHeight, Space } from '../../theme/tokens';

export type FallbackModelsSheetProps = Readonly<{
  visible: boolean;
  fallbacks: ReadonlyArray<{ reference: string; name: string }>;
  editable: boolean;
  onClose: () => void;
  onMoveUp: (index: number) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
}>;

/** Ordered fallback list: the Gateway tries each in turn when the default model fails. */
export function FallbackModelsSheet({
  visible,
  fallbacks,
  editable,
  onClose,
  onMoveUp,
  onRemove,
  onAdd,
}: FallbackModelsSheetProps): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);

  return (
    <Sheet
      testID="agent-model-fallbacks"
      visible={visible}
      title={t('Fallback models', { ns: 'settings' })}
      closeAccessibilityLabel={t('Close', { ns: 'common' })}
      onClose={onClose}
      footer={editable ? (
        <View style={styles.footer}>
          <Button
            testID="agent-model-fallbacks-add"
            label={t('Add fallback', { ns: 'settings' })}
            variant="secondary"
            onPress={onAdd}
          />
        </View>
      ) : undefined}
    >
      <View style={styles.content}>
        <Text style={styles.hint}>{t('Tried in order when the default model fails.', { ns: 'settings' })}</Text>
        {fallbacks.length === 0 ? (
          <Text testID="agent-model-fallbacks-empty" style={styles.hint}>{t('None', { ns: 'settings' })}</Text>
        ) : (
          <SettingsGroup>
            {fallbacks.map((fallback, index) => (
              <React.Fragment key={fallback.reference}>
                {index ? <SettingsDivider inset="content" /> : null}
                <SettingsRow
                  testID={`agent-model-fallback-${index}`}
                  title={`${index + 1}. ${fallback.name}`}
                  subtitle={fallback.reference !== fallback.name ? fallback.reference : undefined}
                  trailing={editable ? (
                    <View style={styles.rowActions}>
                      <FloatingButton
                        testID={`agent-model-fallback-up-${index}`}
                        icon={ChevronUp}
                        appearance="plain"
                        accessibilityLabel={t('Move up', { ns: 'settings' })}
                        disabled={index === 0}
                        onPress={() => onMoveUp(index)}
                      />
                      <FloatingButton
                        testID={`agent-model-fallback-remove-${index}`}
                        icon={X}
                        appearance="plain"
                        accessibilityLabel={t('Remove', { ns: 'common' })}
                        onPress={() => onRemove(index)}
                      />
                    </View>
                  ) : undefined}
                />
              </React.Fragment>
            ))}
          </SettingsGroup>
        )}
      </View>
    </Sheet>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    content: { gap: Space.md, paddingHorizontal: Space.lg, paddingBottom: Space.xxl },
    footer: { padding: Space.lg },
    hint: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
    },
    rowActions: { flexDirection: 'row', alignItems: 'center' },
  });
}
