import React, { useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { FullWindowOverlay } from 'react-native-screens';
import { Check, RefreshCcw, ShieldCheck, X } from 'lucide-react-native';
import { publicAppLinks } from '../../config/public';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import { analyticsEvents } from '../../services/analytics/events';
import {
  isRevenueCatPackagePurchaseLocked,
  selectDisplayedRevenueCatPackage,
} from '../../services/pro-subscription';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space, createSurfaceStyle } from '../../theme/tokens';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function ProPaywallOverlay({ visible, onClose }: Props): React.JSX.Element | null {
  const { t } = useTranslation(['common']);
  const { theme } = useAppTheme();
  const {
    errorCode,
    isConfigured,
    isLoading,
    isPro,
    offeringsLoading,
    paywallPackages,
    previewOnly,
    blockedFeature,
    hidePaywall,
    purchasePending,
    purchasePro,
    restorePending,
    restorePurchases,
    selectPackage,
    selectedPackage,
    selectedPackageId,
    snapshot,
    showPaywall,
    showPaywallPreview,
    statusCode,
  } = useProPaywall();
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.96)).current;
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  useEffect(() => {
    if (!visible) return;
    opacity.setValue(0);
    scale.setValue(0.96);
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        damping: 18,
        stiffness: 180,
        mass: 0.9,
      }),
    ]).start();
  }, [opacity, scale, visible]);

  useEffect(() => {
    if (!visible) return;
    analyticsEvents.paywallViewed({
      blocked_feature: blockedFeature,
      package_count: paywallPackages.length,
      preview_only: previewOnly,
      selected_package_id: selectedPackageId,
    });
  }, [blockedFeature, paywallPackages.length, previewOnly, selectedPackageId, visible]);

  if (!visible) return null;

  const reopenPaywall = () => {
    if (previewOnly) {
      showPaywallPreview();
      return;
    }
    if (blockedFeature) {
      showPaywall(blockedFeature);
    }
  };

  const dismissThenRun = async <T,>(task: () => Promise<T>): Promise<T> => {
    hidePaywall();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return task();
  };

  const handleClose = () => {
    analyticsEvents.paywallClosed({
      blocked_feature: blockedFeature,
      preview_only: previewOnly,
    });
    onClose();
  };

  const openExternalUrl = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(t('Unable to open link'), t('Please try again later.'));
    }
  };

  const features = [
    { emoji: '\uD83D\uDD17', text: t('Connect to multiple OpenClaws') },
    { emoji: '\uD83D\uDDD2\uFE0F', text: t('Back up, diagnose & fix OpenClaw') },
    { emoji: '\uD83D\uDD10', text: t('Manage OpenClaw permissions') },
    { emoji: '\u270F\uFE0F', text: t('Edit agent personality and memory') },
    { emoji: '\uD83D\uDCCA', text: t('Search chat history & view logs') },
  ];

  const activePackage = selectDisplayedRevenueCatPackage(paywallPackages, snapshot);
  const selectedPackageLocked = isRevenueCatPackagePurchaseLocked(selectedPackage, paywallPackages, snapshot);
  const interactionLocked = previewOnly && isPro && selectedPackageLocked;
  const purchaseDisabled = selectedPackageLocked || purchasePending || restorePending || offeringsLoading || isLoading || !isConfigured || !selectedPackage;
  const restoreDisabled = previewOnly && isPro ? true : restorePending || purchasePending;
  const feedback = statusCode
    ? {
      tone: 'success' as const,
      text: statusCode === 'restoreSuccess'
        ? t('Your Pro access has been restored.')
        : null,
    }
    : errorCode
      ? {
        tone: 'error' as const,
        text: mapErrorCode(errorCode, t),
      }
      : null;

  const content = (
    <Animated.View
      style={[
        styles.overlay,
        {
          opacity,
        },
      ]}
      pointerEvents="auto"
    >
      <Pressable style={styles.backdropTap} onPress={handleClose} />
      <Animated.View
        style={[
          styles.card,
          createSurfaceStyle(theme.colors, theme.scheme, 'overlay'),
          {
            transform: [{ scale }],
          },
        ]}
      >
        <View style={styles.headerRow}>
          <View style={styles.badge}>
            <ShieldCheck size={16} color={theme.colors.accent} strokeWidth={2.2} />
            <Text style={styles.badgeText}>
              {isPro ? t('You are already a Pro subscriber.') : t('Unlock')}
            </Text>
          </View>
          <Pressable
            onPress={handleClose}
            style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
            hitSlop={10}
          >
            <X size={18} color={theme.colors.inkSecondary} strokeWidth={2.2} />
          </Pressable>
        </View>

        <Text style={styles.title}>Clawket Pro</Text>

        {paywallPackages.length > 0 ? (
          <View style={styles.planGrid}>
            {paywallPackages.map((item) => {
              const selected = item.packageIdentifier === selectedPackageId;
              const isCurrentPlan = item.packageIdentifier === activePackage?.packageIdentifier;
              const packageLocked = isRevenueCatPackagePurchaseLocked(item, paywallPackages, snapshot);
              return (
                <Pressable
                  key={item.packageIdentifier}
                  onPress={() => {
                    if (packageLocked) return;
                    analyticsEvents.paywallPackageSelected(item, {
                      blocked_feature: blockedFeature,
                      preview_only: previewOnly,
                    });
                    selectPackage(item.packageIdentifier);
                  }}
                  disabled={packageLocked}
                  style={({ pressed }) => [
                    styles.planCard,
                    selected && styles.planCardSelected,
                    packageLocked && styles.planCardDisabled,
                    pressed && !packageLocked && styles.planCardPressed,
                  ]}
                >
                  <View style={styles.planHeaderRow}>
                    <View style={styles.planTitleRow}>
                      <Text style={styles.planTitle}>{formatPackageLabel(item.packageType, t)}</Text>
                      {isCurrentPlan ? (
                        <Check size={14} color={theme.colors.accent} strokeWidth={2.6} />
                      ) : null}
                    </View>
                    <Text style={styles.planPrice}>{item.priceString}</Text>
                  </View>
                  {item.pricePerMonthString && item.packageType === 'ANNUAL' ? (
                    <Text style={styles.planMeta}>
                      {t('{{price}} per month, billed yearly', { price: item.pricePerMonthString })}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.featureList}>
          {features.map((feature) => (
            <View key={feature.text} style={styles.featureRow}>
              <Text style={styles.featureEmoji}>{feature.emoji}</Text>
              <Text style={styles.featureText}>{feature.text}</Text>
            </View>
          ))}
        </View>

        {feedback?.text ? (
          <View style={feedback.tone === 'success' ? styles.successBanner : styles.errorBanner}>
            <Text style={feedback.tone === 'success' ? styles.successBannerText : styles.errorBannerText}>
              {feedback.text}
            </Text>
          </View>
        ) : null}

        {(isLoading || offeringsLoading) && paywallPackages.length === 0 ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={theme.colors.accent} />
            <Text style={styles.loadingText}>{t('Subscription options are loading...')}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={() => {
            void (async () => {
              analyticsEvents.paywallSubscribeTapped(selectedPackage, {
                blocked_feature: blockedFeature,
                preview_only: previewOnly,
              });
              const success = await dismissThenRun(purchasePro);
              if (!success) {
                analyticsEvents.paywallPurchaseFailed(selectedPackage, {
                  blocked_feature: blockedFeature,
                  preview_only: previewOnly,
                });
                reopenPaywall();
                return;
              }
              analyticsEvents.paywallPurchaseSucceeded(selectedPackage, {
                blocked_feature: blockedFeature,
                preview_only: previewOnly,
              });
              Alert.alert(t('Purchase successful'), formatSuccessBody(selectedPackage?.packageType, t));
            })();
          }}
          disabled={purchaseDisabled}
          style={({ pressed }) => [
            styles.primaryCta,
            purchaseDisabled && styles.primaryCtaDisabled,
            pressed && !purchaseDisabled && styles.primaryCtaPressed,
          ]}
        >
          {purchasePending ? (
            <ActivityIndicator size="small" color={theme.colors.onAccent} />
          ) : (
            <Text style={styles.primaryCtaText}>
              {formatPrimaryCtaLabel(selectedPackage?.packageType, selectedPackage?.priceString, t)}
            </Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => {
            void (async () => {
              analyticsEvents.paywallRestoreTapped({
                blocked_feature: blockedFeature,
                preview_only: previewOnly,
              });
              const restored = await dismissThenRun(restorePurchases);
              if (restored) {
                analyticsEvents.paywallRestoreSucceeded({
                  blocked_feature: blockedFeature,
                  preview_only: previewOnly,
                });
                Alert.alert(t('Restore Purchases'), t('Your Pro access has been restored.'));
                return;
              }
              analyticsEvents.paywallRestoreFailed({
                blocked_feature: blockedFeature,
                preview_only: previewOnly,
              });
              reopenPaywall();
            })();
          }}
          disabled={restoreDisabled}
          style={({ pressed }) => [
            styles.restoreLink,
            restoreDisabled && styles.restoreLinkDisabled,
            pressed && !restoreDisabled && styles.restoreLinkPressed,
          ]}
          hitSlop={8}
        >
          {restorePending ? (
            <ActivityIndicator size="small" color={theme.colors.inkSecondary} />
          ) : (
            <>
              <RefreshCcw size={13} color={theme.colors.inkSecondary} strokeWidth={2} />
              <Text style={styles.restoreLinkText}>{t('Restore Purchases')}</Text>
            </>
          )}
        </Pressable>

        <View style={styles.legalSection}>
          {formatLegalNote(selectedPackage?.packageType, t) ? (
            <Text style={styles.legalNote}>
              {formatLegalNote(selectedPackage?.packageType, t)}
            </Text>
          ) : null}
          {publicAppLinks.privacyPolicyUrl || publicAppLinks.termsOfUseUrl ? (
            <View style={styles.legalLinksRow}>
              {publicAppLinks.privacyPolicyUrl ? (
                <Pressable
                  onPress={() => {
                    void openExternalUrl(publicAppLinks.privacyPolicyUrl as string);
                  }}
                  style={({ pressed }) => [styles.legalLinkButton, pressed && styles.legalLinkButtonPressed]}
                  hitSlop={8}
                >
                  <Text style={styles.legalLinkText}>{t('Privacy Policy')}</Text>
                </Pressable>
              ) : null}
              {publicAppLinks.termsOfUseUrl ? (
                <Pressable
                  onPress={() => {
                    void openExternalUrl(publicAppLinks.termsOfUseUrl as string);
                  }}
                  style={({ pressed }) => [styles.legalLinkButton, pressed && styles.legalLinkButtonPressed]}
                  hitSlop={8}
                >
                  <Text style={styles.legalLinkText}>{t('Terms of Use')}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      </Animated.View>
    </Animated.View>
  );

  if (Platform.OS === 'ios') {
    return <FullWindowOverlay>{content}</FullWindowOverlay>;
  }

  return (
    <Modal transparent visible statusBarTranslucent animationType="none" onRequestClose={onClose}>
      {content}
    </Modal>
  );
}

function mapErrorCode(
  errorCode: NonNullable<ReturnType<typeof useProPaywall>['errorCode']>,
  t: (key: string) => string,
): string {
  switch (errorCode) {
    case 'notConfigured':
      return t('Purchases are unavailable right now.');
    case 'purchaseUnavailable':
      return t('Unable to load subscription options right now.');
    case 'purchaseCancelled':
      return t('Purchase was cancelled.');
    case 'purchasePending':
      return t('Your purchase is pending approval.');
    case 'restoreNotFound':
      return t('No active Pro subscription was found to restore.');
    case 'restoreFailed':
      return t('Unable to restore your purchases right now.');
    case 'offeringsUnavailable':
      return t('Unable to load subscription options right now.');
    case 'purchaseFailed':
    default:
      return t('Unable to complete your purchase right now.');
  }
}

function formatPackageLabel(packageType: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (packageType === 'MONTHLY') return t('Monthly');
  if (packageType === 'ANNUAL') return t('Yearly');
  if (packageType === 'LIFETIME') return t('Lifetime');
  return packageType;
}

function formatPrimaryCtaLabel(
  packageType: string | undefined,
  priceString: string | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (packageType === 'LIFETIME') {
    return priceString
      ? t('Buy Lifetime — {{price}}', { price: priceString })
      : t('Buy Lifetime');
  }
  return priceString
    ? t('Subscribe Now — {{price}}', { price: priceString })
    : t('Subscribe Now');
}

function formatSuccessBody(packageType: string | undefined, t: (key: string) => string): string {
  if (packageType === 'LIFETIME') {
    return t('Your lifetime Pro access is now active.');
  }
  return t('Your Pro subscription is now active.');
}

function formatLegalNote(packageType: string | undefined, t: (key: string) => string): string | null {
  if (packageType === 'LIFETIME') {
    return null;
  }
  return t('Subscriptions renew automatically and can be cancelled anytime in App Store Settings.');
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.scrim,
      padding: Space.xl,
    },
    backdropTap: {
      ...StyleSheet.absoluteFillObject,
    },
    card: {
      width: '100%',
      maxWidth: 460,
      borderRadius: Radius.card,
      backgroundColor: colors.surfaceFloating,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
      paddingHorizontal: Space.xl,
      paddingVertical: Space.xl,
      gap: Space.lg,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
      paddingHorizontal: Space.sm,
      paddingVertical: Space.xs,
      borderRadius: Radius.full,
      backgroundColor: colors.accentSoft,
    },
    badgeText: {
      fontSize: FontSize.caption,
      fontWeight: FontWeight.semibold,
      color: colors.accent,
    },
    closeButton: {
      width: 36,
      height: 36,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    closeButtonPressed: {
      opacity: 0.82,
    },
    title: {
      fontSize: FontSize.display,
      lineHeight: 32,
      fontWeight: FontWeight.semibold,
      color: colors.ink,
    },
    planGrid: {
      gap: Space.sm,
    },
    planCard: {
      gap: Space.xs,
      borderRadius: Radius.card,
      padding: Space.md,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
    },
    planCardSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    planCardPressed: {
      opacity: 0.92,
    },
    planCardDisabled: {
      opacity: 0.7,
    },
    planHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.md,
    },
    planTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
      flexShrink: 1,
    },
    planTitle: {
      fontSize: FontSize.secondary,
      fontWeight: FontWeight.semibold,
      color: colors.ink,
    },
    planPrice: {
      fontSize: FontSize.secondary,
      fontWeight: FontWeight.semibold,
      color: colors.accent,
    },
    planMeta: {
      fontSize: FontSize.caption,
      color: colors.inkSecondary,
    },
    featureList: {
      gap: Space.xs,
    },
    featureRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
      paddingVertical: Space.sm,
    },
    featureEmoji: {
      fontSize: FontSize.title,
      width: 28,
      textAlign: 'center',
    },
    featureText: {
      flex: 1,
      fontSize: FontSize.secondary,
      color: colors.ink,
      fontWeight: FontWeight.semibold,
    },
    errorBanner: {
      borderRadius: Radius.card,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.bad,
    },
    errorBannerText: {
      fontSize: FontSize.caption,
      color: colors.bad,
      fontWeight: FontWeight.semibold,
    },
    successBanner: {
      borderRadius: Radius.card,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm,
      backgroundColor: colors.accentSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.accent,
    },
    successBannerText: {
      fontSize: FontSize.caption,
      color: colors.accent,
      fontWeight: FontWeight.semibold,
    },
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    loadingText: {
      fontSize: FontSize.caption,
      color: colors.inkSecondary,
    },
    primaryCta: {
      borderRadius: Radius.full,
      paddingVertical: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
      minHeight: 48,
    },
    primaryCtaDisabled: {
      opacity: 0.6,
    },
    primaryCtaPressed: {
      opacity: 0.88,
    },
    primaryCtaText: {
      fontSize: FontSize.secondary,
      fontWeight: FontWeight.semibold,
      color: colors.onAccent,
    },
    restoreLink: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'center',
      gap: Space.xs,
      paddingVertical: Space.xs,
    },
    restoreLinkDisabled: {
      opacity: 0.5,
    },
    restoreLinkPressed: {
      opacity: 0.6,
    },
    restoreLinkText: {
      fontSize: FontSize.caption,
      color: colors.inkSecondary,
    },
    legalSection: {
      alignItems: 'center',
      gap: Space.xs,
      marginTop: -Space.sm,
    },
    legalNote: {
      fontSize: FontSize.caption,
      lineHeight: 15,
      textAlign: 'center',
      color: colors.inkTertiary,
    },
    legalLinksRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.md,
      flexWrap: 'wrap',
    },
    legalLinkButton: {
      paddingHorizontal: Space.xs,
      paddingVertical: 2,
      borderRadius: Radius.full,
    },
    legalLinkButtonPressed: {
      opacity: 0.7,
    },
    legalLinkText: {
      fontSize: FontSize.caption,
      lineHeight: 15,
      color: colors.inkSecondary,
    },
  });
}
