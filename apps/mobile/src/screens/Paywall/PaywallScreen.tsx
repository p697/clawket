import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StatusBar,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { buildPaywallTheme } from '../../theme/paywall';
import { PaywallLumenHero } from '../../components/pro/PaywallLumenHero';
import { Companion } from '../../components/ui/Companion';
import { PaywallBenefits } from '../../components/pro/PaywallBenefits';
import { PaywallPlanCard } from '../../components/pro/PaywallPlanCard';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import type { ProPaywallPhase, ProPaywallStatusCode } from '../../contexts/ProPaywallContext';
import type { ProPaywallPackage, ProPurchaseFailureReason } from '../../services/pro-subscription';
import { ThemeContext, useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  HitSize,
  IconSize,
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';
import type { ProFeature } from '../../utils/pro';
import {
  orderPaywallPackages,
  paywallFailureMessageKey,
  resolvePaywallContent,
  type PaywallBenefitKey,
  type PaywallFailureMessageKey,
  type PaywallSubtitleFeatureKey,
  type PaywallSubtitleKey,
  type PaywallTitleKey,
} from './model';

type Props = Readonly<{
  blockedFeature: ProFeature | null;
  phase: ProPaywallPhase;
  packages: readonly ProPaywallPackage[];
  selectedPackageId: string | null;
  failureReason: ProPurchaseFailureReason | null;
  failureOperation: 'purchase' | 'restore' | null;
  disabledPackageIds?: readonly string[];
  purchaseDisabled?: boolean;
  restoreDisabled?: boolean;
  redeemDisabled?: boolean;
  onRedeem?: () => void;
  isMember?: boolean;
  currentPackageId?: string | null;
  planChange?: boolean;
  lifetimeRenewalWarning?: boolean;
  statusCode?: ProPaywallStatusCode | null;
  onManageSubscription?: () => void;
  onClose: () => void;
  onRestore: () => void;
  onRetry: () => void;
  onSelectPackage: (packageId: string) => void;
  onPurchase: () => void;
  onOpenTerms: () => void;
  onOpenPrivacy: () => void;
}>;

export function PaywallScreen(props: Props): React.JSX.Element {
  const parent = useAppTheme();
  const presentation = useMemo(() => ({ ...parent, theme: buildPaywallTheme(parent.theme), resolvedScheme: 'dark' as const }), [parent]);
  return <ThemeContext.Provider value={presentation}><PaywallPresentation {...props} /></ThemeContext.Provider>;
}

function PaywallPresentation({
  blockedFeature,
  phase,
  packages,
  selectedPackageId,
  failureReason,
  failureOperation,
  disabledPackageIds = [],
  purchaseDisabled = false,
  restoreDisabled = false,
  isMember = false,
  currentPackageId,
  planChange = false,
  lifetimeRenewalWarning = false,
  statusCode,
  onManageSubscription,
  onClose,
  onRestore,
  onRedeem,
  redeemDisabled = false,
  onRetry,
  onSelectPackage,
  onPurchase,
  onOpenTerms,
  onOpenPrivacy,
}: Props): React.JSX.Element {
  const { t } = useTranslation(['common']);
  const { theme } = useAppTheme();
  const { height, width, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const content = useMemo(() => resolvePaywallContent(blockedFeature), [blockedFeature]);
  const orderedPackages = useMemo(() => orderPaywallPackages(packages), [packages]);
  const selectedPackage = orderedPackages.find((item) => item.packageIdentifier === selectedPackageId) ?? null;
  const [monthlyVisible, setMonthlyVisible] = useState(selectedPackage?.packageType === 'MONTHLY');
  const interactionLocked = phase === 'purchasing' || phase === 'restoring' || phase === 'success';
  const actionsLocked = interactionLocked || phase === 'redeeming';
  const isSuccess = phase === 'success';
  const isComplete = phase === 'complete';
  const hero = content.hero;
  const benefits = content.benefits;
  const title = isComplete
    ? statusCode === 'planChangeScheduled' ? t('Plan change submitted')
      : statusCode === 'lifetimeManageSubscription' ? t('Lifetime is active') : t('Purchase is being verified')
    : isMember && !isSuccess ? t('Manage Clawket Pro') : isSuccess
    ? t("You're Pro")
    : translatePaywallTitle(content.titleKey, t);
  const subtitle = isComplete
    ? statusCode === 'planChangeScheduled' ? t('Your store confirms when the new plan and price take effect.')
      : statusCode === 'lifetimeManageSubscription' ? t('Lifetime does not cancel your existing subscription. Turn off its renewal in your store to avoid further charges.')
        : t('Your current access is unchanged. Check your store before trying again.')
    : isSuccess
    ? t('Everything is unlocked. Picking up where you left off...')
    : content.subtitleKey
      ? translatePaywallSubtitle(content.subtitleKey, content.subtitleFeatureKey, t)
      : null;
  const failureMessageKey = paywallFailureMessageKey(failureReason, failureOperation);
  const failureMessage = phase === 'failure' && failureMessageKey
    ? translatePaywallFailure(failureMessageKey, t)
    : null;
  const heroMinHeight = Math.min(164, Math.max(104, height - 700));

  useEffect(() => {
    if (selectedPackage?.packageType === 'MONTHLY') setMonthlyVisible(true);
  }, [selectedPackage?.packageType]);

  // Members see their owned plan plus every plan they can still move to; locked
  // alternatives (lifetime owners, family sharing) are omitted rather than dimmed.
  // Fall back to the full list when the owned plan cannot be matched to the catalog.
  const memberPackages = isMember
    ? orderedPackages.filter((item) => (
      item.packageIdentifier === currentPackageId || !disabledPackageIds.includes(item.packageIdentifier)
    ))
    : [];
  const displayedPackages = memberPackages.length > 0
    ? memberPackages
    : orderedPackages.filter((item) => item.packageType !== 'MONTHLY' || monthlyVisible || isMember);
  const compactPlans = width >= 360 && fontScale < 1.2 && displayedPackages.length === 2;
  const showMonthlyDisclosure = !isMember && !monthlyVisible
    && orderedPackages.some((item) => item.packageType === 'MONTHLY');
  // A member whose selection is the plan they already own has nothing to buy:
  // the plan card carries the price and billing, so no checkout button is drawn.
  const selectedIsCurrent = Boolean(
    isMember && currentPackageId && selectedPackage?.packageIdentifier === currentPackageId,
  );

  return (
    <View
      testID="paywall-screen"
      style={[
        styles.screen,
        { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, Space.md) },
      ]}
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Pressable
          testID="paywall-close"
          accessibilityRole="button"
          accessibilityLabel={t('Close')}
          disabled={interactionLocked}
          onPress={onClose}
          style={({ pressed }) => [styles.headerButton, pressed ? styles.pressed : null]}
        >
          <View style={styles.closeCircle}>
            <X size={IconSize.sm} color={theme.colors.inkSecondary} strokeWidth={2.2} />
          </View>
        </Pressable>
        <View pointerEvents="none" style={styles.wordmark}>
          <Companion size={IconSize.md} />
          {width >= 360 && fontScale < 1.2 ? <Text style={styles.brandText}>clawket</Text> : null}
          <Text style={styles.proLabel}>Pro</Text>
        </View>
        <Pressable
          testID="paywall-restore"
          accessibilityRole="button"
          accessibilityLabel={t('Restore Purchases')}
          accessibilityState={{ disabled: actionsLocked || restoreDisabled, busy: phase === 'restoring' }}
          disabled={actionsLocked || restoreDisabled}
          onPress={onRestore}
          style={({ pressed }) => [styles.restoreButton, pressed ? styles.pressed : null]}
        >
          {phase === 'restoring' ? (
            <ActivityIndicator size="small" color={theme.colors.inkSecondary} />
          ) : (
            <Text style={styles.restoreText}>{t('Restore')}</Text>
          )}
        </Pressable>
      </View>

      <ScrollView
        testID="paywall-layout-scroll"
        style={styles.scroll}
        contentContainerStyle={styles.flowContent}
        bounces={false}
      >
      <View
        testID="paywall-benefits-scroll"
        style={styles.scrollContent}
      >
        <View
          testID={`paywall-hero-${hero}`}
          accessible={false}
          style={[styles.hero, { minHeight: heroMinHeight }]}
        >
          <View style={StyleSheet.absoluteFill}>
            <PaywallLumenHero hero={hero} success={isSuccess} />
          </View>
          {isSuccess ? <View testID="paywall-hero-success" style={styles.successMark}><Check size={IconSize.lg} color={theme.colors.good}/></View> : null}
        </View>

        <View style={styles.heading}>
          <Text testID="paywall-title" style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>

        {!isSuccess && !isComplete ? (
          <PaywallBenefits items={benefits.map(benefit => ({
            kind: benefit.kind, label: translatePaywallBenefit(benefit.labelKey, t),
          }))}/>
        ) : null}

      </View>

      {statusCode === 'redemptionWaiting' || statusCode === 'redemptionUnconfirmed' || statusCode === 'redemptionFailed' ? (
        <Text testID="paywall-redemption-status" accessibilityLiveRegion="polite" style={styles.redemptionText}>
          {statusCode === 'redemptionWaiting'
            ? t('Complete redemption in the store. Your Pro access will sync here.')
            : statusCode === 'redemptionUnconfirmed'
              ? t('No new Pro access confirmed yet. If you redeemed a code, tap Restore.')
              : t('Unable to open redemption. Please try again.')}
        </Text>
      ) : null}
      <View testID="paywall-footer" pointerEvents={actionsLocked ? 'none' : 'auto'} style={styles.footer}>
        {isComplete ? (
          <>
            {onManageSubscription ? <Button testID="paywall-manage-subscription" label={t('Manage subscription')} onPress={onManageSubscription} /> : null}
            <Button testID="paywall-done" label={t('Done')} variant="secondary" onPress={onClose} />
          </>
        ) : isSuccess ? (
          <View testID="paywall-success-progress" style={styles.successProgress} />
        ) : (
          <>
            {phase === 'loading' && orderedPackages.length === 0 ? (
              <View testID="paywall-plan-skeletons" style={styles.plans}>
                <Skeleton testID="paywall-plan-skeleton-annual" style={styles.planSkeleton} />
                <Skeleton testID="paywall-plan-skeleton-lifetime" style={styles.planSkeleton} />
              </View>
            ) : phase === 'unavailable' && orderedPackages.length === 0 ? (
              <View testID="paywall-offerings-unavailable" style={styles.unavailable}>
                <Text style={styles.feedbackText}>{t('Unable to load subscription options right now.')}</Text>
                <Button label={t('Retry')} variant="secondary" size="sm" onPress={onRetry} />
              </View>
            ) : (
              <View style={[styles.plans, compactPlans ? styles.plansRow : null]}>
                {displayedPackages.map((item) => (
                  <PaywallPlanCard
                    key={item.packageIdentifier}
                    testID={`paywall-plan-${item.packageType.toLowerCase()}`}
                    compact={compactPlans}
                    title={formatPackageTitle(item.packageType, t)}
                    price={item.priceString}
                    detail={formatPackageDetail(item, t)}
                    badge={item.packageIdentifier === currentPackageId ? t('Current plan') : item.packageType === 'ANNUAL' ? t('Recommended') : null}
                    selected={item.packageIdentifier === selectedPackageId}
                    current={isMember && item.packageIdentifier === currentPackageId}
                    disabled={actionsLocked || disabledPackageIds.includes(item.packageIdentifier)}
                    onPress={() => onSelectPackage(item.packageIdentifier)}
                  />
                ))}
              </View>
            )}

            {showMonthlyDisclosure ? (
              <Pressable
                testID="paywall-show-monthly"
                accessibilityRole="button"
                disabled={actionsLocked}
                onPress={() => setMonthlyVisible(true)}
                style={({ pressed }) => [styles.monthlyButton, pressed ? styles.pressed : null]}
              >
                <Text style={styles.monthlyText}>{t('View monthly plan')}</Text>
              </Pressable>
            ) : null}

            {selectedIsCurrent && !failureMessage && !lifetimeRenewalWarning ? null : (
              <View testID="paywall-checkout" style={[styles.checkout, showMonthlyDisclosure ? null : styles.checkoutSpaced]}>
                {failureMessage ? (
                  <Text testID="paywall-failure" style={styles.failureText}>{failureMessage}</Text>
                ) : null}

                {planChange ? <Text testID="paywall-change-timing" style={styles.billingText}>{t('Your store confirms when the new plan and price take effect.')}</Text> : null}
                {lifetimeRenewalWarning ? <Text testID="paywall-lifetime-renewal-warning" style={styles.feedbackText}>{t('Lifetime does not cancel your existing subscription. Turn off its renewal in your store to avoid further charges.')}</Text> : null}
                {selectedIsCurrent ? null : (
                  <>
                    <Button
                      testID="paywall-purchase"
                      multiline
                      label={isMember && selectedPackage?.packageType === 'LIFETIME' ? t('Buy lifetime')
                        : planChange ? selectedPackage?.packageType === 'ANNUAL' ? t('Change to annual') : t('Change to monthly')
                          : blockedFeature === 'agents' ? t('Upgrade to use more Agents') : t('Start Clawket Pro')}
                      size="lg"
                      loading={phase === 'purchasing'}
                      disabled={actionsLocked || purchaseDisabled || phase === 'loading' || phase === 'unavailable' || !selectedPackage}
                      onPress={onPurchase}
                    />
                    {selectedPackage ? <Text testID="paywall-billing" accessibilityHint={selectedPackage.packageType === 'LIFETIME' ? undefined : Platform.OS === 'android' ? t('Cancel anytime in Google Play') : t('Cancel anytime in the App Store')} style={styles.billingText}>{formatBilling(selectedPackage, t)}</Text> : null}
                  </>
                )}
              </View>
            )}

            {isMember && onManageSubscription ? <Button testID="paywall-manage-subscription" label={t('Manage subscription')} variant="secondary" style={styles.manageButton} disabled={actionsLocked} onPress={onManageSubscription} /> : null}
            <View style={styles.legalRow}>
              {onRedeem ? <Pressable testID="paywall-redeem" accessibilityRole="button"
                disabled={actionsLocked || redeemDisabled} accessibilityState={{ disabled: actionsLocked || redeemDisabled }}
                onPress={onRedeem} style={styles.legalLink}>
                <Text style={styles.legalLinkText}>{t('Redeem code')}</Text>
              </Pressable> : null}
              <Pressable accessibilityRole="link" onPress={onOpenTerms} style={styles.legalLink}>
                <Text style={styles.legalLinkText}>{t('Terms')}</Text>
              </Pressable>
              <Pressable accessibilityRole="link" onPress={onOpenPrivacy} style={styles.legalLink}>
                <Text style={styles.legalLinkText}>{t('Privacy')}</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
      </ScrollView>
    </View>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

function formatPackageTitle(packageType: string, t: Translate): string {
  if (packageType === 'ANNUAL') return t('Annual');
  if (packageType === 'LIFETIME') return t('Lifetime');
  if (packageType === 'MONTHLY') return t('Monthly');
  return packageType;
}

function formatPackageDetail(
  item: ProPaywallPackage,
  t: Translate,
): string | null {
  if (item.packageType === 'LIFETIME') return t('One-time purchase');
  if (item.packageType === 'MONTHLY') return t('Billed monthly');
  if (item.packageType !== 'ANNUAL' || !item.pricePerMonthString) return null;
  return t('{{price}} / month', { price: item.pricePerMonthString });
}

function formatBilling(item: ProPaywallPackage, t: Translate): string {
  if (item.packageType === 'LIFETIME') return t('{{price}} · One-time purchase', { price: item.priceString });
  const price = item.packageType === 'ANNUAL'
    ? t('{{price}} / year · Renews automatically', { price: item.priceString })
    : item.packageType === 'MONTHLY'
      ? t('{{price}} / month · Renews automatically', { price: item.priceString })
      : item.priceString;
  return `${price} · ${t('Cancel anytime')}`;
}

function translatePaywallTitle(key: PaywallTitleKey, t: Translate): string {
  switch (key) {
    case 'Search and bulk export': return t('Search and bulk export');
    case 'Skill and memory versions': return t('Skill and memory versions');
    case 'Edit your Agent’s memory and files': return t('Edit your Agent’s memory and files');
    case 'More possibilities with your Agents': return t('More possibilities with your Agents');
    case 'Explore your Agent conversations': return t('Explore your Agent conversations');
    case 'Every Agent in your pocket': return t('Every Agent in your pocket');
    case 'Bring every Agent into the roster': return t('Bring every Agent into the roster');
    case 'Fix your OpenClaw from your phone': return t('Fix your OpenClaw from your phone');
    case 'Read logs and edit files without going back to your computer':
      return t('Read logs and edit files without going back to your computer');
    case 'Choose which models your Agent uses': return t('Choose which models your Agent uses');
    case 'Find any message again': return t('Find any message again');
    case 'Every conversation, in full': return t('Every conversation, in full');
    case 'See where every token goes': return t('See where every token goes');
  }
}

function translatePaywallSubtitle(
  key: PaywallSubtitleKey,
  featureKey: PaywallSubtitleFeatureKey | null,
  t: Translate,
): string {
  switch (key) {
    case 'OpenClaw and Hermes together, ready whenever you are.':
      return t('OpenClaw and Hermes together, ready whenever you are.');
    case 'Agents beyond main are a Pro feature.':
      return t('Agents beyond main are a Pro feature.');
    case 'Read complete channel, task and subagent conversations, and reply where supported.':
      return t('Read complete channel, task and subagent conversations, and reply where supported.');
    case 'Message details across sessions are a Pro feature.':
      return t('Message details across sessions are a Pro feature.');
    case '7-day and 30-day usage, cost and trends are a Pro feature.':
      return t('7-day and 30-day usage, cost and trends are a Pro feature.');
    case '{{feature}} is a Pro feature.':
      return t('{{feature}} is a Pro feature.', {
        feature: featureKey ? translatePaywallSubtitleFeature(featureKey, t) : '',
      });
  }
}

function translatePaywallSubtitleFeature(key: PaywallSubtitleFeatureKey, t: Translate): string {
  switch (key) {
    case 'Permissions': return t('Permissions');
    case 'Config backups': return t('Config backups');
    case 'Configuration': return t('Configuration');
    case 'Diagnostics': return t('Diagnostics');
  }
}

function translatePaywallBenefit(key: PaywallBenefitKey, t: Translate): string {
  switch (key) {
    case 'Search and bulk export': return t('Search and bulk export');
    case 'Skill and memory versions': return t('Skill and memory versions');
    case 'Choose which models your Agent uses': return t('Choose which models your Agent uses');
    case 'Conversations across channels and tasks': return t('Conversations across channels and tasks');
    case "Shape your Agent's personality and memory": return t("Shape your Agent's personality and memory");
    case 'Configure, back up and diagnose your Agents': return t('Configure, back up and diagnose your Agents');
    case 'More Agents, unlimited connections': return t('More Agents, unlimited connections');
    case 'Fix OpenClaw from your phone': return t('Fix OpenClaw from your phone');
    case 'Logs, files, and search': return t('Logs, files, and search');
    case 'Unlimited connections and Agents': return t('Unlimited connections and Agents');
    case 'One-tap permission and diagnostic fixes': return t('One-tap permission and diagnostic fixes');
    case 'Unlimited connections': return t('Unlimited connections');
    case 'Unlimited Agents': return t('Unlimited Agents');
    case 'Logs and file editing': return t('Logs and file editing');
    case 'Search across sessions and favorites': return t('Search across sessions and favorites');
    case '7- and 30-day usage and cost trends': return t('7- and 30-day usage and cost trends');
  }
}

function translatePaywallFailure(key: PaywallFailureMessageKey, t: Translate): string {
  switch (key) {
    case 'Your purchase is pending approval.': return t('Your purchase is pending approval.');
    case 'Unable to load subscription options right now.':
      return t('Unable to load subscription options right now.');
    case 'Unable to restore your purchases right now.':
      return t('Unable to restore your purchases right now.');
    case 'Unable to complete your purchase right now.':
      return t('Unable to complete your purchase right now.');
  }
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.canvas },
    wordmark: { position: 'absolute', left: '33%', right: '33%', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: Space.sm },
    brandText: { color: colors.ink, fontSize: FontSize.body, fontWeight: FontWeight.semibold },
    proLabel: { color: colors.inkSecondary, fontSize: FontSize.caption, fontWeight: FontWeight.semibold },
    successMark: { position: 'absolute', right: Space.xl, bottom: Space.md },
    header: {
      minHeight: ControlSize.floatingButton,
      paddingHorizontal: Space.lg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerButton: {
      width: HitSize.md,
      height: HitSize.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeCircle: {
      width: 28,
      height: 28,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
    },
    restoreButton: {
      maxWidth: '33%',
      minHeight: HitSize.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: Space.xs,
      paddingLeft: Space.md,
    },
    restoreText: {
      flexShrink: 1,
      textAlign: 'right',
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.semibold,
    },
    pressed: { opacity: 0.65 },
    scroll: { flex: 1 },
    flowContent: { flexGrow: 1 },
    scrollContent: { flexGrow: 1, paddingHorizontal: Space.xl, paddingBottom: Space.xxl, gap: Space.md },
    // Extra height belongs above the copy, not between the benefits and plans.
    hero: {
      flexGrow: 1,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    },
    heading: { gap: Space.md, alignItems: 'center', paddingBottom: Space.sm },
    title: {
      textAlign: 'center',
      color: colors.ink,
      fontSize: FontSize.display,
      lineHeight: LineHeight.display,
      fontWeight: FontWeight.regular,
    },
    subtitle: {
      textAlign: 'center',
      color: colors.inkSecondary,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
      fontWeight: FontWeight.regular,
    },
    footer: { paddingHorizontal: Space.xl, gap: Space.xs },
    plans: { gap: Space.sm },
    plansRow: { flexDirection: 'row', alignItems: 'stretch' },
    checkout: { gap: Space.xs },
    // Without the monthly disclosure between them, plans and checkout need their own breathing room.
    checkoutSpaced: { marginTop: Space.md },
    manageButton: { marginTop: Space.md },
    planSkeleton: { minHeight: ControlSize.settingsRow },
    unavailable: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
    feedbackText: {
      flex: 1,
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.regular,
    },
    // Sits between the benefits and the plans, outside both padded containers, so it aligns itself.
    redemptionText: {
      paddingHorizontal: Space.xl,
      marginBottom: Space.md,
      textAlign: 'center',
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.regular,
    },
    monthlyButton: { minHeight: HitSize.md, alignSelf: 'center', justifyContent: 'center', paddingHorizontal: Space.md },
    monthlyText: {
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.semibold,
    },
    failureText: {
      color: colors.bad,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.regular,
      textAlign: 'center',
    },
    legalRow: { minHeight: HitSize.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: Space.xs },
    billingText: { marginTop: Space.xs, textAlign: 'center', color: colors.inkSecondary, fontSize: FontSize.caption, lineHeight: LineHeight.caption },
    legalText: { color: colors.inkTertiary, fontSize: FontSize.caption, lineHeight: LineHeight.caption, fontWeight: FontWeight.regular },
    legalLink: { minHeight: HitSize.md, justifyContent: 'center', paddingHorizontal: Space.xs },
    legalLinkText: { color: colors.inkSecondary, fontSize: FontSize.caption, lineHeight: LineHeight.caption, fontWeight: FontWeight.regular },
    successProgress: { height: Space.xs, borderRadius: Radius.full, backgroundColor: colors.good },
  });
}
