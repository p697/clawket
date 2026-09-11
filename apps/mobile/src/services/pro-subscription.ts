import { Platform } from 'react-native';
import Purchases, {
  type CustomerInfo,
  PURCHASES_ERROR_CODE,
  type PurchasesError,
  type PurchasesOffering,
  type PurchasesOfferings,
  type PurchasesPackage,
} from 'react-native-purchases';
import { publicRevenueCatConfig, resolvePublicRevenueCatConfig } from '../config/public';

export type RevenueCatConfig = {
  apiKey: string;
  entitlementId: string;
  offeringId?: string;
  packageId?: string;
};

const PRIMARY_PAYWALL_PACKAGE_TYPES = [
  'ANNUAL',
  'LIFETIME',
  'MONTHLY',
] as const;

export type ProOfferingMetadata = Readonly<{
  defaultPackage: 'annual' | 'monthly';
  socialProof: boolean;
}>;

export const DEFAULT_PRO_OFFERING_METADATA: ProOfferingMetadata = {
  defaultPackage: 'annual',
  socialProof: true,
};

const LIFETIME_UPGRADE_CUTOFF_PACIFIC_ISO = '2026-04-18T07:00:00.000Z';
const LIFETIME_UPGRADE_CUTOFF_PACIFIC_MS = Date.parse(LIFETIME_UPGRADE_CUTOFF_PACIFIC_ISO);

function isPrimaryPaywallPackageType(packageType: string): boolean {
  return PRIMARY_PAYWALL_PACKAGE_TYPES.includes(packageType as typeof PRIMARY_PAYWALL_PACKAGE_TYPES[number]);
}

function includesAnnualIdentifier(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized.includes('year')
    || normalized.includes('annual')
    || normalized.includes('annually');
}

function includesLifetimeIdentifier(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized.includes('life')
    || normalized.includes('forever')
    || normalized.includes('permanent');
}

export type ProSubscriptionSnapshot = {
  isActive: boolean;
  entitlementId: string;
  productIdentifier: string | null;
  productPlanIdentifier: string | null;
  activeSubscriptionProductIdentifiers: string[];
  purchasedProductIdentifiers: string[];
  nonSubscriptionProductIdentifiers: string[];
  originalPurchaseDate: string | null;
  latestPurchaseDate: string | null;
  expirationDate: string | null;
  willRenew: boolean;
  store: string | null;
  managementURL: string | null;
  originalAppUserId: string | null;
  requestDate: string | null;
  verification: string | null;
};

export function getProSubscriptionExpirationMs(
  snapshot: ProSubscriptionSnapshot | null,
): number | null {
  if (!snapshot?.isActive || snapshot.expirationDate === null) return null;
  if (typeof snapshot.expirationDate !== 'string') return 0;
  const expirationMs = Date.parse(snapshot.expirationDate);
  return Number.isFinite(expirationMs) ? expirationMs : 0;
}

export function isProSubscriptionSnapshotActiveAt(
  snapshot: ProSubscriptionSnapshot | null,
  now: number,
): boolean {
  if (!snapshot?.isActive || !Number.isFinite(now)) return false;
  const expirationMs = getProSubscriptionExpirationMs(snapshot);
  return expirationMs === null || now < expirationMs;
}

export function normalizeProSubscriptionSnapshotAt(
  snapshot: ProSubscriptionSnapshot | null,
  now: number,
): ProSubscriptionSnapshot | null {
  if (!snapshot?.isActive || isProSubscriptionSnapshotActiveAt(snapshot, now)) return snapshot;
  return { ...snapshot, isActive: false };
}

export type ProPaywallPackage = {
  offeringIdentifier: string;
  packageIdentifier: string;
  packageType: string;
  productIdentifier: string | null;
  title: string;
  description: string;
  price: number | null;
  priceString: string;
  pricePerMonth: number | null;
  pricePerMonthString: string | null;
  offeringMetadata: ProOfferingMetadata;
  package: PurchasesPackage;
};

export type ProPurchaseResult = {
  customerInfo: CustomerInfo;
  snapshot: ProSubscriptionSnapshot;
};

export type ProPurchaseErrorCode =
  | 'cancelled'
  | 'pending'
  | 'purchaseUnavailable'
  | 'notConfigured'
  | 'unknown';

export type ProPurchaseFailureReason =
  | 'cancelled'
  | 'pending'
  | 'offerings_unavailable'
  | `store_error:${string}`;

export type RevenueCatDiagnostics = {
  buildEnabled: boolean;
  iosApiKeyMasked: string | null;
  entitlementId: string | null;
  offeringId: string | null;
  packageId: string | null;
  runtimeConfigResolved: boolean;
  runtimeApiKeyMasked: string | null;
  keySource: 'test' | 'platform' | 'none';
  purchasesIsConfigured: boolean | null;
  ensureConfiguredStatus: 'configured' | 'not_configured' | 'error';
  ensureConfiguredError: string | null;
  customerInfoStatus: 'ok' | 'not_configured' | 'error';
  customerInfoError: string | null;
  appUserId: string | null;
  snapshotProductIdentifier: string | null;
  snapshotProductPlanIdentifier: string | null;
  activeSubscriptionProductIdentifiers: string[];
  purchasedProductIdentifiers: string[];
  nonSubscriptionProductIdentifiers: string[];
  offeringsStatus: 'ok' | 'not_configured' | 'error';
  offeringsCount: number | null;
  offeringsError: string | null;
  lastUpdatedAt: string | null;
};

let configurePromise: Promise<RevenueCatConfig | null> | null = null;
const RETRY_DELAY_MS = 900;

function isDevRuntime(): boolean {
  return typeof __DEV__ !== 'undefined' ? __DEV__ : false;
}

function trimEnv(value: string | undefined | null): string {
  return value?.trim() ?? '';
}

function normalizeIdentifiers(values: Array<string | null | undefined>): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) unique.add(normalized);
  }
  return [...unique];
}

function maskSecret(value: string | null | undefined): string | null {
  const trimmed = trimEnv(value);
  if (!trimmed) return null;
  if (trimmed.length <= 10) return '***';
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

function formatDiagnosticError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createRevenueCatDiagnosticsBase(): RevenueCatDiagnostics {
  const resolvedConfig = resolveRevenueCatConfig();
  const testApiKey = trimEnv(publicRevenueCatConfig.testApiKey);
  const keySource = resolvedConfig
    ? isDevRuntime() && testApiKey
      ? 'test'
      : 'platform'
    : 'none';

  return {
    buildEnabled: publicRevenueCatConfig.enabled,
    iosApiKeyMasked: maskSecret(publicRevenueCatConfig.iosApiKey),
    entitlementId: trimEnv(publicRevenueCatConfig.entitlementId) || null,
    offeringId: trimEnv(publicRevenueCatConfig.offeringId) || null,
    packageId: trimEnv(publicRevenueCatConfig.packageId) || null,
    runtimeConfigResolved: Boolean(resolvedConfig),
    runtimeApiKeyMasked: maskSecret(resolvedConfig?.apiKey),
    keySource,
    purchasesIsConfigured: null,
    ensureConfiguredStatus: 'not_configured',
    ensureConfiguredError: null,
    customerInfoStatus: 'not_configured',
    customerInfoError: null,
    appUserId: null,
    snapshotProductIdentifier: null,
    snapshotProductPlanIdentifier: null,
    activeSubscriptionProductIdentifiers: [],
    purchasedProductIdentifiers: [],
    nonSubscriptionProductIdentifiers: [],
    offeringsStatus: 'not_configured',
    offeringsCount: null,
    offeringsError: null,
    lastUpdatedAt: null,
  };
}

let runtimeRevenueCatDiagnostics: RevenueCatDiagnostics = createRevenueCatDiagnosticsBase();

function updateRevenueCatDiagnostics(patch: Partial<RevenueCatDiagnostics>): void {
  runtimeRevenueCatDiagnostics = {
    ...createRevenueCatDiagnosticsBase(),
    ...runtimeRevenueCatDiagnostics,
    ...patch,
    lastUpdatedAt: new Date().toISOString(),
  };
}

function logRevenueCatDiagnostic(event: string, details: Record<string, unknown>): void {
  try {
    console.info(`[RevenueCatDiag] ${event} ${JSON.stringify(details)}`);
  } catch {
    console.info(`[RevenueCatDiag] ${event}`);
  }
}

async function retryOnce<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    await delay(RETRY_DELAY_MS);
    return operation().catch(() => {
      throw error;
    });
  }
}

export function resolveRevenueCatConfig(
  platformOS: string = Platform.OS,
  env: NodeJS.ProcessEnv = process.env,
): RevenueCatConfig | null {
  const config = env === process.env ? publicRevenueCatConfig : resolvePublicRevenueCatConfig(env);
  if (!config.enabled) return null;
  const testApiKey = trimEnv(config.testApiKey);
  const platformApiKey = platformOS === 'ios'
    ? trimEnv(config.iosApiKey)
    : platformOS === 'android'
      ? trimEnv(config.androidApiKey)
      : '';
  const apiKey = isDevRuntime() && testApiKey ? testApiKey : platformApiKey;
  const entitlementId = trimEnv(config.entitlementId);
  const offeringId = trimEnv(config.offeringId);
  const packageId = trimEnv(config.packageId);

  if (!apiKey || !entitlementId) return null;

  return {
    apiKey,
    entitlementId,
    offeringId: offeringId || undefined,
    packageId: packageId || undefined,
  };
}

export async function ensureRevenueCatConfigured(): Promise<RevenueCatConfig | null> {
  const config = resolveRevenueCatConfig();
  if (!config) {
    const purchasesIsConfigured = await Purchases.isConfigured().catch(() => null);
    updateRevenueCatDiagnostics({
      purchasesIsConfigured,
      ensureConfiguredStatus: 'not_configured',
      ensureConfiguredError: null,
    });
    logRevenueCatDiagnostic('ensure:not_configured', {
      buildEnabled: publicRevenueCatConfig.enabled,
      runtimeConfigResolved: false,
      keySource: runtimeRevenueCatDiagnostics.keySource,
    });
    return null;
  }

  if (!configurePromise) {
    configurePromise = (async () => {
      const isConfigured = await Purchases.isConfigured().catch(() => false);
      updateRevenueCatDiagnostics({
        purchasesIsConfigured: isConfigured,
        ensureConfiguredStatus: 'configured',
        ensureConfiguredError: null,
      });
      logRevenueCatDiagnostic('ensure:start', {
        alreadyConfigured: isConfigured,
        keySource: isDevRuntime() && trimEnv(publicRevenueCatConfig.testApiKey) ? 'test' : 'platform',
        runtimeKey: maskSecret(config.apiKey),
      });
      if (!isConfigured) {
        Purchases.configure({
          apiKey: config.apiKey,
          entitlementVerificationMode: Purchases.ENTITLEMENT_VERIFICATION_MODE.INFORMATIONAL,
          storeKitVersion: Purchases.STOREKIT_VERSION.DEFAULT,
        });
      }
      void Purchases.setLogLevel(isDevRuntime() ? Purchases.LOG_LEVEL.DEBUG : Purchases.LOG_LEVEL.WARN).catch(() => {
        // Log level is non-critical. A transient failure here should not make RevenueCat look unconfigured.
      });
      updateRevenueCatDiagnostics({
        purchasesIsConfigured: true,
        ensureConfiguredStatus: 'configured',
        ensureConfiguredError: null,
      });
      logRevenueCatDiagnostic('ensure:configured', {
        runtimeKey: maskSecret(config.apiKey),
        entitlementId: config.entitlementId,
        offeringId: config.offeringId ?? null,
      });
      return config;
    })().catch((error) => {
      updateRevenueCatDiagnostics({
        ensureConfiguredStatus: 'error',
        ensureConfiguredError: formatDiagnosticError(error),
      });
      logRevenueCatDiagnostic('ensure:error', {
        error: formatDiagnosticError(error),
      });
      configurePromise = null;
      throw error;
    });
  }

  return configurePromise;
}

export async function collectRevenueCatDiagnostics(): Promise<RevenueCatDiagnostics> {
  const diagnostics: RevenueCatDiagnostics = {
    ...runtimeRevenueCatDiagnostics,
    ...createRevenueCatDiagnosticsBase(),
  };

  diagnostics.purchasesIsConfigured = await Purchases.isConfigured().catch(() => null);

  try {
    const config = await ensureRevenueCatConfigured();
    if (!config) {
      diagnostics.ensureConfiguredStatus = 'not_configured';
      return diagnostics;
    }
    diagnostics.ensureConfiguredStatus = 'configured';
    diagnostics.runtimeApiKeyMasked = maskSecret(config.apiKey);
  } catch (error) {
    diagnostics.ensureConfiguredStatus = 'error';
    diagnostics.ensureConfiguredError = formatDiagnosticError(error);
    return diagnostics;
  }

  try {
    const result = await ProSubscriptionService.getCustomerInfo();
    if (!result) {
      diagnostics.customerInfoStatus = 'not_configured';
    } else {
      diagnostics.customerInfoStatus = 'ok';
      diagnostics.appUserId = result.snapshot.originalAppUserId;
      diagnostics.snapshotProductIdentifier = result.snapshot.productIdentifier;
      diagnostics.snapshotProductPlanIdentifier = result.snapshot.productPlanIdentifier;
      diagnostics.activeSubscriptionProductIdentifiers = result.snapshot.activeSubscriptionProductIdentifiers;
      diagnostics.purchasedProductIdentifiers = result.snapshot.purchasedProductIdentifiers;
      diagnostics.nonSubscriptionProductIdentifiers = result.snapshot.nonSubscriptionProductIdentifiers;
    }
  } catch (error) {
    diagnostics.customerInfoStatus = 'error';
    diagnostics.customerInfoError = formatDiagnosticError(error);
  }

  try {
    const packages = await ProSubscriptionService.getPaywallPackages();
    diagnostics.offeringsStatus = 'ok';
    diagnostics.offeringsCount = packages.length;
  } catch (error) {
    diagnostics.offeringsStatus = 'error';
    diagnostics.offeringsError = formatDiagnosticError(error);
  }

  return diagnostics;
}

export function getRevenueCatRuntimeDiagnostics(): RevenueCatDiagnostics {
  return {
    ...createRevenueCatDiagnosticsBase(),
    ...runtimeRevenueCatDiagnostics,
  };
}

export function deriveProSubscriptionSnapshot(
  customerInfo: CustomerInfo,
  entitlementId: string,
): ProSubscriptionSnapshot {
  const activeEntitlement = customerInfo.entitlements.active[entitlementId] ?? null;
  const entitlement = activeEntitlement
    ?? customerInfo.entitlements.all[entitlementId]
    ?? null;

  return {
    isActive: Boolean(activeEntitlement?.isActive),
    entitlementId,
    productIdentifier: activeEntitlement?.productIdentifier ?? entitlement?.productIdentifier ?? null,
    productPlanIdentifier: activeEntitlement?.productPlanIdentifier ?? entitlement?.productPlanIdentifier ?? null,
    activeSubscriptionProductIdentifiers: normalizeIdentifiers(customerInfo.activeSubscriptions ?? []),
    purchasedProductIdentifiers: normalizeIdentifiers(customerInfo.allPurchasedProductIdentifiers ?? []),
    nonSubscriptionProductIdentifiers: normalizeIdentifiers(
      (customerInfo.nonSubscriptionTransactions ?? []).map((item) => item.productIdentifier),
    ),
    originalPurchaseDate: activeEntitlement?.originalPurchaseDate ?? entitlement?.originalPurchaseDate ?? customerInfo.originalPurchaseDate ?? null,
    latestPurchaseDate: activeEntitlement?.latestPurchaseDate ?? entitlement?.latestPurchaseDate ?? null,
    expirationDate: activeEntitlement?.expirationDate ?? entitlement?.expirationDate ?? null,
    willRenew: activeEntitlement?.willRenew ?? entitlement?.willRenew ?? false,
    store: activeEntitlement?.store ?? entitlement?.store ?? null,
    managementURL: customerInfo.managementURL ?? null,
    originalAppUserId: customerInfo.originalAppUserId ?? null,
    requestDate: customerInfo.requestDate ?? null,
    verification: activeEntitlement?.verification ?? entitlement?.verification ?? customerInfo.entitlements.verification ?? null,
  };
}

export function selectRevenueCatOffering(
  offerings: PurchasesOfferings,
  config: RevenueCatConfig,
): PurchasesOffering | null {
  const configuredOfferingId = config.offeringId?.trim();
  const configuredCustomOffering = configuredOfferingId
    && configuredOfferingId !== 'default'
    && configuredOfferingId !== 'pro'
    ? offerings.all[configuredOfferingId] ?? null
    : null;
  return configuredCustomOffering
    ?? offerings.current
    ?? offerings.all.pro
    ?? (configuredOfferingId ? offerings.all[configuredOfferingId] ?? null : null);
}

export function resolveProOfferingMetadata(
  offering: Pick<PurchasesOffering, 'metadata'> | null | undefined,
): ProOfferingMetadata {
  const defaultPackageValue = offering?.metadata?.default_package;
  const socialProofValue = offering?.metadata?.social_proof;
  return {
    defaultPackage: typeof defaultPackageValue === 'string'
      && defaultPackageValue.trim().toLowerCase() === 'monthly'
      ? 'monthly'
      : 'annual',
    socialProof: typeof socialProofValue === 'boolean'
      ? socialProofValue
      : DEFAULT_PRO_OFFERING_METADATA.socialProof,
  };
}

export function selectRevenueCatPackages(
  offerings: PurchasesOfferings,
  config: RevenueCatConfig,
): PurchasesPackage[] {
  const offering = selectRevenueCatOffering(offerings, config);
  if (!offering) return [];

  const prioritized = [
    offering.annual,
    offering.lifetime,
    offering.monthly,
    ...offering.availablePackages,
  ].filter((item): item is PurchasesPackage => Boolean(item));

  const unique = prioritized.filter((item, index, array) => (
    array.findIndex((candidate) => candidate.identifier === item.identifier) === index
  ));

  const primaryPaywallPackages = unique.filter((item) => isPrimaryPaywallPackageType(item.packageType));

  if (primaryPaywallPackages.length > 0) {
    return primaryPaywallPackages;
  }

  const configuredFallback = config.packageId
    ? unique.find((item) => item.identifier === config.packageId) ?? null
    : null;
  return configuredFallback ? [configuredFallback] : unique.slice(0, 1);
}

export function selectDefaultRevenueCatPackage(
  packages: ProPaywallPackage[],
  _config: RevenueCatConfig,
): ProPaywallPackage | null {
  if (packages.length === 0) return null;
  const defaultPackage = packages[0]?.offeringMetadata?.defaultPackage
    ?? DEFAULT_PRO_OFFERING_METADATA.defaultPackage;
  const preferredType = defaultPackage === 'monthly' ? 'MONTHLY' : 'ANNUAL';
  return packages.find((item) => item.packageType === preferredType)
    ?? packages.find((item) => item.packageType === 'ANNUAL')
    ?? packages.find((item) => item.packageType === 'LIFETIME')
    ?? packages.find((item) => item.packageType === 'MONTHLY')
    ?? packages[0];
}

export function selectActiveRecurringRevenueCatPackage(
  packages: ProPaywallPackage[],
  snapshot: ProSubscriptionSnapshot | null,
): ProPaywallPackage | null {
  const activeSubscriptionIdentifiers = (snapshot?.activeSubscriptionProductIdentifiers ?? [])
    .map((value) => value.toLowerCase());
  if (activeSubscriptionIdentifiers.length === 0) return null;

  return packages.find((item) => {
    if (item.packageType !== 'MONTHLY' && item.packageType !== 'ANNUAL') return false;
    const packageIdentifier = item.productIdentifier?.toLowerCase();
    return Boolean(packageIdentifier && activeSubscriptionIdentifiers.includes(packageIdentifier));
  }) ?? null;
}

export function selectOwnedLifetimeRevenueCatPackage(
  packages: ProPaywallPackage[],
  snapshot: ProSubscriptionSnapshot | null,
): ProPaywallPackage | null {
  const nonSubscriptionIdentifiers = (snapshot?.nonSubscriptionProductIdentifiers ?? [])
    .map((value) => value.toLowerCase());
  if (nonSubscriptionIdentifiers.length === 0) return null;

  const exactMatch = packages.find((item) => {
    if (item.packageType !== 'LIFETIME') return false;
    const packageIdentifier = item.productIdentifier?.toLowerCase();
    return Boolean(packageIdentifier && nonSubscriptionIdentifiers.includes(packageIdentifier));
  }) ?? null;
  if (exactMatch) return exactMatch;

  return null;
}

export function selectSnapshotRevenueCatPackageByMetadata(
  packages: ProPaywallPackage[],
  snapshot: ProSubscriptionSnapshot | null,
): ProPaywallPackage | null {
  const identifiers = [snapshot?.productPlanIdentifier, snapshot?.productIdentifier]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
  if (identifiers.length === 0) return null;

  const directMatch = packages.find((item) => {
    const packageIdentifier = item.productIdentifier?.toLowerCase();
    return Boolean(packageIdentifier && identifiers.includes(packageIdentifier));
  }) ?? null;
  if (directMatch) return directMatch;

  if (identifiers.some((value) => includesLifetimeIdentifier(value))) {
    return packages.find((item) => item.packageType === 'LIFETIME') ?? null;
  }
  if (identifiers.some((value) => includesAnnualIdentifier(value))) {
    return packages.find((item) => item.packageType === 'ANNUAL') ?? null;
  }
  if (identifiers.some((value) => value.includes('month'))) {
    return packages.find((item) => item.packageType === 'MONTHLY') ?? null;
  }
  return null;
}

export function shouldDisplayGrandfatheredLifetimeUi(snapshot: ProSubscriptionSnapshot | null): boolean {
  if (!snapshot?.isActive) return false;

  const activeSubscriptionIdentifiers = (snapshot.activeSubscriptionProductIdentifiers ?? [])
    .map((value) => value.toLowerCase());
  const metadataIdentifiers = [snapshot.productPlanIdentifier, snapshot.productIdentifier]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());

  const currentPlanLooksAnnual = activeSubscriptionIdentifiers.length > 0
    ? activeSubscriptionIdentifiers.some((value) => includesAnnualIdentifier(value))
    : metadataIdentifiers.some((value) => includesAnnualIdentifier(value));
  if (!currentPlanLooksAnnual) return false;

  const startedAt = snapshot.originalPurchaseDate ?? snapshot.latestPurchaseDate;
  if (!startedAt) return false;

  const startedAtMs = Date.parse(startedAt);
  if (Number.isNaN(startedAtMs)) return false;

  return startedAtMs < LIFETIME_UPGRADE_CUTOFF_PACIFIC_MS;
}

export function selectDisplayedRevenueCatPackage(
  packages: ProPaywallPackage[],
  snapshot: ProSubscriptionSnapshot | null,
): ProPaywallPackage | null {
  if (shouldDisplayGrandfatheredLifetimeUi(snapshot)) {
    return packages.find((item) => item.packageType === 'LIFETIME') ?? null;
  }

  return selectOwnedLifetimeRevenueCatPackage(packages, snapshot)
    ?? selectActiveRecurringRevenueCatPackage(packages, snapshot);
}

export function shouldShowLifetimeUpgradeAnnouncementForSnapshot(snapshot: ProSubscriptionSnapshot | null): boolean {
  return shouldDisplayGrandfatheredLifetimeUi(snapshot);
}

export function hasLifetimeProAccess(
  packages: ProPaywallPackage[],
  snapshot: ProSubscriptionSnapshot | null,
): boolean {
  return Boolean(selectOwnedLifetimeRevenueCatPackage(packages, snapshot));
}

export function isRecurringProPackageType(packageType: string | null | undefined): boolean {
  return packageType === 'MONTHLY' || packageType === 'ANNUAL';
}

export function isRevenueCatPackagePurchaseLocked(
  targetPackage: ProPaywallPackage | null,
  packages: ProPaywallPackage[],
  snapshot: ProSubscriptionSnapshot | null,
): boolean {
  if (!targetPackage) return true;

  if (hasLifetimeProAccess(packages, snapshot) || shouldDisplayGrandfatheredLifetimeUi(snapshot)) {
    return true;
  }

  if (!snapshot?.isActive) {
    return false;
  }

  return isRecurringProPackageType(targetPackage.packageType);
}

function finitePrice(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function toProPaywallPackage(
  aPackage: PurchasesPackage,
  offeringMetadata: ProOfferingMetadata = DEFAULT_PRO_OFFERING_METADATA,
): ProPaywallPackage {
  return {
    offeringIdentifier: aPackage.presentedOfferingContext?.offeringIdentifier ?? aPackage.offeringIdentifier,
    packageIdentifier: aPackage.identifier,
    packageType: aPackage.packageType,
    productIdentifier: aPackage.product.identifier ?? null,
    title: aPackage.product.title,
    description: aPackage.product.description,
    price: finitePrice(aPackage.product.price),
    priceString: aPackage.product.priceString,
    pricePerMonth: finitePrice(aPackage.product.pricePerMonth),
    pricePerMonthString: aPackage.product.pricePerMonthString,
    offeringMetadata,
    package: aPackage,
  };
}

export function classifyProPurchaseError(error: unknown): ProPurchaseErrorCode {
  const code = (error as PurchasesError | undefined)?.code;
  if (code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return 'cancelled';
  if (code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) return 'pending';
  if (
    code === PURCHASES_ERROR_CODE.PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR
    || code === PURCHASES_ERROR_CODE.CONFIGURATION_ERROR
  ) {
    return 'purchaseUnavailable';
  }
  if (code === PURCHASES_ERROR_CODE.INVALID_CREDENTIALS_ERROR) return 'notConfigured';
  return 'unknown';
}

function normalizeStoreErrorCode(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value)
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
    .slice(0, 64);
  return normalized || null;
}

function embeddedStoreErrorCode(error: unknown): string | null {
  const candidate = error as Partial<PurchasesError> | null | undefined;
  const messages = [candidate?.underlyingErrorMessage, candidate?.message];
  for (const message of messages) {
    if (typeof message !== 'string') continue;
    const match = message.match(/\b(?:ITEM|BILLING|STORE|PRODUCT|NETWORK)_[A-Z0-9_]+\b/i);
    if (match) return normalizeStoreErrorCode(match[0]);
  }
  return null;
}

function revenueCatErrorName(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const entry = Object.entries(PURCHASES_ERROR_CODE)
    .find(([, value]) => value === code);
  return entry?.[0] ?? null;
}

export function classifyProPurchaseFailureReason(error: unknown): ProPurchaseFailureReason {
  const candidate = error as Partial<PurchasesError> | null | undefined;
  const code = candidate?.code;
  if (code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return 'cancelled';
  if (code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) return 'pending';

  const readableCode = candidate?.userInfo?.readableErrorCode
    ?? candidate?.readableErrorCode;
  const storeCode = embeddedStoreErrorCode(error)
    ?? normalizeStoreErrorCode(readableCode)
    ?? normalizeStoreErrorCode(revenueCatErrorName(code))
    ?? normalizeStoreErrorCode(code)
    ?? 'UNKNOWN';
  return `store_error:${storeCode}`;
}

export const ProSubscriptionService = {
  async getCustomerInfo(): Promise<ProPurchaseResult | null> {
    const config = await ensureRevenueCatConfigured();
    if (!config) {
      updateRevenueCatDiagnostics({
        customerInfoStatus: 'not_configured',
        customerInfoError: null,
      });
      return null;
    }
    try {
      const customerInfo = await retryOnce(() => Purchases.getCustomerInfo());
      const snapshot = deriveProSubscriptionSnapshot(customerInfo, config.entitlementId);
      updateRevenueCatDiagnostics({
        customerInfoStatus: 'ok',
        customerInfoError: null,
        appUserId: snapshot.originalAppUserId,
        snapshotProductIdentifier: snapshot.productIdentifier,
        snapshotProductPlanIdentifier: snapshot.productPlanIdentifier,
        activeSubscriptionProductIdentifiers: snapshot.activeSubscriptionProductIdentifiers,
        purchasedProductIdentifiers: snapshot.purchasedProductIdentifiers,
        nonSubscriptionProductIdentifiers: snapshot.nonSubscriptionProductIdentifiers,
      });
      logRevenueCatDiagnostic('customer_info:ok', {
        appUserId: snapshot.originalAppUserId,
        entitlementActive: snapshot.isActive,
      });
      return {
        customerInfo,
        snapshot,
      };
    } catch (error) {
      updateRevenueCatDiagnostics({
        customerInfoStatus: 'error',
        customerInfoError: formatDiagnosticError(error),
      });
      logRevenueCatDiagnostic('customer_info:error', {
        error: formatDiagnosticError(error),
      });
      throw error;
    }
  },

  async getPaywallPackages(): Promise<ProPaywallPackage[]> {
    const config = await ensureRevenueCatConfigured();
    if (!config) {
      updateRevenueCatDiagnostics({
        offeringsStatus: 'not_configured',
        offeringsCount: 0,
        offeringsError: null,
      });
      return [];
    }
    try {
      const offerings = await retryOnce(() => Purchases.getOfferings());
      const offering = selectRevenueCatOffering(offerings, config);
      const metadata = resolveProOfferingMetadata(offering);
      const packages = selectRevenueCatPackages(offerings, config)
        .map((aPackage) => toProPaywallPackage(aPackage, metadata));
      updateRevenueCatDiagnostics({
        offeringsStatus: 'ok',
        offeringsCount: packages.length,
        offeringsError: null,
      });
      logRevenueCatDiagnostic('offerings:ok', {
        count: packages.length,
        offeringId: config.offeringId ?? null,
      });
      return packages;
    } catch (error) {
      updateRevenueCatDiagnostics({
        offeringsStatus: 'error',
        offeringsCount: 0,
        offeringsError: formatDiagnosticError(error),
      });
      logRevenueCatDiagnostic('offerings:error', {
        error: formatDiagnosticError(error),
      });
      throw error;
    }
  },

  async purchasePro(aPackage: PurchasesPackage): Promise<ProPurchaseResult> {
    const config = await ensureRevenueCatConfigured();
    if (!config) {
      throw new Error('RevenueCat is not configured.');
    }
    const result = await Purchases.purchasePackage(aPackage);
    return {
      customerInfo: result.customerInfo,
      snapshot: deriveProSubscriptionSnapshot(result.customerInfo, config.entitlementId),
    };
  },

  async restorePurchases(): Promise<ProPurchaseResult | null> {
    const config = await ensureRevenueCatConfigured();
    if (!config) return null;
    const customerInfo = await Purchases.restorePurchases();
    return {
      customerInfo,
      snapshot: deriveProSubscriptionSnapshot(customerInfo, config.entitlementId),
    };
  },
};

export function resetRevenueCatForTests(): void {
  configurePromise = null;
}
