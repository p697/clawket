import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  CalendarClock,
  Camera,
  FileText,
  Images,
  Puzzle,
  SlidersHorizontal,
  SquareSlash,
  type LucideIcon,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { isMacCatalyst } from '../../../utils/platform';
import { useAppTheme } from '../../../theme';
import {
  FontSize,
  FontWeight,
  HitSize,
  IconSize,
  LineHeight,
  Motion,
  Radius,
  Space,
} from '../../../theme/tokens';
import { Button } from '../../../components/ui/Button';
import { SheetHeaderButton } from '../../../components/ui/SheetHeaderButton';
import { Sheet } from '../../../components/ui/Sheet';
import { SettingsDivider, SettingsRow } from '../../../components/ui/SettingsGroup';
import { Skeleton } from '../../../components/ui/Skeleton';
import { triggerSelectionHaptic } from '../../../services/haptics';
import { useRecentPhotos, type RecentPhotosAccessState } from '../../../hooks/useRecentPhotos';
import { RECENT_PHOTO_STRIP_COUNT, type RecentPhoto } from '../../../services/recent-photos';
import {
  pruneOrderedSelection,
  resolveAddSheetMediaMode,
  resolveMediaStripTileSize,
  selectionOrdinal,
  toggleOrderedSelection,
} from './threadAddSheetSelection';

export type ThreadAddAction =
  | 'photo-library'
  | 'camera'
  | 'file'
  | 'recent-photos'
  | 'skills'
  | 'commands'
  | 'schedule'
  | 'tools'
  | 'recover-draft'
  | 'session-files';

export type ThreadAddSheetProps = Readonly<{
  visible: boolean;
  attachmentsEnabled: boolean;
  skillsEnabled: boolean;
  /** Free attachment slots; recent-photo selection is capped to this. */
  remainingAttachmentSlots?: number;
  onClose: () => void;
  onPickImage: () => void;
  onTakePhoto: () => void;
  onChooseFile?: () => void;
  onAttachRecentPhotos?: (uris: readonly string[]) => void | Promise<void>;
  onOpenSessionFiles?: () => void;
  onOpenSkills?: () => void;
  onOpenCommands?: () => void;
  onCreateScheduledTask?: () => void;
  onOpenTools?: () => void;
  onRecoverDraft?: () => void;
  /** Analytics hook: fires once per open after photo access is known. */
  onPresented?: (details: Readonly<{ photoAccess: RecentPhotosAccessState }>) => void;
  /** Analytics hook: fires when an action is chosen, with the photo count for recent picks. */
  onAction?: (action: ThreadAddAction, count?: number) => void;
}>;

/** Fixed detents: a tall resting sheet with bottom breathing room; the upper one lets long row lists scroll. */
export const THREAD_ADD_SHEET_SNAP_POINTS: string[] = ['62%', '92%'];
/** Matches the sheet header inset so tiles line up under the close button. */
const SHEET_HORIZONTAL_PADDING = Space.lg;
const MEDIA_GAP = Space.sm;
/** Row glyphs sit centered in a fixed box so the strip, tiles and rows share one left edge. */
const ROW_ICON_BOX = HitSize.sm;
const SKELETON_TILE_COUNT = 3;
const BADGE_SIZE = Space.xl;
const DEFAULT_REMAINING_SLOTS = 6;
const EASE_OUT = Easing.out(Easing.cubic);

export function ThreadAddSheet({
  visible,
  attachmentsEnabled,
  skillsEnabled,
  remainingAttachmentSlots = DEFAULT_REMAINING_SLOTS,
  onClose,
  onPickImage,
  onTakePhoto,
  onChooseFile,
  onAttachRecentPhotos,
  onOpenSessionFiles,
  onOpenSkills,
  onOpenCommands,
  onCreateScheduledTask,
  onOpenTools,
  onRecoverDraft,
  onPresented,
  onAction,
}: ThreadAddSheetProps): React.JSX.Element {
  const { t } = useTranslation(['chat', 'common']);
  const { theme } = useAppTheme();
  const { width: windowWidth } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [selected, setSelected] = useState<readonly string[]>([]);
  const footerProgress = useSharedValue(0);
  const pendingAction = useRef<(() => void) | null>(null);
  const presentedRef = useRef(false);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const recentPhotosEnabled = attachmentsEnabled && Boolean(onAttachRecentPhotos);
  // The host keeps the strip warm while the sheet is closed, so an open draws
  // its final layout on the first frame instead of swapping out a skeleton.
  const recent = useRecentPhotos({ active: visible && recentPhotosEnabled, prefetch: recentPhotosEnabled });
  const requestPhotoAccess = recent.request;
  // Not tied to `visible`: a dismissing sheet keeps its layout while it slides away.
  const photoAccess = recentPhotosEnabled ? recent.access : 'unavailable';
  const selectionLimit = Math.max(0, remainingAttachmentSlots);
  const attachmentActionsDisabled = !attachmentsEnabled || selectionLimit <= 0;

  const contentWidth = Math.max(0, windowWidth - SHEET_HORIZONTAL_PADDING * 2);
  const tileSize = useMemo(() => resolveMediaStripTileSize(contentWidth, MEDIA_GAP), [contentWidth]);
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);

  useEffect(() => {
    if (visible) return;
    setSelected([]);
    presentedRef.current = false;
  }, [visible]);

  useEffect(() => {
    if (!visible || presentedRef.current || photoAccess === 'checking') return;
    presentedRef.current = true;
    onPresented?.({ photoAccess });
  }, [onPresented, photoAccess, visible]);

  useEffect(() => {
    const allowed = new Set(recent.photos.map((photo) => photo.id));
    setSelected((current) => pruneOrderedSelection(current, allowed, selectionLimit));
  }, [recent.photos, selectionLimit]);

  // The attach footer rises once per selection and leaves with the selection;
  // a persistent shared value keeps later picks from replaying the rise.
  const hasSelection = selected.length > 0;
  useEffect(() => {
    footerProgress.value = hasSelection && !reduceMotion
      ? withTiming(1, { duration: Motion.duration.fast, easing: EASE_OUT })
      : hasSelection ? 1 : 0;
  }, [footerProgress, hasSelection, reduceMotion]);
  const footerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: footerProgress.value,
    transform: [{ translateY: (1 - footerProgress.value) * Space.md }],
  }));

  const run = useCallback((action: ThreadAddAction, callback: () => void, count?: number) => {
    // A closed sheet (e.g. session switch while the permission dialog was up)
    // never dismisses again, so queuing now would wedge every later action.
    if (!visibleRef.current || pendingAction.current) return;
    onAction?.(action, count);
    pendingAction.current = callback;
    onClose();
  }, [onAction, onClose]);

  const afterClose = useCallback(() => {
    const action = pendingAction.current;
    pendingAction.current = null;
    action?.();
  }, []);

  const requestPhotos = useCallback(() => {
    if (attachmentActionsDisabled) return;
    triggerSelectionHaptic();
    if (photoAccess === 'undetermined') {
      // iOS may present its limited-library selector after authorization resolves.
      // Remove our full-window overlay first and let that native flow finish;
      // reopening Add then reads the granted subset (or offers the system picker).
      run('photo-library', () => { void requestPhotoAccess(); });
      return;
    }
    run('photo-library', onPickImage);
  }, [attachmentActionsDisabled, onPickImage, photoAccess, requestPhotoAccess, run]);

  const togglePhoto = useCallback((photo: RecentPhoto) => {
    if (attachmentActionsDisabled) return;
    triggerSelectionHaptic();
    setSelected((current) => toggleOrderedSelection(current, photo.id, selectionLimit));
  }, [attachmentActionsDisabled, selectionLimit]);

  const attachSelected = useCallback(() => {
    if (selected.length === 0 || !onAttachRecentPhotos) return;
    const byId = new Map(recent.photos.map((photo) => [photo.id, photo.uri]));
    const uris = selected.map((id) => byId.get(id)).filter((uri): uri is string => Boolean(uri));
    run('recent-photos', () => { void onAttachRecentPhotos(uris); }, uris.length);
  }, [onAttachRecentPhotos, recent.photos, run, selected]);

  const stripPhotos = useMemo(() => recent.photos.slice(0, RECENT_PHOTO_STRIP_COUNT), [recent.photos]);
  const selectionFull = selected.length >= selectionLimit;

  const tiles: { key: string; title: string; icon: LucideIcon; onPress: () => void }[] = [];
  if (attachmentsEnabled) {
    tiles.push({ key: 'photo-library', title: t('Photos'), icon: Images, onPress: requestPhotos });
    if (!isMacCatalyst) {
      tiles.push({ key: 'camera', title: t('Camera'), icon: Camera, onPress: () => run('camera', onTakePhoto) });
    }
    if (onChooseFile) {
      tiles.push({ key: 'file', title: t('Files', { ns: 'common' }), icon: FileText, onPress: () => run('file', onChooseFile) });
    }
  }

  const mediaMode = resolveAddSheetMediaMode({
    recentPhotos: recentPhotosEnabled,
    access: photoAccess,
    photoCount: recent.photos.length,
    loading: recent.loading,
    tileCount: tiles.length,
  });
  const showsPhotoStrip = mediaMode === 'strip';
  // Photos on screen when the strip first draws rise with the sheet; only later
  // arrivals (a filled placeholder, a new capture) fade in.
  const stripShownRef = useRef(false);
  useEffect(() => {
    stripShownRef.current = visible && showsPhotoStrip;
  }, [showsPhotoStrip, visible]);

  const attachLabel = selected.length === 1
    ? t('Attach 1 photo')
    : t('Attach {{count}} photos', { count: selected.length });
  const lateFadeIn = reduceMotion || !stripShownRef.current ? undefined : FadeIn.duration(Motion.duration.fast);

  const renderPhotoTile = (photo: RecentPhoto) => {
    const ordinal = selectionOrdinal(selected, photo.id);
    const isSelected = ordinal !== null;
    const disabled = attachmentActionsDisabled || (!isSelected && selectionFull);
    return (
      <Animated.View key={photo.id} entering={lateFadeIn}>
        <Pressable
          testID={`thread-add-photo-${photo.id}`}
          accessibilityRole="button"
          accessibilityState={{ selected: isSelected, disabled }}
          accessibilityLabel={isSelected
            ? t('Photo, selected {{count}}', { count: ordinal })
            : t('Photo')}
          disabled={disabled}
          onPress={() => togglePhoto(photo)}
          style={({ pressed }) => [
            styles.photoTile,
            { width: tileSize, height: tileSize },
            pressed ? styles.tilePressed : null,
            disabled && !isSelected ? styles.tileDimmed : null,
          ]}
        >
          <Image source={{ uri: photo.uri }} style={[styles.photoImage, isSelected ? styles.photoImageSelected : null]} />
          {isSelected ? (
            <View testID={`thread-add-photo-${photo.id}-ordinal`} style={styles.ordinalBadge}>
              <Text style={styles.ordinalText}>{ordinal}</Text>
            </View>
          ) : null}
        </Pressable>
      </Animated.View>
    );
  };

  const skeletonTiles = (count: number) => Array.from({ length: count }).map((_, index) => (
    <Skeleton key={index} style={[styles.skeletonTile, { width: tileSize, height: tileSize }]} />
  ));

  const mediaSection = mediaMode === 'skeleton' ? (
    <View testID="thread-add-media-skeleton" style={styles.strip}>
      {skeletonTiles(SKELETON_TILE_COUNT + 1)}
    </View>
  ) : mediaMode === 'strip' ? (
    <View testID="thread-add-media-strip">
      <GestureScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.stripScroll}
        contentContainerStyle={styles.stripContent}
      >
        {!isMacCatalyst ? (
          <ActionTile
            testID="thread-add-camera"
            title={t('Camera')}
            icon={Camera}
            size={tileSize}
            disabled={attachmentActionsDisabled}
            onPress={() => run('camera', onTakePhoto)}
            styles={styles}
            colors={theme.colors}
          />
        ) : null}
        {stripPhotos.length > 0 ? stripPhotos.map(renderPhotoTile) : skeletonTiles(SKELETON_TILE_COUNT)}
      </GestureScrollView>
    </View>
  ) : mediaMode === 'tiles' ? (
    <View testID="thread-add-tiles" style={styles.tiles}>
      {tiles.map(({ key, title, icon, onPress }) => (
        <ActionTile
          key={key}
          testID={`thread-add-${key}`}
          title={title}
          icon={icon}
          size={tileSize}
          grow
          disabled={attachmentActionsDisabled}
          onPress={onPress}
          styles={styles}
          colors={theme.colors}
        />
      ))}
    </View>
  ) : null;

  const menuRow = (
    key: string,
    action: ThreadAddAction,
    title: string,
    icon: LucideIcon,
    callback: () => void,
    disabled = false,
  ) => (
    <SettingsRow
      key={key}
      testID={`thread-add-${key}`}
      title={title}
      disabled={disabled}
      showChevron
      leading={<RowIcon icon={icon} color={theme.colors.ink} styles={styles} />}
      onPress={() => run(action, callback)}
      style={styles.menuRow}
    />
  );

  const composeRows = [
    onRecoverDraft ? menuRow('recover-draft', 'recover-draft', t('Recover draft'), FileText, onRecoverDraft) : null,
    showsPhotoStrip && onChooseFile
      ? menuRow('file', 'file', t('Choose File'), FileText, onChooseFile, attachmentActionsDisabled)
      : null,
    skillsEnabled && onOpenSkills ? menuRow('skills', 'skills', t('Skills', { ns: 'common' }), Puzzle, onOpenSkills) : null,
    onOpenCommands ? menuRow('commands', 'commands', t('Commands'), SquareSlash, onOpenCommands) : null,
  ].filter(Boolean);

  const agentRows = [
    onOpenSessionFiles ? menuRow('session-files', 'session-files', t('Session files'), FileText, onOpenSessionFiles) : null,
    onCreateScheduledTask ? menuRow('schedule', 'schedule', t('Schedule a task'), CalendarClock, onCreateScheduledTask) : null,
    onOpenTools ? menuRow('tools', 'tools', t('Tools'), SlidersHorizontal, onOpenTools) : null,
  ].filter(Boolean);

  // Sheet pins this to the visible bottom edge at both detents; an inline
  // footer would sit below the fold at 62% because the body is laid out for 92%.
  const footer = hasSelection ? (
    <Animated.View testID="thread-add-attach-footer" style={footerAnimatedStyle}>
      <Button
        testID="thread-add-attach-selected"
        label={attachLabel}
        disabled={attachmentActionsDisabled}
        onPress={attachSelected}
      />
    </Animated.View>
  ) : undefined;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      onAfterClose={afterClose}
      closeAccessibilityLabel={t('Close', { ns: 'common' })}
      title={t('Add', { ns: 'common' })}
      footer={footer}
      headerRight={showsPhotoStrip ? (
        <SheetHeaderButton
          testID="thread-add-all-photos"
          icon={Images}
          accessibilityLabel={t('All photos')}
          disabled={attachmentActionsDisabled}
          onPress={() => run('photo-library', onPickImage)}
        />
      ) : undefined}
      snapPoints={THREAD_ADD_SHEET_SNAP_POINTS}
      testID="thread-add-sheet"
    >
      <BottomSheetScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {mediaSection}
        {mediaSection && composeRows.length > 0 ? <SettingsDivider inset="none" /> : null}
        {composeRows.length > 0 ? <View>{composeRows}</View> : null}
        {(mediaSection || composeRows.length > 0) && agentRows.length > 0 ? <SettingsDivider inset="none" /> : null}
        {agentRows.length > 0 ? <View>{agentRows}</View> : null}
      </BottomSheetScrollView>
    </Sheet>
  );
}

type SheetStyles = ReturnType<typeof createStyles>;
type SheetColors = ReturnType<typeof useAppTheme>['theme']['colors'];

function RowIcon({ icon: Icon, color, styles }: { icon: LucideIcon; color: string; styles: SheetStyles }): React.JSX.Element {
  return (
    <View style={styles.rowIcon}>
      <Icon size={IconSize.md} color={color} strokeWidth={2} />
    </View>
  );
}

/** Square surface tile: a fixed strip tile, or a flexible one in the three-up row. */
function ActionTile({
  testID,
  title,
  icon: Icon,
  size,
  grow = false,
  disabled,
  onPress,
  styles,
  colors,
}: Readonly<{
  testID: string;
  title: string;
  icon: LucideIcon;
  size: number;
  grow?: boolean;
  disabled: boolean;
  onPress: () => void;
  styles: SheetStyles;
  colors: SheetColors;
}>): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionTile,
        grow ? { flex: 1, height: size } : { width: size, height: size },
        { backgroundColor: pressed ? colors.surfaceFloating : colors.surface },
        disabled ? styles.tileDimmed : null,
      ]}
    >
      <Icon size={IconSize.lg} color={colors.ink} strokeWidth={2} />
      <Text style={[styles.tileLabel, { color: colors.ink }]} numberOfLines={1}>{title}</Text>
    </Pressable>
  );
}

function createStyles(colors: SheetColors) {
  return StyleSheet.create({
    content: {
      paddingHorizontal: SHEET_HORIZONTAL_PADDING,
      paddingBottom: Space.xxl,
      gap: Space.sm,
    },
    // YouMind-style rows with a touch more air (owner, 2026-09-12): 48-point pitch.
    menuRow: {
      minHeight: HitSize.lg,
      paddingHorizontal: 0,
      paddingVertical: Space.xs,
      gap: Space.sm,
    },
    rowIcon: {
      width: ROW_ICON_BOX,
      height: ROW_ICON_BOX,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tiles: { flexDirection: 'row', gap: MEDIA_GAP },
    actionTile: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Space.sm,
      gap: Space.xs,
      borderRadius: Radius.card,
    },
    tileLabel: {
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
      textAlign: 'center',
    },
    tilePressed: { opacity: 0.7 },
    tileDimmed: { opacity: 0.48 },
    strip: { flexDirection: 'row', gap: MEDIA_GAP, overflow: 'hidden' },
    stripScroll: { marginHorizontal: -SHEET_HORIZONTAL_PADDING },
    stripContent: { gap: MEDIA_GAP, paddingHorizontal: SHEET_HORIZONTAL_PADDING },
    skeletonTile: { borderRadius: Radius.card },
    photoTile: {
      borderRadius: Radius.card,
      overflow: 'hidden',
      backgroundColor: colors.surface,
    },
    photoImage: { width: '100%', height: '100%' },
    photoImageSelected: { transform: [{ scale: 0.92 }], borderRadius: Radius.card },
    ordinalBadge: {
      position: 'absolute',
      top: Space.sm,
      right: Space.sm,
      width: BADGE_SIZE,
      height: BADGE_SIZE,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },
    ordinalText: {
      color: colors.onAccent,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.semibold,
      fontVariant: ['tabular-nums'],
    },
  });
}
