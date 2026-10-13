import { ImageZoom, type ImageZoomRef } from '@likashefqet/react-native-image-zoom';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, I18nManager, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Metrics } from 'react-native-safe-area-context';
import { Gesture, GestureDetector, gestureHandlerRootHOC } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  makeMutable,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Check, Copy, Download, ZoomIn, X } from 'lucide-react-native';
import { useLightStatusBarBeforeModal } from '../../hooks/useLightStatusBarBeforeModal';
import { copyImageToClipboard } from '../../services/image-clipboard';
import { saveImageUriToPhotoLibrary } from '../../services/photo-library';
import { useAppTheme } from '../../theme';
import { BorderWidth, ControlSize, FontSize, FontWeight, IconSize, LineHeight, PresentationColor, Radius, Space } from '../../theme/tokens';
import { FloatingButton, SettingsGroup, SettingsRow, Sheet } from '../ui';
import { PresentationSafeAreaProvider } from '../ui/PresentationSafeAreaProvider';

type Props = {
  visible: boolean;
  uris: string[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
};

const OPEN_SHIFT = 20;
const CLOSE_SHIFT = 96;
const SWIPE_PAGE_RATIO = 0.18;
const SWIPE_CLOSE_RATIO = 0.16;
const SWIPE_VELOCITY_THRESHOLD = 1100;
const PAGE_VELOCITY_THRESHOLD = 720;
const DIRECTION_LOCK_DISTANCE = 10;
const DIRECTION_LOCK_RATIO = 1.15;

function applyEdgeResistance(value: number, min: number, max: number) {
  'worklet';

  if (value < min) {
    return min - (min - value) * 0.35;
  }
  if (value > max) {
    return max + (value - max) * 0.35;
  }
  return value;
}

function clampIndex(index: number, count: number) {
  'worklet';

  return Math.max(0, Math.min(index, Math.max(0, count - 1)));
}

function PreviewZoomImage({
  uri,
  width,
  height,
  scale,
  zoomRef,
}: {
  uri: string;
  width: number;
  height: number;
  scale: SharedValue<number>;
  zoomRef: (value: ImageZoomRef | null) => void;
}) {
  return (
    <ImageZoom
      ref={zoomRef}
      uri={uri}
      minScale={1}
      maxScale={4}
      scale={scale}
      doubleTapScale={2.2}
      isDoubleTapEnabled
      style={{ flex: 0, width, height }}
      resizeMode="contain"
    />
  );
}

const ModalGestureRoot = gestureHandlerRootHOC(function ModalGestureRoot({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
});

export function ImagePreviewModal({
  visible,
  uris,
  index,
  onClose,
  onIndexChange,
}: Props): React.JSX.Element {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const screenWidth = metrics?.frame.width ?? 0;
  const screenHeight = metrics?.frame.height ?? 0;
  const insetsTop = metrics?.insets.top ?? 0;
  const insetsBottom = metrics?.insets.bottom ?? 0;
  const horizontalEdges = {
    start: (I18nManager.isRTL ? metrics?.insets.right : metrics?.insets.left) ?? 0,
    end: (I18nManager.isRTL ? metrics?.insets.left : metrics?.insets.right) ?? 0,
  };
  const hasMetrics = metrics !== null;
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const imageHeight = Math.max(ControlSize.floatingButton, screenHeight - insetsTop - insetsBottom
    - 2 * (ControlSize.floatingButton + Space.xl));
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const closeRequestedRef = useRef(false);
  const [imageActionsIndex, setImageActionsIndex] = useState<number | null>(null);
  const zoomRefs = useRef<Array<ImageZoomRef | null>>([]);
  const actionGeneration = useRef(0);
  const actionLock = useRef<symbol | null>(null);
  const [action, setAction] = useState<{ kind: 'copy' | 'save'; status: 'busy' | 'done' } | null>(null);
  useEffect(() => {
    actionGeneration.current++;
    actionLock.current = null;
    setAction(null);
    return () => { actionGeneration.current++; };
  }, [visible, index, uris]);
  useEffect(() => {
    if (action?.status !== 'done') return;
    const timer = setTimeout(() => setAction(null), 2400);
    return () => clearTimeout(timer);
  }, [action]);
  // The black viewer otherwise keeps the app's dark status bar icons on Android (invisible clock).
  const statusBarReady = useLightStatusBarBeforeModal(visible);

  const scales = useMemo(
    () => uris.map(() => makeMutable(1)),
    [uris],
  );

  const currentIndex = useSharedValue(index);
  const pageTranslateX = useSharedValue(-index * screenWidth);
  const dismissTranslateY = useSharedValue(OPEN_SHIFT);
  const overlayProgress = useSharedValue(0);
  const gestureMode = useSharedValue<0 | 1 | 2>(0);
  const gestureStartPageX = useSharedValue(0);
  const closing = useSharedValue(false);
  const geometryKey = `${screenWidth}:${screenHeight}`;
  const activeGeometry = useSharedValue(geometryKey);
  const geometryGeneration = useSharedValue(0);
  const gestureGeneration = useSharedValue(-1);
  const viewportWidth = useSharedValue(screenWidth);
  const gestureGeometry = useSharedValue(geometryKey);

  // A resized viewport keeps the selected image but invalidates an unfinished drag,
  // including a fold/unfold cycle that returns to the same dimensions.
  useLayoutEffect(() => {
    activeGeometry.value = geometryKey;
    geometryGeneration.value += 1;
    viewportWidth.value = screenWidth;
    gestureMode.value = 0;
    cancelAnimation(pageTranslateX);
    pageTranslateX.value = -currentIndex.value * screenWidth;
    if (!closing.value) {
      cancelAnimation(dismissTranslateY);
      dismissTranslateY.value = 0;
    }
  }, [activeGeometry, closing, currentIndex, dismissTranslateY, geometryGeneration, geometryKey, gestureMode, pageTranslateX, screenWidth, viewportWidth]);

  useEffect(() => {
    closeRequestedRef.current = false;
    if (!visible) {
      setImageActionsIndex(null);
      setMetrics(null);
    }
  }, [visible, uris]);

  useEffect(() => {
    currentIndex.value = index;
    pageTranslateX.value = withSpring(-index * viewportWidth.value, {
      damping: 18,
      stiffness: 210,
      mass: 0.35,
    });
  }, [currentIndex, index, pageTranslateX, viewportWidth]);

  useEffect(() => {
    if (!visible) {
      closing.value = false;
      overlayProgress.value = 0;
      dismissTranslateY.value = 0;
      return;
    }

    // Resize updates the existing viewer; only a newly measured presentation enters.
    if (!hasMetrics || closing.value) return;
    dismissTranslateY.value = OPEN_SHIFT;
    overlayProgress.value = 0;
    pageTranslateX.value = -index * screenWidth;

    overlayProgress.value = withTiming(1, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
    });
    dismissTranslateY.value = withSpring(0, {
      damping: 17,
      stiffness: 180,
      mass: 0.4,
    });
  }, [closing, dismissTranslateY, hasMetrics, overlayProgress, pageTranslateX, visible]);

  const finishClose = useCallback(() => {
    if (closeRequestedRef.current) {
      return;
    }
    closeRequestedRef.current = true;
    onClose();
  }, [onClose]);

  const animateClose = useCallback(() => {
    if (closing.value) return;
    closing.value = true;
    if (!hasMetrics) { finishClose(); return; }
    overlayProgress.value = withTiming(0, {
      duration: 150,
      easing: Easing.out(Easing.quad),
    });
    dismissTranslateY.value = withTiming(
      Math.max(screenHeight * 0.2, CLOSE_SHIFT),
      {
        duration: 170,
        easing: Easing.out(Easing.quad),
      },
      (finished) => {
        if (finished) {
          runOnJS(finishClose)();
        }
      },
    );
  }, [closing, dismissTranslateY, finishClose, hasMetrics, overlayProgress, screenHeight]);

  const setPageIndex = useCallback(
    (nextIndex: number) => {
      onIndexChange(nextIndex);
    },
    [onIndexChange],
  );

  const handleImageAction = useCallback(async (kind: 'copy' | 'save', targetIndex: number) => {
    const uri = uris[targetIndex];
    if (!uri || actionLock.current) return;
    const token = Symbol();
    const generation = actionGeneration.current;
    actionLock.current = token;
    setAction({ kind, status: 'busy' });
    try {
      if (kind === 'copy') await copyImageToClipboard(uri);
      else {
        const result = await saveImageUriToPhotoLibrary(uri, 'chat-image');
        if (generation !== actionGeneration.current) return;
        if (result === 'permission_denied') {
          setAction(null);
          Alert.alert(t('Permission denied'));
          return;
        }
      }
      if (generation === actionGeneration.current) setAction({ kind, status: 'done' });
    } catch {
      if (generation === actionGeneration.current) {
        setAction(null);
        Alert.alert(t(kind === 'copy' ? 'Copy failed' : 'Failed to save'));
      }
    } finally {
      if (actionLock.current === token) actionLock.current = null;
    }
  }, [t, uris]);

  const showImageActions = useCallback((targetIndex: number) => {
    setImageActionsIndex(targetIndex);
  }, []);

  const saveSelectedImage = useCallback(() => {
    if (imageActionsIndex == null) return;
    const targetIndex = imageActionsIndex;
    setImageActionsIndex(null);
    void handleImageAction('save', targetIndex);
  }, [handleImageAction, imageActionsIndex]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .onTouchesDown((_, manager) => {
          const currentScale = scales[currentIndex.value]?.value ?? 1;
          if (!uris.length || closing.value || currentScale > 1.02) {
            manager.fail();
          }
        })
        .onStart(() => {
          gestureGeometry.value = geometryKey;
          gestureGeneration.value = geometryGeneration.value;
          gestureMode.value = 0;
          gestureStartPageX.value = pageTranslateX.value;
        })
        .onUpdate((event) => {
          if (!uris.length || closing.value || gestureGeneration.value !== geometryGeneration.value || gestureGeometry.value !== activeGeometry.value || activeGeometry.value !== geometryKey) {
            return;
          }

          const currentScale = scales[currentIndex.value]?.value ?? 1;
          if (currentScale > 1.02) {
            return;
          }

          const absX = Math.abs(event.translationX);
          const absY = Math.abs(event.translationY);

          if (gestureMode.value === 0) {
            if (
              event.translationY > 0 &&
              absY > DIRECTION_LOCK_DISTANCE &&
              absY > absX * DIRECTION_LOCK_RATIO
            ) {
              gestureMode.value = 1;
            } else if (
              absX > DIRECTION_LOCK_DISTANCE &&
              absX > absY * DIRECTION_LOCK_RATIO
            ) {
              gestureMode.value = 2;
            } else {
              return;
            }
          }

          if (gestureMode.value === 1) {
            dismissTranslateY.value = Math.max(0, event.translationY);
            return;
          }

          const minTranslateX = -(uris.length - 1) * screenWidth;
          const nextTranslateX = gestureStartPageX.value + event.translationX;
          pageTranslateX.value = applyEdgeResistance(nextTranslateX, minTranslateX, 0);
        })
        .onEnd((event) => {
          if (!uris.length || closing.value || gestureGeneration.value !== geometryGeneration.value || gestureGeometry.value !== activeGeometry.value || activeGeometry.value !== geometryKey) {
            return;
          }

          const currentScale = scales[currentIndex.value]?.value ?? 1;
          const activeIndex = currentIndex.value;
          const closeDistance = Math.max(screenHeight * SWIPE_CLOSE_RATIO, 110);

          if (gestureMode.value === 1 && currentScale <= 1.02) {
            if (
              dismissTranslateY.value >= closeDistance ||
              event.velocityY >= SWIPE_VELOCITY_THRESHOLD
            ) {
              closing.value = true;
              overlayProgress.value = withTiming(0, {
                duration: 140,
                easing: Easing.out(Easing.quad),
              });
              dismissTranslateY.value = withTiming(
                Math.max(screenHeight * 0.2, CLOSE_SHIFT),
                {
                  duration: 170,
                  easing: Easing.out(Easing.quad),
                },
                (finished) => {
                  if (finished) {
                    runOnJS(finishClose)();
                  }
                },
              );
              gestureMode.value = 0;
              return;
            }

            dismissTranslateY.value = withSpring(0, {
              damping: 18,
              stiffness: 220,
              mass: 0.4,
            });
            gestureMode.value = 0;
            return;
          }

          if (gestureMode.value === 2 && currentScale <= 1.02) {
            let nextIndex = activeIndex;
            const pageThreshold = screenWidth * SWIPE_PAGE_RATIO;

            if (
              event.translationX <= -pageThreshold ||
              event.velocityX <= -PAGE_VELOCITY_THRESHOLD
            ) {
              nextIndex = clampIndex(activeIndex + 1, uris.length);
            } else if (
              event.translationX >= pageThreshold ||
              event.velocityX >= PAGE_VELOCITY_THRESHOLD
            ) {
              nextIndex = clampIndex(activeIndex - 1, uris.length);
            }

            currentIndex.value = nextIndex;
            pageTranslateX.value = withSpring(-nextIndex * screenWidth, {
              damping: 18,
              stiffness: 220,
              mass: 0.38,
            });
            if (nextIndex !== activeIndex) {
              runOnJS(setPageIndex)(nextIndex);
            }
          }

          gestureMode.value = 0;
        })
        .onFinalize(() => {
          if (closing.value || gestureGeneration.value !== geometryGeneration.value || gestureGeometry.value !== activeGeometry.value || activeGeometry.value !== geometryKey) return;
          if (gestureMode.value === 1) {
            dismissTranslateY.value = withSpring(0, {
              damping: 18,
              stiffness: 220,
              mass: 0.4,
            });
          }
          gestureMode.value = 0;
        }),
    [
      activeGeometry,
      closing,
      geometryKey,
      geometryGeneration,
      gestureGeneration,
      gestureGeometry,
      currentIndex,
      dismissTranslateY,
      finishClose,
      gestureMode,
      gestureStartPageX,
      overlayProgress,
      pageTranslateX,
      scales,
      screenHeight,
      screenWidth,
      setPageIndex,
      uris.length,
    ],
  );

  const longPressGesture = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(550)
        .maxDistance(18)
        .onStart(() => {
          if (!uris.length) return;
          runOnJS(showImageActions)(currentIndex.value);
        }),
    [currentIndex, showImageActions, uris.length],
  );

  const overlayAnimatedStyle = useAnimatedStyle(() => {
    const dismissFactor = interpolate(
      dismissTranslateY.value,
      [0, screenHeight * 0.28],
      [1, 0.38],
      'clamp',
    );

    return {
      opacity: overlayProgress.value * dismissFactor,
    };
  });

  const contentAnimatedStyle = useAnimatedStyle(() => {
    const scaleDown = interpolate(
      dismissTranslateY.value,
      [0, screenHeight * 0.28],
      [1, 0.92],
      'clamp',
    );

    return {
      transform: [
        { translateY: dismissTranslateY.value },
        { scale: scaleDown },
      ],
    };
  });

  const pagesAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pageTranslateX.value }],
  }));

  const closeButtonAnimatedStyle = useAnimatedStyle(() => ({
    opacity: overlayProgress.value,
    transform: [
      {
        translateY: interpolate(overlayProgress.value, [0, 1], [-8, 0], 'clamp'),
      },
    ],
  }));

  if (!visible || !statusBarReady) {
    return <></>;
  }

  return (
    <>
      <Modal testID="image-preview-modal" visible={visible} animationType="none" transparent onRequestClose={animateClose}>
        <PresentationSafeAreaProvider onMetrics={setMetrics} style={{ backgroundColor: PresentationColor.cameraBackground }}>
        {hasMetrics ? <ModalGestureRoot>
          <Animated.View style={[styles.previewOverlay, overlayAnimatedStyle]}>
          <View pointerEvents="none" style={[styles.statusBarScrim, { height: insetsTop }]} />
          <Animated.View testID="image-preview-chrome" style={[styles.previewClose, { top: insetsTop + Space.md, start: horizontalEdges.start + Space.lg, end: horizontalEdges.end + Space.lg }, closeButtonAnimatedStyle]}>
            <View style={styles.actionBar}>
              {(['copy', 'save'] as const).map(kind => {
                const Icon = action?.kind === kind && action.status === 'done' ? Check : kind === 'copy' ? Copy : Download;
                const label = kind === 'copy' ? t('Copy image') : t('Save to Photos');
                return <Pressable key={kind} testID={`image-preview-${kind}`} accessibilityRole="button" accessibilityLabel={label}
                  accessibilityState={{ disabled: action?.status === 'busy', busy: action?.kind === kind && action.status === 'busy' }}
                  disabled={action?.status === 'busy'} onPress={() => { void handleImageAction(kind, index); }}
                  style={({ pressed }) => [styles.imageAction, styles.previewCloseButton, { opacity: pressed ? 0.7 : 1 }]}>
                  {action?.kind === kind && action.status === 'busy' ? <ActivityIndicator color={PresentationColor.onMedia} /> : <Icon size={IconSize.sm} color={PresentationColor.onMedia} />}
                  <Text style={styles.imageActionText}>{kind === 'copy' ? t('Copy', { ns: 'common' }) : t('Save to Photos')}</Text>
                </Pressable>;
              })}
            </View>
            <FloatingButton
              testID="image-preview-close"
              icon={X}
              onPress={animateClose}
              accessibilityLabel={t('Close', { ns: 'common' })}
              appearance="quiet"
              iconSize={20}
              iconColor={PresentationColor.onMedia}
              strokeWidth={2.2}
              style={styles.previewCloseButton}
            />
          </Animated.View>

          <GestureDetector gesture={Gesture.Simultaneous(panGesture, longPressGesture)}>
            <Animated.View testID="image-preview-viewport" style={[styles.gestureSurface, contentAnimatedStyle]}>
              <Animated.View
                testID="image-preview-pages"
                style={[
                  styles.pageRow,
                  { width: Math.max(uris.length, 1) * screenWidth },
                  pagesAnimatedStyle,
                ]}
              >
                {uris.map((uri, itemIndex) => (
                  <View
                    key={`${uri}_${itemIndex}`}
                    style={[
                      styles.page,
                      { width: screenWidth, height: screenHeight },
                    ]}
                  >
                    <PreviewZoomImage
                      uri={uri}
                      width={screenWidth}
                      height={imageHeight}
                      scale={scales[itemIndex]}
                      zoomRef={value => { zoomRefs.current[itemIndex] = value; }}
                    />
                  </View>
                ))}
              </Animated.View>
            </Animated.View>
          </GestureDetector>

          <View testID="image-preview-footer" style={[styles.viewerFooter, { bottom: Math.max(insetsBottom, Space.lg), start: horizontalEdges.start + Space.lg, end: horizontalEdges.end + Space.lg }]}>
            <Pressable testID="image-preview-zoom" accessibilityRole="button" accessibilityLabel={t('Zoom image')}
              onPress={() => {
                const zoom = zoomRefs.current[index];
                if ((scales[index]?.value ?? 1) > 1.02) zoom?.reset();
                else zoom?.zoom({ x: screenWidth / 2, y: imageHeight / 2, scale: 2.2 });
              }} style={[styles.zoomHint, styles.previewCloseButton]}>
              <ZoomIn size={IconSize.sm} color={PresentationColor.onMedia} />
              <Text style={styles.imageActionText}>{t('Double-tap or pinch to zoom')}</Text>
            </Pressable>
            {action?.status === 'done' ? <Text accessibilityLiveRegion="polite" style={styles.feedback}>
              {action.kind === 'copy' ? t('Copied') : t('Saved to Photos!')}
            </Text> : null}
          </View>
          {uris.length > 1 ? (
            <View style={{ position: 'absolute', alignItems: 'center', start: horizontalEdges.start + Space.lg, end: horizontalEdges.end + Space.lg, bottom: Math.max(insetsBottom, Space.lg) + ControlSize.floatingButton + Space.md }}>
              <Text style={styles.previewPager}>{index + 1} / {uris.length}</Text>
            </View>
          ) : null}
          </Animated.View>
        </ModalGestureRoot> : null}
        </PresentationSafeAreaProvider>
      </Modal>
      <Sheet
        visible={imageActionsIndex != null}
        onClose={() => setImageActionsIndex(null)}
        closeAccessibilityLabel={t('Close', { ns: 'common' })}
        title={t('Image options')}
        maxHeight="45%"
        testID="image-options-sheet"
      >
        <SettingsGroup chrome="plain" style={styles.imageOptions}>
          <SettingsRow
            testID="image-options-save"
            title={t('Save to Photos')}
            leading={(
              <Download
                size={IconSize.md}
                color={theme.colors.inkSecondary}
                strokeWidth={2}
              />
            )}
            onPress={saveSelectedImage}
          />
        </SettingsGroup>
      </Sheet>
    </>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    previewOverlay: {
      flex: 1,
      backgroundColor: PresentationColor.cameraBackground,
    },
    previewClose: {
      position: 'absolute',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: Space.sm,
      zIndex: 10,
    },
    statusBarScrim: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 9, backgroundColor: PresentationColor.mediaOverlayStrong },
    actionBar: { flexDirection: 'row', gap: Space.sm, flexShrink: 1 },
    imageAction: { minHeight: ControlSize.floatingButton, borderRadius: Radius.full, paddingHorizontal: Space.md,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.sm, flexShrink: 1 },
    imageActionText: { color: PresentationColor.onMedia, fontSize: FontSize.caption, lineHeight: LineHeight.caption, fontWeight: FontWeight.semibold, flexShrink: 1 },
    viewerFooter: { position: 'absolute', alignItems: 'center', gap: Space.sm },
    zoomHint: { minHeight: ControlSize.floatingButton, paddingHorizontal: Space.lg, borderRadius: Radius.full, flexDirection: 'row', alignItems: 'center', gap: Space.sm },
    feedback: { backgroundColor: PresentationColor.mediaOverlayStrong, borderRadius: Radius.full, paddingHorizontal: Space.md, paddingVertical: Space.xs, color: PresentationColor.onMedia, fontSize: FontSize.caption, lineHeight: LineHeight.caption },
    // A 15% white disc vanished over white screenshots (device review 2026-09-27); a dark
    // translucent disc with a light hairline stays visible over any photo.
    previewCloseButton: {
      backgroundColor: PresentationColor.mediaOverlayStrong,
      borderWidth: BorderWidth.hairline,
      borderColor: PresentationColor.onMediaBorder,
    },
    gestureSurface: {
      direction: 'ltr',
      flex: 1,
      overflow: 'hidden',
    },
    pageRow: {
      direction: 'ltr',
      flex: 1,
      flexDirection: 'row',
    },
    page: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    // A list sheet: the plain row sits on the 16-point body inset, like Commands.
    imageOptions: {
      paddingHorizontal: Space.lg,
      paddingBottom: Space.lg,
    },
    previewPager: {
      textAlign: 'center',
      color: PresentationColor.onMedia,
      fontSize: FontSize.caption,
      backgroundColor: PresentationColor.mediaControl,
      paddingHorizontal: 10,
      paddingVertical: Space.xs,
      borderRadius: Radius.full,
    },
  });
}
