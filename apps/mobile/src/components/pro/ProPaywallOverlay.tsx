import React, { useCallback, useEffect, useRef } from 'react';
import { Alert, Linking, Modal } from 'react-native';
import { useTranslation } from 'react-i18next';
import { publicAppLinks } from '../../config/public';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import { analyticsEvents } from '../../services/analytics/events';
import { isRevenueCatPackagePurchaseLocked } from '../../services/pro-subscription';
import { PaywallScreen } from '../../screens/Paywall/PaywallScreen';
import { resolvePaywallContent } from '../../screens/Paywall/model';
import type { ProFeature } from '../../utils/pro';

export type ProPaywallContinueSource = 'purchase' | 'restore' | 'threePointZeroIntro';

type Props = Readonly<{
  visible: boolean;
  onClose: () => void;
  onContinue?: (source: ProPaywallContinueSource) => void;
}>;

type PaywallTriggerScreen = 'roster' | 'settings' | 'account' | 'search';

type PurchasePaywallAnalyticsContext = Readonly<{
  blocked_feature: ProFeature | null;
  preview_only: boolean;
  hero: ReturnType<typeof resolvePaywallContent>['hero'];
  variant: 'generic' | 'contextual';
  trigger_screen: PaywallTriggerScreen;
  launch: boolean;
}>;

type PurchasePaywallSession = Readonly<{
  context: PurchasePaywallAnalyticsContext;
  openedAtMs: number;
}> & { planToggled: boolean };

export function ProPaywallOverlay({ visible, onClose, onContinue }: Props): React.JSX.Element | null {
  const { t } = useTranslation(['common']);
  const viewedRef = useRef(false);
  const purchaseSessionRef = useRef<PurchasePaywallSession | null>(null);
  const submissionInFlightRef = useRef(false);
  const {
    blockedFeature,
    completeThreePointZeroIntro,
    failureOperation,
    failureReason,
    isConfigured,
    isPro,
    paywallMode,
    paywallPackages,
    paywallPhase,
    previewOnly,
    purchasePro,
    refreshOfferings,
    restorePurchases,
    selectPackage,
    selectedPackage,
    selectedPackageId,
    snapshot,
  } = useProPaywall();

  const finishPurchasePaywallSession = useCallback(() => {
    const session = purchaseSessionRef.current;
    if (!session) return;
    purchaseSessionRef.current = null;
    analyticsEvents.paywallClosed({
      ...session.context,
      seconds_on_paywall: Math.max(0, Math.round((Date.now() - session.openedAtMs) / 1_000)),
      plan_toggled: session.planToggled,
    });
  }, []);

  useEffect(() => {
    if (!visible) {
      viewedRef.current = false;
      finishPurchasePaywallSession();
      return;
    }
    if (!paywallMode) return;
    if (paywallMode === 'threePointZeroIntro') {
      finishPurchasePaywallSession();
      if (viewedRef.current) return;
      viewedRef.current = true;
      analyticsEvents.paywallLaunchShown({ variant: 'three_point_zero_intro', first_run: false });
      return;
    }
    viewedRef.current = false;
    if (purchaseSessionRef.current) return;
    const context = buildPurchasePaywallAnalyticsContext(blockedFeature, previewOnly);
    purchaseSessionRef.current = {
      context,
      openedAtMs: Date.now(),
      planToggled: false,
    };
    analyticsEvents.paywallViewed({
      ...context,
      package_count: paywallPackages.length,
      selected_package_id: selectedPackageId,
    });
  }, [
    blockedFeature,
    finishPurchasePaywallSession,
    paywallMode,
    paywallPackages.length,
    previewOnly,
    selectedPackageId,
    visible,
  ]);

  const openExternalUrl = useCallback(async (url: string | null) => {
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(t('Unable to open link'), t('Please try again later.'));
    }
  }, [t]);

  if (!visible || !paywallMode) return null;

  const interactionLocked = paywallPhase === 'purchasing'
    || paywallPhase === 'restoring'
    || paywallPhase === 'success';
  const disabledPackageIds = paywallPackages
    .filter((item) => isRevenueCatPackagePurchaseLocked(item, paywallPackages, snapshot))
    .map((item) => item.packageIdentifier);
  const selectedPackageLocked = selectedPackage
    ? disabledPackageIds.includes(selectedPackage.packageIdentifier)
    : true;

  const handleClose = () => {
    if (interactionLocked) return;
    if (paywallMode === 'threePointZeroIntro') {
      analyticsEvents.paywallLaunchClosed({ variant: 'three_point_zero_intro', first_run: false });
    } else {
      finishPurchasePaywallSession();
    }
    onClose();
  };

  const analyticsContext = purchaseSessionRef.current?.context
    ?? buildPurchasePaywallAnalyticsContext(blockedFeature, previewOnly);

  const handlePurchase = () => {
    if (submissionInFlightRef.current) return;
    submissionInFlightRef.current = true;
    const targetPackage = selectedPackage;
    analyticsEvents.paywallSubscribeTapped(targetPackage, {
      ...analyticsContext,
    });
    void purchasePro()
      .then((result) => {
        if (result.success) {
          analyticsEvents.paywallPurchaseSucceeded(targetPackage, {
            ...analyticsContext,
          });
          onContinue?.('purchase');
          return;
        }
        analyticsEvents.paywallPurchaseFailed(targetPackage, {
          ...analyticsContext,
          reason: result.reason,
        });
      })
      .finally(() => {
        submissionInFlightRef.current = false;
      });
  };

  const handleRestore = () => {
    if (submissionInFlightRef.current) return;
    submissionInFlightRef.current = true;
    analyticsEvents.paywallRestoreTapped({ ...analyticsContext });
    void restorePurchases()
      .then((result) => {
        if (result.success) {
          analyticsEvents.paywallRestoreSucceeded({ ...analyticsContext });
          onContinue?.('restore');
          return;
        }
        analyticsEvents.paywallRestoreFailed({
          ...analyticsContext,
          reason: result.reason,
        });
      })
      .finally(() => {
        submissionInFlightRef.current = false;
      });
  };

  const handleCompleteIntro = () => {
    analyticsEvents.paywallLaunchClosed({ variant: 'three_point_zero_intro', first_run: false });
    completeThreePointZeroIntro();
    onContinue?.('threePointZeroIntro');
  };

  return (
    <Modal
      testID="pro-paywall-modal"
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      allowSwipeDismissal={!interactionLocked}
      onRequestClose={handleClose}
    >
      <PaywallScreen
        mode={paywallMode}
        blockedFeature={blockedFeature}
        phase={paywallPhase}
        packages={paywallPackages}
        selectedPackageId={selectedPackageId}
        failureReason={failureReason}
        failureOperation={failureOperation}
        disabledPackageIds={disabledPackageIds}
        purchaseDisabled={!isConfigured || selectedPackageLocked}
        restoreDisabled={previewOnly && isPro}
        onClose={handleClose}
        onRestore={handleRestore}
        onRetry={() => { void refreshOfferings(); }}
        onSelectPackage={(packageId) => {
          const selected = paywallPackages.find((item) => item.packageIdentifier === packageId) ?? null;
          const session = purchaseSessionRef.current;
          if (session && packageId !== selectedPackageId) session.planToggled = true;
          analyticsEvents.paywallPackageSelected(selected, {
            ...analyticsContext,
          });
          selectPackage(packageId);
        }}
        onPurchase={handlePurchase}
        onCompleteIntro={handleCompleteIntro}
        onOpenTerms={() => { void openExternalUrl(publicAppLinks.termsOfUseUrl); }}
        onOpenPrivacy={() => { void openExternalUrl(publicAppLinks.privacyPolicyUrl); }}
      />
    </Modal>
  );
}

function buildPurchasePaywallAnalyticsContext(
  blockedFeature: ProFeature | null,
  previewOnly: boolean,
): PurchasePaywallAnalyticsContext {
  const content = resolvePaywallContent(blockedFeature);
  return {
    blocked_feature: blockedFeature,
    preview_only: previewOnly,
    hero: content.hero,
    variant: content.hero === 'generic' ? 'generic' : 'contextual',
    trigger_screen: resolvePaywallTriggerScreen(blockedFeature),
    launch: blockedFeature === 'launch',
  };
}

function resolvePaywallTriggerScreen(blockedFeature: ProFeature | null): PaywallTriggerScreen {
  if (blockedFeature === 'messageHistory') return 'search';
  if (blockedFeature === 'appIcons' || blockedFeature === 'settingsMembershipPreview') return 'account';
  if (blockedFeature === 'agents' || blockedFeature === 'gatewayConnections' || blockedFeature === 'launch') {
    return 'roster';
  }
  return 'settings';
}
