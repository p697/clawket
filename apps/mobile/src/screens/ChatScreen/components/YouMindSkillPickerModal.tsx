import React, { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  SectionListData,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetSectionList,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { Check, Search, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FullWindowOverlay } from 'react-native-screens';
import { IconButton } from '../../../components/ui';
import { getYouMindSkillBackgroundUri } from '../../../services/youmind-skill-background';
import { useAppTheme } from '../../../theme';
import { FontSize, FontWeight, PresentationColor, Radius, Space } from '../../../theme/tokens';
import type { YouMindInstalledSkills, YouMindSkillSummary } from '../../../services/youmind';
import { YouMindSkillIcon } from './YouMindSkillIcon';
import { buildYouMindSkillSections, type YouMindSkillSection } from './youmind-skill-picker-data';

function ModalContainer({ children }: React.PropsWithChildren): React.JSX.Element {
  if (Platform.OS !== 'ios') {
    return <>{children}</>;
  }

  return (
    <FullWindowOverlay>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {children}
      </View>
    </FullWindowOverlay>
  );
}

function SkillAvatar({
  skill,
  size,
}: {
  skill: YouMindSkillSummary;
  size: number;
}): React.JSX.Element {
  return (
    <View
      style={[
        stylesShared.skillAvatarWrap,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
      ]}
    >
      <Image
        source={{ uri: getYouMindSkillBackgroundUri(skill) }}
        style={[
          stylesShared.skillAvatarImage,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
          },
        ]}
        resizeMode="cover"
      />
      <View style={stylesShared.skillAvatarShade} />
      <View
        style={[
          stylesShared.skillAvatarOverlay,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
          },
        ]}
      >
        <YouMindSkillIcon skill={skill} color={PresentationColor.onMedia} size={Math.max(12, Math.round(size * 0.48))} />
      </View>
    </View>
  );
}

type Props = {
  onClose: () => void;
  onRetry?: () => void;
  onSelectSkill: (skill: YouMindSkillSummary) => void;
  selectedSkillId?: string | null;
  skills: YouMindInstalledSkills | null;
  currentUserId?: string | null;
  loading: boolean;
  error?: string | null;
};

export type YouMindSkillPickerModalHandle = {
  present: () => void;
  dismiss: () => void;
};

export const YouMindSkillPickerModal = React.memo(React.forwardRef<YouMindSkillPickerModalHandle, Props>(function YouMindSkillPickerModal({
  onClose,
  onRetry,
  onSelectSkill,
  selectedSkillId,
  skills,
  currentUserId,
  loading,
  error,
}, ref): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const snapPoints = useMemo(() => ['58%', '92%'], []);
  const sections = useMemo(() => buildYouMindSkillSections(skills, searchQuery, {
    pinned: t('Pinned skills'),
    mySkills: t('My skills'),
    installed: t('Installed skills'),
  }, currentUserId), [currentUserId, searchQuery, skills, t]);

  useImperativeHandle(ref, () => ({
    present: () => {
      setSearchQuery('');
      bottomSheetRef.current?.present();
    },
    dismiss: () => {
      bottomSheetRef.current?.dismiss();
    },
  }), []);

  const handleClose = useCallback(() => {
    setSearchQuery('');
    onClose();
  }, [onClose]);

  const handleSelectSkill = useCallback((skill: YouMindSkillSummary) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSelectSkill(skill);
    setSearchQuery('');
    bottomSheetRef.current?.dismiss();
  }, [onSelectSkill]);

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={theme.scheme === 'dark' ? 0.58 : 0.34}
        pressBehavior="close"
      />
    ),
    [theme.scheme],
  );

  const renderSectionHeader = useCallback(({ section }: { section: SectionListData<YouMindSkillSummary, YouMindSkillSection> }) => {
    const sectionIndex = sections.findIndex((item) => item.key === section.key);
    return section.key === 'pinned' || section.key === 'mySkills' || section.key === 'installed' ? (
      <View style={[styles.sectionHeader, sectionIndex > 0 && styles.sectionHeaderSpaced]}>
        <Text style={styles.sectionHeaderText}>{section.title}</Text>
        <Text style={styles.sectionHeaderCount}>{section.data.length}</Text>
      </View>
    ) : null;
  }, [sections, styles]);

  const renderSkillRow = useCallback(({ item }: { item: YouMindSkillSummary }) => {
    const selected = item.id === selectedSkillId;
    return (
      <Pressable
        onPress={() => handleSelectSkill(item)}
        style={({ pressed }) => [styles.skillRow, pressed && styles.skillRowPressed]}
      >
        <View style={styles.skillIconWrap}>
          <SkillAvatar skill={item} size={36} />
        </View>
        <View style={styles.skillTextWrap}>
          <View style={styles.skillTitleRow}>
            <Text style={styles.skillTitle} numberOfLines={1}>
              {item.name}
            </Text>
            {selected ? (
              <View style={styles.currentBadge}>
                <Text style={styles.currentBadgeText}>{t('Current')}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.skillSubtitle} numberOfLines={2}>
            {item.description || t('No description available')}
          </Text>
        </View>
        <View style={styles.selectionMarkWrap}>
          {selected ? (
            <Check size={18} color={theme.colors.primary} strokeWidth={2.6} />
          ) : null}
        </View>
      </Pressable>
    );
  }, [handleSelectSkill, selectedSkillId, styles, t, theme.colors.primary, theme.colors.surfaceMuted]);

  const renderControls = useCallback(() => (
    <View style={styles.listHeader}>
      <View style={styles.searchWrap}>
        <Search size={16} color={theme.colors.textSubtle} strokeWidth={2} />
        <BottomSheetTextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t('Search skills...')}
          placeholderTextColor={theme.colors.textSubtle}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>
    </View>
  ), [searchQuery, styles, t, theme.colors.textSubtle]);

  const renderEmptyState = useCallback(() => (
    <View style={styles.stateWrap}>
      <Text style={styles.stateText}>
        {searchQuery.trim().length > 0 ? t('No skills found') : t('No skills available')}
      </Text>
    </View>
  ), [searchQuery, styles, t]);

  const content = loading ? (
    <View style={styles.stateWrap}>
      <ActivityIndicator size="small" color={theme.colors.primary} />
      <Text style={styles.stateText}>{t('Loading skills...')}</Text>
    </View>
  ) : error ? (
    <View style={styles.stateWrap}>
      <Text style={styles.stateText}>{error}</Text>
      {onRetry ? (
        <TouchableOpacity style={styles.retryBtn} onPress={onRetry}>
          <Text style={styles.retryText}>{t('Retry')}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  ) : sections.length === 0 ? (
    renderEmptyState()
  ) : (
    <BottomSheetSectionList
      sections={sections}
      keyExtractor={(item: YouMindSkillSummary) => item.id}
      renderItem={renderSkillRow}
      renderSectionHeader={renderSectionHeader}
      initialNumToRender={12}
      maxToRenderPerBatch={8}
      ListHeaderComponent={renderControls}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.listContent,
        { paddingBottom: Math.max(insets.bottom, Space.md) + 12 },
      ]}
      removeClippedSubviews={Platform.OS === 'android'}
      stickySectionHeadersEnabled={false}
      showsVerticalScrollIndicator={false}
      windowSize={5}
    />
  );

  return (
    <ModalContainer>
      <BottomSheetModal
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        topInset={insets.top + 8}
        enablePanDownToClose
        onDismiss={handleClose}
        backdropComponent={renderBackdrop}
        handleIndicatorStyle={{ backgroundColor: theme.colors.borderStrong, width: 40 }}
        backgroundStyle={{ backgroundColor: theme.colors.surface }}
      >
        <View style={[styles.header, { paddingTop: 4 }]}>
          <Text style={styles.headerTitle}>{t('Add Skill')}</Text>
          <IconButton
            icon={<X size={18} color={theme.colors.textMuted} strokeWidth={2.2} />}
            onPress={() => bottomSheetRef.current?.dismiss()}
            size={34}
          />
        </View>
        {content}
      </BottomSheetModal>
    </ModalContainer>
  );
}));

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Space.lg,
      paddingBottom: Space.sm,
    },
    headerTitle: {
      color: colors.text,
      fontSize: FontSize.lg,
      fontWeight: FontWeight.semibold as '600',
      marginLeft: Space.sm,
    },
    listHeader: {
      paddingHorizontal: Space.lg,
      paddingTop: Space.xs,
      paddingBottom: Space.md,
    },
    searchWrap: {
      marginHorizontal: -8,
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      borderRadius: Radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.inputBackground,
      paddingHorizontal: Space.md,
    },
    searchInput: {
      flex: 1,
      color: colors.text,
      fontSize: FontSize.base,
      paddingVertical: 10,
    },
    listContent: {
      paddingHorizontal: Space.lg,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingLeft: Space.sm,
      paddingTop: Space.sm,
      paddingBottom: Space.xs,
    },
    sectionHeaderSpaced: {
      marginTop: Space.md,
    },
    sectionHeaderText: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium as '500',
    },
    sectionHeaderCount: {
      color: colors.textSubtle,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.medium as '500',
    },
    skillRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
      paddingHorizontal: Space.sm,
      paddingVertical: Space.sm,
      borderRadius: Radius.lg,
    },
    skillRowPressed: {
      backgroundColor: colors.surfaceMuted,
    },
    skillIconWrap: {
      width: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    skillTextWrap: {
      flex: 1,
      gap: 2,
    },
    skillTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
    },
    skillTitle: {
      flex: 1,
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold as '600',
    },
    skillSubtitle: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      lineHeight: 18,
    },
    currentBadge: {
      paddingHorizontal: Space.sm,
      paddingVertical: 3,
      borderRadius: Radius.full,
      backgroundColor: colors.surfaceMuted,
    },
    currentBadgeText: {
      color: colors.primary,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold as '600',
    },
    selectionMarkWrap: {
      width: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stateWrap: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.sm,
      paddingHorizontal: Space.lg,
      paddingVertical: Space.xl,
    },
    stateText: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      textAlign: 'center',
    },
    retryBtn: {
      paddingHorizontal: Space.lg,
      paddingVertical: Space.sm,
      borderRadius: Radius.full,
      backgroundColor: colors.surfaceMuted,
    },
    retryText: {
      color: colors.primary,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold as '600',
    },
  });
}

const stylesShared = StyleSheet.create({
  skillAvatarWrap: {
    overflow: 'hidden',
    backgroundColor: PresentationColor.skillAvatarFallback,
  },
  skillAvatarImage: {
    ...StyleSheet.absoluteFillObject,
  },
  skillAvatarShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: PresentationColor.mediaScrimSoft,
  },
  skillAvatarOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
