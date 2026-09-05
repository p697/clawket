import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Bot,
  Check,
  Files,
  Network,
  RotateCcw,
  Search,
  Sparkles,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { publicPaywallSocialProof } from '../../config/public';
import { PaywallPlanCard } from '../../components/pro/PaywallPlanCard';
import { AgentAvatar } from '../../components/ui/AgentAvatar';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import type { ProPaywallPhase } from '../../contexts/ProPaywallContext';
import type { ProPaywallPackage, ProPurchaseFailureReason } from '../../services/pro-subscription';
import { useAppTheme } from '../../theme';
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
  THREE_POINT_ZERO_INTRO_CONTENT,
  calculateAnnualSavings,
  orderPaywallPackages,
  paywallFailureMessageKey,
  resolvePaywallContent,
  shouldShowPaywallSocialProof,
  type PaywallActionKey,
  type PaywallBenefitKey,
  type PaywallBenefitKind,
  type PaywallFailureMessageKey,
  type PaywallHero,
  type PaywallMode,
  type PaywallSubtitleFeatureKey,
  type PaywallSubtitleKey,
  type PaywallTitleKey,
} from './model';

type Props = Readonly<{
  mode: PaywallMode;
  blockedFeature: ProFeature | null;
  phase: ProPaywallPhase;
  packages: readonly ProPaywallPackage[];
  selectedPackageId: string | null;
  failureReason: ProPurchaseFailureReason | null;
  failureOperation: 'purchase' | 'restore' | null;
  disabledPackageIds?: readonly string[];
  purchaseDisabled?: boolean;
  restoreDisabled?: boolean;
  onClose: () => void;
  onRestore: () => void;
  onRetry: () => void;
  onSelectPackage: (packageId: string) => void;
  onPurchase: () => void;
  onCompleteIntro: () => void;
  onOpenTerms: () => void;
  onOpenPrivacy: () => void;
}>;

const BENEFIT_ICONS: Readonly<Record<PaywallBenefitKind, LucideIcon>> = {
  connections: Network,
  agents: Bot,
  manage: Wrench,
  logsFiles: Files,
  search: Search,
  combined: Sparkles,
};

export function PaywallScreen({
  mode,
  blockedFeature,
  phase,
  packages,
  selectedPackageId,
  failureReason,
  failureOperation,
  disabledPackageIds = [],
  purchaseDisabled = false,
  restoreDisabled = false,
  onClose,
  onRestore,
  onRetry,
  onSelectPackage,
  onPurchase,
  onCompleteIntro,
  onOpenTerms,
  onOpenPrivacy,
}: Props): React.JSX.Element {
  const { t } = useTranslation(['common']);
  const { theme } = useAppTheme();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const content = useMemo(() => resolvePaywallContent(blockedFeature), [blockedFeature]);
  const orderedPackages = useMemo(() => orderPaywallPackages(packages), [packages]);
  const selectedPackage = orderedPackages.find((item) => item.packageIdentifier === selectedPackageId) ?? null;
  const [monthlyVisible, setMonthlyVisible] = useState(selectedPackage?.packageType === 'MONTHLY');
  const interactionLocked = phase === 'purchasing' || phase === 'restoring' || phase === 'success';
  const isIntro = mode === 'threePointZeroIntro';
  const isSuccess = phase === 'success';
  const hero = isIntro ? THREE_POINT_ZERO_INTRO_CONTENT.hero : content.hero;
  const benefits = isIntro ? THREE_POINT_ZERO_INTRO_CONTENT.benefits : content.benefits;
  const title = isSuccess
    ? t("You're Pro")
    : translatePaywallTitle(isIntro ? THREE_POINT_ZERO_INTRO_CONTENT.titleKey : content.titleKey, t);
  const subtitle = isSuccess
    ? t('Everything is unlocked. Picking up where you left off...')
    : isIntro
      ? translatePaywallSubtitle(THREE_POINT_ZERO_INTRO_CONTENT.subtitleKey, null, t)
      : content.subtitleKey
        ? translatePaywallSubtitle(content.subtitleKey, content.subtitleFeatureKey, t)
        : null;
  const failureMessageKey = paywallFailureMessageKey(failureReason, failureOperation);
  const failureMessage = phase === 'failure' && failureMessageKey
    ? translatePaywallFailure(failureMessageKey, t)
    : null;
  const annualSavings = calculateAnnualSavings(orderedPackages);
  const showSocialProof = !isIntro && shouldShowPaywallSocialProof(orderedPackages);
  const heroHeight = Math.min(184, Math.max(120, Math.round(height * 0.22)));

  useEffect(() => {
    if (selectedPackage?.packageType === 'MONTHLY') setMonthlyVisible(true);
  }, [selectedPackage?.packageType]);

  const displayedPackages = orderedPackages.filter((item) => (
    item.packageType !== 'MONTHLY' || monthlyVisible
  ));

  return (
    <View
      testID="paywall-screen"
      style={[
        styles.screen,
        { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, Space.md) },
      ]}
    >
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
            <X size={IconSize.sm} color={theme.colors.inkTertiary} strokeWidth={2.2} />
          </View>
        </Pressable>
        {!isIntro ? (
          <Pressable
            testID="paywall-restore"
            accessibilityRole="button"
            accessibilityLabel={t('Restore Purchases')}
            accessibilityState={{ disabled: interactionLocked || restoreDisabled, busy: phase === 'restoring' }}
            disabled={interactionLocked || restoreDisabled}
            onPress={onRestore}
            style={({ pressed }) => [styles.restoreButton, pressed ? styles.pressed : null]}
          >
            {phase === 'restoring' ? (
              <ActivityIndicator size="small" color={theme.colors.inkSecondary} />
            ) : (
              <>
                <RotateCcw size={IconSize.sm} color={theme.colors.inkSecondary} strokeWidth={2} />
                <Text style={styles.restoreText}>{t('Restore Purchases')}</Text>
              </>
            )}
          </Pressable>
        ) : <View style={styles.headerButton} />}
      </View>

      <ScrollView
        testID="paywall-benefits-scroll"
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        <View
          testID={`paywall-hero-${hero}`}
          accessible={false}
          style={[styles.hero, { height: heroHeight }]}
        >
          <View style={[styles.heroOrb, styles.heroOrbLeft, { backgroundColor: theme.colors.accent }]} />
          <View style={[styles.heroOrb, styles.heroOrbRight, { backgroundColor: theme.colors.accent }]} />
          <View style={[styles.heroOrbSmall, { backgroundColor: theme.colors.accent }]} />
          <PaywallHeroArtwork hero={hero} success={isSuccess} styles={styles} />
        </View>

        <View style={styles.heading}>
          <Text testID="paywall-title" style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>

        {!isSuccess ? (
          <View testID="paywall-benefits" style={styles.benefits}>
            {benefits.map((benefit) => {
              const BenefitIcon = BENEFIT_ICONS[benefit.kind];
              return (
                <View key={benefit.labelKey} style={styles.benefitRow}>
                  <BenefitIcon size={18} color={theme.colors.accent} strokeWidth={2} />
                  <Text style={styles.benefitText}>{translatePaywallBenefit(benefit.labelKey, t)}</Text>
                </View>
              );
            })}
          </View>
        ) : null}

        {showSocialProof && !isSuccess ? (
          <Text testID="paywall-social-proof" style={styles.socialProof} numberOfLines={2}>
            {t('★★★★★ {{rating}} · “{{quote}}”', {
              rating: publicPaywallSocialProof.rating,
              quote: translateSocialProofQuote(publicPaywallSocialProof.quote, t),
            })}
          </Text>
        ) : null}
      </ScrollView>

      <View pointerEvents={interactionLocked ? 'none' : 'auto'} style={styles.footer}>
        {isIntro ? (
          <Button
            testID="paywall-intro-continue"
            label={t('Continue')}
            size="lg"
            onPress={onCompleteIntro}
          />
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
              <View style={styles.plans}>
                {displayedPackages.map((item) => (
                  <PaywallPlanCard
                    key={item.packageIdentifier}
                    testID={`paywall-plan-${item.packageType.toLowerCase()}`}
                    title={formatPackageTitle(item.packageType, t)}
                    price={item.priceString}
                    detail={formatPackageDetail(item, annualSavings, t)}
                    badge={item.packageType === 'ANNUAL' ? t('Best value') : null}
                    selected={item.packageIdentifier === selectedPackageId}
                    disabled={disabledPackageIds.includes(item.packageIdentifier)}
                    onPress={() => onSelectPackage(item.packageIdentifier)}
                  />
                ))}
              </View>
            )}

            {!monthlyVisible && orderedPackages.some((item) => item.packageType === 'MONTHLY') ? (
              <Pressable
                testID="paywall-show-monthly"
                accessibilityRole="button"
                onPress={() => setMonthlyVisible(true)}
                style={({ pressed }) => [styles.monthlyButton, pressed ? styles.pressed : null]}
              >
                <Text style={styles.monthlyText}>{t('View monthly plan')}</Text>
              </Pressable>
            ) : null}

            {failureMessage ? (
              <Text testID="paywall-failure" style={styles.failureText}>{failureMessage}</Text>
            ) : null}

            <Button
              testID="paywall-purchase"
              label={formatPurchaseLabel(selectedPackage, content.actionKey, t)}
              size="lg"
              loading={phase === 'purchasing'}
              disabled={purchaseDisabled || phase === 'loading' || phase === 'unavailable' || !selectedPackage}
              onPress={onPurchase}
            />

            <View style={styles.legalRow}>
              <Text style={styles.legalText}>
                {Platform.OS === 'android'
                  ? t('Cancel anytime in Google Play')
                  : t('Cancel anytime in the App Store')}
              </Text>
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
    </View>
  );
}

function PaywallHeroArtwork({
  hero,
  success,
  styles,
}: Readonly<{
  hero: PaywallHero;
  success: boolean;
  styles: ReturnType<typeof createStyles>;
}>): React.JSX.Element {
  const { theme } = useAppTheme();

  if (success) {
    return (
      <View testID="paywall-hero-success" style={styles.heroIconSurface}>
        <Check size={40} color={theme.colors.good} strokeWidth={2.4} />
      </View>
    );
  }

  switch (hero) {
    case 'connections':
      return (
        <View testID="paywall-hero-connections-link" style={styles.heroArtworkRow}>
          <AgentAvatar agentId="openclaw" name="OpenClaw" variant="settings" />
          <View style={[styles.heroConnectionLink, { backgroundColor: theme.colors.accent }]}>
            <View style={[styles.heroConnectionDot, { backgroundColor: theme.colors.accent }]} />
          </View>
          <View style={styles.heroIconSurface}>
            <Network size={IconSize.lg} color={theme.colors.ink} strokeWidth={2} />
          </View>
          <View style={[styles.heroConnectionLink, { backgroundColor: theme.colors.accent }]}>
            <View style={[styles.heroConnectionDot, { backgroundColor: theme.colors.accent }]} />
          </View>
          <AgentAvatar agentId="hermes" name="Hermes" variant="settings" />
        </View>
      );
    case 'agents':
      return (
        <View testID="paywall-hero-agents-cluster" style={styles.heroAgentCluster}>
          <AgentAvatar
            agentId="research"
            name="Research"
            variant="settings"
            style={styles.heroAgentLeft}
          />
          <AgentAvatar agentId="main" name="Main" variant="roster" style={styles.heroAgentCenter} />
          <AgentAvatar
            agentId="builder"
            name="Builder"
            variant="settings"
            style={styles.heroAgentRight}
          />
        </View>
      );
    case 'manage':
      return (
        <View testID="paywall-hero-manage-repair-loop" style={styles.heroArtworkRow}>
          <View style={[styles.heroSatelliteSurface, { backgroundColor: theme.colors.goodSoft }]}>
            <Check size={IconSize.md} color={theme.colors.good} strokeWidth={2.2} />
          </View>
          <View style={styles.heroIconSurface}>
            <Wrench size={40} color={theme.colors.ink} strokeWidth={2} />
          </View>
          <View style={[styles.heroSatelliteSurface, { backgroundColor: theme.colors.accentSoft }]}>
            <RotateCcw size={IconSize.md} color={theme.colors.accent} strokeWidth={2.2} />
          </View>
        </View>
      );
    case 'logsFiles':
      return (
        <View testID="paywall-hero-logs-files-stack" style={styles.heroDocumentStack}>
          <View style={styles.heroDocumentCard}>
            <Files size={IconSize.lg} color={theme.colors.ink} strokeWidth={2} />
            <View style={[styles.heroDocumentLine, { backgroundColor: theme.colors.inkTertiary }]} />
            <View style={[styles.heroDocumentLineShort, { backgroundColor: theme.colors.inkTertiary }]} />
          </View>
          <View style={[styles.heroDocumentCard, styles.heroDocumentCardRaised]}>
            <View style={styles.heroLogRow}>
              <View style={[styles.heroLogDot, { backgroundColor: theme.colors.good }]} />
              <View style={[styles.heroLogLine, { backgroundColor: theme.colors.inkSecondary }]} />
            </View>
            <View style={styles.heroLogRow}>
              <View style={[styles.heroLogDot, { backgroundColor: theme.colors.accent }]} />
              <View style={[styles.heroLogLineShort, { backgroundColor: theme.colors.inkSecondary }]} />
            </View>
            <View style={styles.heroLogRow}>
              <View style={[styles.heroLogDot, { backgroundColor: theme.colors.warn }]} />
              <View style={[styles.heroLogLine, { backgroundColor: theme.colors.inkSecondary }]} />
            </View>
          </View>
        </View>
      );
    case 'search':
      return (
        <View testID="paywall-hero-search-results" style={styles.heroSearchArtwork}>
          <View style={styles.heroSearchResults}>
            <View style={styles.heroSearchRow}>
              <View style={[styles.heroSearchAvatar, { backgroundColor: theme.colors.accent }]} />
              <View style={[styles.heroSearchLine, { backgroundColor: theme.colors.inkTertiary }]} />
            </View>
            <View style={styles.heroSearchRow}>
              <View style={[styles.heroSearchAvatar, { backgroundColor: theme.colors.good }]} />
              <View style={[styles.heroSearchLineShort, { backgroundColor: theme.colors.inkTertiary }]} />
            </View>
            <View style={styles.heroSearchRow}>
              <View style={[styles.heroSearchAvatar, { backgroundColor: theme.colors.warn }]} />
              <View style={[styles.heroSearchLine, { backgroundColor: theme.colors.inkTertiary }]} />
            </View>
          </View>
          <View style={styles.heroSearchLens}>
            <Search size={40} color={theme.colors.ink} strokeWidth={2.2} />
          </View>
        </View>
      );
    case 'generic':
      return (
        <View testID="paywall-hero-generic-control-tower" style={styles.heroArtworkRow}>
          <View style={styles.heroAvatarColumn}>
            <AgentAvatar agentId="writer" name="Writer" variant="sheet" />
            <AgentAvatar agentId="operator" name="Operator" variant="sheet" />
          </View>
          <View style={styles.heroIconSurface}>
            <Sparkles size={40} color={theme.colors.ink} strokeWidth={2} />
          </View>
          <View style={styles.heroAvatarColumn}>
            <AgentAvatar agentId="designer" name="Designer" variant="sheet" />
            <AgentAvatar agentId="analyst" name="Analyst" variant="sheet" />
          </View>
        </View>
      );
  }
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
  annualSavings: number | null,
  t: Translate,
): string | null {
  if (item.packageType === 'LIFETIME') return t('One-time purchase');
  if (item.packageType === 'MONTHLY') return t('Billed monthly');
  if (item.packageType !== 'ANNUAL' || !item.pricePerMonthString) return null;
  return annualSavings == null
    ? t('{{price}} / month', { price: item.pricePerMonthString })
    : t('{{price}} / month · Save {{savings}}%', {
      price: item.pricePerMonthString,
      savings: annualSavings,
    });
}

function formatPurchaseLabel(
  selectedPackage: ProPaywallPackage | null,
  actionKey: PaywallActionKey | null,
  t: Translate,
): string {
  if (actionKey) {
    return t('Unlock Pro to continue {{action}}', { action: translatePaywallAction(actionKey, t) });
  }
  if (!selectedPackage) return t('Unlock Pro');
  if (selectedPackage.packageType === 'ANNUAL') {
    return t('Unlock Pro · {{price}} / year', { price: selectedPackage.priceString });
  }
  if (selectedPackage.packageType === 'MONTHLY') {
    return t('Unlock Pro · {{price}} / month', { price: selectedPackage.priceString });
  }
  return t('Unlock Pro · {{price}}', { price: selectedPackage.priceString });
}

function translatePaywallTitle(key: PaywallTitleKey, t: Translate): string {
  switch (key) {
    case 'Clawket 3.0': return t('Clawket 3.0');
    case 'Every Agent in your pocket': return t('Every Agent in your pocket');
    case 'Bring every Agent into the roster': return t('Bring every Agent into the roster');
    case 'Fix your OpenClaw from your phone': return t('Fix your OpenClaw from your phone');
    case 'Read logs and edit files without going back to your computer':
      return t('Read logs and edit files without going back to your computer');
    case 'Find any message again': return t('Find any message again');
  }
}

function translatePaywallSubtitle(
  key: PaywallSubtitleKey,
  featureKey: PaywallSubtitleFeatureKey | null,
  t: Translate,
): string {
  switch (key) {
    case 'Your agent control tower, rebuilt.':
      return t('Your agent control tower, rebuilt.');
    case 'OpenClaw and Hermes together, ready whenever you are.':
      return t('OpenClaw and Hermes together, ready whenever you are.');
    case 'Agents beyond main are a Pro feature.':
      return t('Agents beyond main are a Pro feature.');
    case 'Message details across sessions are a Pro feature.':
      return t('Message details across sessions are a Pro feature.');
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
    case 'Fix OpenClaw from your phone': return t('Fix OpenClaw from your phone');
    case 'Logs, files, and search': return t('Logs, files, and search');
    case 'Unlimited connections and Agents': return t('Unlimited connections and Agents');
    case 'One-tap permission and diagnostic fixes': return t('One-tap permission and diagnostic fixes');
    case 'Unlimited connections': return t('Unlimited connections');
    case 'Unlimited Agents': return t('Unlimited Agents');
    case 'Logs and file editing': return t('Logs and file editing');
    case 'Search across sessions and favorites': return t('Search across sessions and favorites');
    case 'Every Agent and session in one roster': return t('Every Agent and session in one roster');
    case 'OpenClaw and Hermes side by side': return t('OpenClaw and Hermes side by side');
    case 'Search across every conversation': return t('Search across every conversation');
    case 'Manage, diagnose, and repair from your phone':
      return t('Manage, diagnose, and repair from your phone');
  }
}

function translatePaywallAction(key: PaywallActionKey, t: Translate): string {
  switch (key) {
    case 'adding another connection': return t('adding another connection');
    case 'with this Agent': return t('with this Agent');
    case 'managing OpenClaw': return t('managing OpenClaw');
    case 'viewing logs': return t('viewing logs');
    case 'editing this file': return t('editing this file');
    case 'opening this message': return t('opening this message');
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

function translateSocialProofQuote(quote: string, t: Translate): string {
  return quote === 'Updated quickly, always stays ahead'
    ? t('Updated quickly, always stays ahead')
    : quote;
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.canvas },
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
      backgroundColor: colors.surface,
    },
    restoreButton: {
      minHeight: HitSize.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: Space.xs,
      paddingLeft: Space.md,
    },
    restoreText: {
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.semibold,
    },
    pressed: { opacity: 0.65 },
    scroll: { flex: 1 },
    scrollContent: { paddingHorizontal: Space.xl, paddingBottom: Space.md, gap: Space.lg },
    hero: {
      borderRadius: Radius.card,
      backgroundColor: colors.surface,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroOrb: { position: 'absolute', width: 112, height: 112, borderRadius: Radius.full, opacity: 0.22 },
    heroOrbLeft: { left: -Space.xxl, bottom: -Space.xl },
    heroOrbRight: { right: -Space.xl, top: -Space.xxl },
    heroOrbSmall: { position: 'absolute', width: 48, height: 48, borderRadius: Radius.full, opacity: 0.2, left: '54%', top: Space.md },
    heroIconSurface: {
      width: 76,
      height: 76,
      borderRadius: Radius.xl,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceFloating,
    },
    heroArtworkRow: {
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.sm,
    },
    heroConnectionLink: {
      width: Space.xxl,
      height: Space.xs,
      borderRadius: Radius.full,
      justifyContent: 'center',
      opacity: 0.4,
    },
    heroConnectionDot: {
      width: Space.sm,
      height: Space.sm,
      borderRadius: Radius.full,
      alignSelf: 'center',
    },
    heroAgentCluster: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.sm,
    },
    heroAgentLeft: { transform: [{ rotate: '-8deg' }] },
    heroAgentCenter: { transform: [{ translateY: -Space.sm }] },
    heroAgentRight: { transform: [{ rotate: '8deg' }] },
    heroSatelliteSurface: {
      width: ControlSize.floatingButton,
      height: ControlSize.floatingButton,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroDocumentStack: {
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.md,
    },
    heroDocumentCard: {
      width: 112,
      height: 84,
      borderRadius: Radius.card,
      padding: Space.md,
      justifyContent: 'center',
      gap: Space.sm,
      backgroundColor: colors.surfaceFloating,
    },
    heroDocumentCardRaised: { transform: [{ translateY: -Space.sm }] },
    heroDocumentLine: {
      width: '72%',
      height: Space.xs,
      borderRadius: Radius.full,
      opacity: 0.44,
    },
    heroDocumentLineShort: {
      width: '46%',
      height: Space.xs,
      borderRadius: Radius.full,
      opacity: 0.34,
    },
    heroLogRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
    heroLogDot: { width: Space.sm, height: Space.sm, borderRadius: Radius.full },
    heroLogLine: {
      flex: 1,
      height: Space.xs,
      borderRadius: Radius.full,
      opacity: 0.44,
    },
    heroLogLineShort: {
      width: '48%',
      height: Space.xs,
      borderRadius: Radius.full,
      opacity: 0.34,
    },
    heroSearchArtwork: {
      width: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroSearchResults: {
      width: '62%',
      borderRadius: Radius.card,
      padding: Space.md,
      gap: Space.sm,
      backgroundColor: colors.surfaceFloating,
    },
    heroSearchRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
    heroSearchAvatar: {
      width: Space.lg,
      height: Space.lg,
      borderRadius: Radius.avatarHeader,
    },
    heroSearchLine: {
      flex: 1,
      height: Space.xs,
      borderRadius: Radius.full,
      opacity: 0.38,
    },
    heroSearchLineShort: {
      width: '46%',
      height: Space.xs,
      borderRadius: Radius.full,
      opacity: 0.3,
    },
    heroSearchLens: {
      position: 'absolute',
      right: '14%',
      width: 68,
      height: 68,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceFloating,
    },
    heroAvatarColumn: { gap: Space.sm },
    heading: { gap: Space.xs },
    title: {
      color: colors.ink,
      fontSize: FontSize.display,
      lineHeight: LineHeight.display,
      fontWeight: FontWeight.semibold,
    },
    subtitle: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
    },
    benefits: { gap: Space.xs },
    benefitRow: {
      minHeight: Space.xxl,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
    },
    benefitText: {
      flex: 1,
      color: colors.ink,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
    },
    socialProof: {
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.regular,
    },
    footer: { paddingHorizontal: Space.xl, gap: Space.sm },
    plans: { gap: Space.sm },
    planSkeleton: { minHeight: ControlSize.settingsRow },
    unavailable: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
    feedbackText: {
      flex: 1,
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.regular,
    },
    monthlyButton: { minHeight: HitSize.sm, alignSelf: 'center', justifyContent: 'center', paddingHorizontal: Space.md },
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
    legalText: { color: colors.inkTertiary, fontSize: FontSize.caption, lineHeight: LineHeight.caption, fontWeight: FontWeight.regular },
    legalLink: { minHeight: HitSize.sm, justifyContent: 'center', paddingHorizontal: Space.xs },
    legalLinkText: { color: colors.inkSecondary, fontSize: FontSize.caption, lineHeight: LineHeight.caption, fontWeight: FontWeight.regular },
    successProgress: { height: Space.xs, borderRadius: Radius.full, backgroundColor: colors.good },
  });
}
