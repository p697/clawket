import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { COMPACT_SCENE_POOL, rollScene, SCENE_POOL, type CompanionSceneKey } from '../../brand/companion-scenes';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, LineHeight, Motion, Space } from '../../theme/tokens';
import { Button } from './Button';
import { Companion, type CompanionPose } from './Companion';
import { CompanionScene, type CompanionScenePhase } from './companion/CompanionScene';

/** `page` fills a screen that has nothing else to show; `compact` sits inside a sheet or card. */
export type LoadingStateSize = 'page' | 'compact';

const COMPACT_COMPANION = 48;
const EXIT = { duration: Motion.duration.normal } as const;
/** The loader settles back a touch as it fades, so the exit reads as stepping aside. */
const EXIT_SCALE = 0.96;

// Across mounts too, the next wait never replays the scene the previous one showed.
const lastScene: Record<LoadingStateSize, CompanionSceneKey | null> = { page: null, compact: null };

/** Draws the next scene for a wait of this size, never the one the previous wait showed. */
export function drawLoadingScene(size: LoadingStateSize): CompanionSceneKey {
  const scene = rollScene(size === 'compact' ? COMPACT_SCENE_POOL : SCENE_POOL, lastScene[size]);
  lastScene[size] = scene;
  return scene;
}

type Props = {
  message?: string;
  /** Pose of the still Companion shown when the system asks for reduced motion. */
  pose?: CompanionPose;
  size?: LoadingStateSize;
  /** `ready` is the success exit: the label goes, the cat smiles and the loader fades; see `useLoadingHandoff`. */
  phase?: CompanionScenePhase;
  /** Pins one scene (design gallery); otherwise each wait draws from the weighted pool. */
  scene?: CompanionSceneKey;
  /** After `Motion.loadingSlowHint` the wait explains itself and offers this one action. */
  slowAction?: Readonly<{ label: string; onPress: () => void }>;
  /** Offered under the label from the start, such as a manual reconnect beside the automatic one. */
  action?: Readonly<{ label: string; onPress: () => void }>;
  /** The label is the page's headline (the onboarding connecting stage): title size, semibold. */
  headline?: boolean;
  testID?: string;
};

/**
 * The one waiting surface for content without a known layout (lists use `ListSkeleton`).
 * Owner decision 2026-09-27: every wait draws one of five Companion scenes (Pounce is the rare one) and
 * the cat reacts to taps. A wait that really ends in success exits at once: the label disappears and the
 * smiling cat fades within `Motion.duration.normal`, never lingering over the content (owner feedback
 * 2026-09-27). It stays invisible for `Motion.loadingGrace` so fast loads never flash the Companion, while
 * the busy state and its label are exposed to assistive technology immediately.
 */
export function LoadingState({ message, pose = 'loading', size = 'page', phase = 'wait', scene: pinned, slowAction, action, headline = false, testID }: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('common');
  const reducedMotion = useReducedMotion();
  const compact = size === 'compact';
  const opacity = useSharedValue(0);
  const scale = useSharedValue(1);
  const [drawn, setDrawn] = useState<CompanionSceneKey>(() => pinned ?? drawLoadingScene(size));
  const scene = pinned ?? drawn;
  // A wait that starts again right after a success exit is a new wait: a fresh scene behind the grace period.
  const [round, setRound] = useState(0);
  const previousPhase = useRef(phase);
  useEffect(() => {
    const resumed = previousPhase.current === 'ready' && phase === 'wait';
    previousPhase.current = phase;
    if (phase === 'ready') {
      opacity.value = withTiming(0, EXIT);
      // Reduced motion keeps the plain fade.
      if (!reducedMotion) scale.value = withTiming(EXIT_SCALE, EXIT);
      return;
    }
    if (resumed) {
      if (!pinned) setDrawn(drawLoadingScene(size));
      setRound((count) => count + 1);
    }
    scale.value = 1;
    opacity.value = withDelay(Motion.loadingGrace, withTiming(1, { duration: Motion.duration.normal }));
  }, [opacity, phase, pinned, reducedMotion, scale, size]);
  const appear = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));
  // A long wait gets bored of its scene and plays another one.
  const sceneOpacity = useSharedValue(1);
  const rotateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (phase !== 'wait') return undefined;
    // A rotation cut short (by a success exit or a re-run) must not leave the next wait's scene hidden.
    sceneOpacity.value = 1;
    if (pinned || reducedMotion) return undefined;
    const interval = setInterval(() => {
      sceneOpacity.value = withTiming(0, { duration: Motion.duration.fast });
      rotateTimer.current = setTimeout(() => {
        setDrawn(drawLoadingScene(size));
        sceneOpacity.value = withTiming(1, { duration: Motion.duration.normal });
      }, Motion.duration.fast);
    }, Motion.loadingSceneRotate);
    return () => {
      clearInterval(interval);
      if (rotateTimer.current) clearTimeout(rotateTimer.current);
    };
  }, [phase, pinned, reducedMotion, sceneOpacity, size]);
  const sceneStyle = useAnimatedStyle(() => ({ opacity: sceneOpacity.value }));

  const [slow, setSlow] = useState(false);
  const hasSlowAction = Boolean(slowAction);
  useEffect(() => {
    setSlow(false);
    if (!hasSlowAction || phase !== 'wait') return undefined;
    const timer = setTimeout(() => setSlow(true), Motion.loadingSlowHint);
    return () => clearTimeout(timer);
  }, [hasSlowAction, phase]);

  return (
    <View style={compact ? styles.compactRoot : styles.root}>
      <Animated.View style={[styles.content, appear]}>
        {/* The progress group is one accessible element; the slow-wait action stays outside it so it can be reached. */}
        <View
          testID={testID}
          style={styles.content}
          accessible={phase === 'wait'}
          accessibilityRole="progressbar"
          accessibilityLabel={phase === 'wait' ? message ?? t('Loading...') : undefined}
          accessibilityState={{ busy: phase === 'wait' }}
          accessibilityElementsHidden={phase === 'ready'}
          importantForAccessibility={phase === 'ready' ? 'no-hide-descendants' : 'auto'}
        >
          {reducedMotion ? (
            <Companion pose={pose} size={compact ? COMPACT_COMPANION : undefined} />
          ) : (
            <Animated.View style={sceneStyle}>
              <CompanionScene key={`${scene}-${round}`} scene={scene} phase={phase} compact={compact} testID={testID ? `${testID}-scene` : undefined} />
            </Animated.View>
          )}
          {/* The label goes the moment the wait succeeds, so it never reads over the arriving content; its line stays so the cat does not jump. */}
          {message ? (
            <Text
              testID={testID ? `${testID}-message` : undefined}
              style={[compact ? styles.compactText : headline ? styles.headline : styles.text, { color: compact ? theme.colors.inkSecondary : theme.colors.ink }, phase === 'ready' && styles.gone]}
            >
              {message}
            </Text>
          ) : null}
        </View>
        {action ? (
          // Like the label, the action keeps its line through a success exit so the cat does not jump.
          <View style={[styles.slow, phase === 'ready' && styles.gone]} pointerEvents={phase === 'ready' ? 'none' : 'auto'}>
            <Button testID={testID ? `${testID}-action` : undefined} label={action.label} variant="text" size="sm" disabled={phase === 'ready'} onPress={action.onPress} />
          </View>
        ) : slow && slowAction && phase === 'wait' ? (
          <View style={styles.slow}>
            <Text testID={testID ? `${testID}-slow` : undefined} style={[styles.slowText, { color: theme.colors.inkSecondary }]}>
              {t('Taking longer than usual')}
            </Text>
            <Button testID={testID ? `${testID}-slow-action` : undefined} label={slowAction.label} variant="text" size="sm" onPress={slowAction.onPress} />
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

/**
 * Keeps a page loader mounted for its exit once a wait ends in success. Returns `wait` while loading,
 * `ready` for `Motion.loadingExit` afterwards, then null. Waits that ended before the loader appeared
 * (`Motion.loadingGrace`) or ended in failure hand over immediately: never fake a success. The content
 * renders at once; render the loader in the same place for both phases (an overlay above the content),
 * so the scene that played the wait is the one that fades away over it.
 */
export function useLoadingHandoff(loading: boolean, succeeded: boolean): CompanionScenePhase | null {
  const [exiting, setExiting] = useState(false);
  const startedAt = useRef<number | null>(loading ? Date.now() : null);
  const succeededRef = useRef(succeeded);
  succeededRef.current = succeeded;
  useEffect(() => {
    if (loading) {
      startedAt.current ??= Date.now();
      setExiting(false);
      return undefined;
    }
    const shownFor = startedAt.current === null ? 0 : Date.now() - startedAt.current;
    startedAt.current = null;
    // `succeeded` is read when the wait ends; later changes must not restart an exit.
    if (!succeededRef.current || shownFor < Motion.loadingGrace) {
      setExiting(false);
      return undefined;
    }
    setExiting(true);
    const timer = setTimeout(() => setExiting(false), Motion.loadingExit);
    return () => clearTimeout(timer);
  }, [loading]);
  if (loading) return 'wait';
  // Keep the same scene mounted on the first success render, before the effect
  // starts its exit timer. Returning null here would cut the loader off mid-frame.
  const completingVisibleWait = succeeded && startedAt.current !== null
    && Date.now() - startedAt.current >= Motion.loadingGrace;
  return exiting || completingVisibleWait ? 'ready' : null;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.xl,
  },
  compactRoot: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.xl,
    paddingVertical: Space.xxl,
  },
  content: {
    alignItems: 'center',
  },
  text: {
    marginTop: Space.md,
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    textAlign: 'center',
  },
  headline: {
    marginTop: Space.lg,
    fontSize: FontSize.title,
    lineHeight: LineHeight.title,
    fontWeight: FontWeight.semibold,
    textAlign: 'center',
  },
  slow: {
    marginTop: Space.sm,
    alignItems: 'center',
  },
  slowText: {
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    textAlign: 'center',
  },
  compactText: {
    marginTop: Space.md,
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    textAlign: 'center',
  },
  gone: {
    opacity: 0,
  },
});
