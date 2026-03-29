import { Platform } from 'react-native';
import Purchases, {
  type CustomerInfo,
  PACKAGE_TYPE,
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

export type ProSubscriptionSnapshot = {
  isActive: boolean;
  entitlementId: string;
  productIdentifier: string | null;
  productPlanIdentifier: string | null;
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

export type ProPaywallPackage = {
  offeringIdentifier: string;
  packageIdentifier: string;
  packageType: string;
  productIdentifier: string | null;
  title: string;
  description: string;
  priceString: string;
  pricePerMonthString: string | null;
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
    offeringsStatus: 'not_configured',
    offeringsCount: null,
    offeringsError: null,
    lastUpdatedAt: null,
  };
}

let runtimeRevenueCatDiagnostics: RevenueCatDiagnostics = createRevenueCatDiagnosticsBase();

function updateRevenueCatDiagnostics(patch: Partial<RevenueCatDiagnostics>): void {
  runtimeRevenueCatDiagnostics = {
    ...runtimeRevenueCatDiagnostics,
    ...createRevenueCatDiagnosticsBase(),
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
    ...runtimeRevenueCatDiagnostics,
    ...createRevenueCatDiagnosticsBase(),
  };
}

export function deriveProSubscriptionSnapshot(
  customerInfo: CustomerInfo,
  entitlementId: string,
): ProSubscriptionSnapshot {
  const entitlement = customerInfo.entitlements.all[entitlementId]
    ?? customerInfo.entitlements.active[entitlementId]
    ?? null;

  return {
    isActive: Boolean(customerInfo.entitlements.active[entitlementId]?.isActive),
    entitlementId,
    productIdentifier: entitlement?.productIdentifier ?? null,
    productPlanIdentifier: entitlement?.productPlanIdentifier ?? null,
    originalPurchaseDate: entitlement?.originalPurchaseDate ?? customerInfo.originalPurchaseDate ?? null,
    latestPurchaseDate: entitlement?.latestPurchaseDate ?? null,
    expirationDate: entitlement?.expirationDate ?? null,
    willRenew: entitlement?.willRenew ?? false,
    store: entitlement?.store ?? null,
    managementURL: customerInfo.managementURL ?? null,
    originalAppUserId: customerInfo.originalAppUserId ?? null,
    requestDate: customerInfo.requestDate ?? null,
    verification: entitlement?.verification ?? customerInfo.entitlements.verification ?? null,
  };
}

export function selectRevenueCatOffering(
  offerings: PurchasesOfferings,
  config: RevenueCatConfig,
): PurchasesOffering | null {
  if (config.offeringId) {
    return offerings.all[config.offeringId] ?? null;
  }
  return offerings.current;
}

export function selectRevenueCatPackages(
  offerings: PurchasesOfferings,
  config: RevenueCatConfig,
): PurchasesPackage[] {
  const offering = selectRevenueCatOffering(offerings, config);
  if (!offering) return [];

  const prioritized = [
    config.packageId ? offering.availablePackages.find((item) => item.identifier === config.packageId) ?? null : null,
    offering.monthly,
    offering.annual,
    ...offering.availablePackages,
  ].filter((item): item is PurchasesPackage => Boolean(item));

  const unique = prioritized.filter((item, index, array) => (
    array.findIndex((candidate) => candidate.identifier === item.identifier) === index
  ));

  const subscriptionPackages = unique.filter((item) => (
    item.packageType === PACKAGE_TYPE.MONTHLY || item.packageType === PACKAGE_TYPE.ANNUAL
  ));

  if (subscriptionPackages.length > 0) {
    return subscriptionPackages;
  }

  return unique.slice(0, 1);
}

export function selectDefaultRevenueCatPackage(
  packages: ProPaywallPackage[],
  config: RevenueCatConfig,
): ProPaywallPackage | null {
  if (packages.length === 0) return null;
  if (config.packageId) {
    return packages.find((item) => item.packageIdentifier === config.packageId) ?? packages[0];
  }
  return packages.find((item) => item.packageType === PACKAGE_TYPE.MONTHLY) ?? packages[0];
}

export function selectSnapshotRevenueCatPackage(
  packages: ProPaywallPackage[],
  snapshot: ProSubscriptionSnapshot | null,
): ProPaywallPackage | null {
  if (!snapshot?.productIdentifier) return null;

  const directMatch = packages.find((item) => item.productIdentifier === snapshot.productIdentifier) ?? null;
  if (directMatch) return directMatch;

  const normalized = snapshot.productIdentifier.toLowerCase();
  if (
    normalized.includes('year')
    || normalized.includes('annual')
    || normalized.includes('annually')
  ) {
    return packages.find((item) => item.packageType === PACKAGE_TYPE.ANNUAL) ?? null;
  }
  if (normalized.includes('month')) {
    return packages.find((item) => item.packageType === PACKAGE_TYPE.MONTHLY) ?? null;
  }
  return null;
}

export function toProPaywallPackage(aPackage: PurchasesPackage): ProPaywallPackage {
  return {
    offeringIdentifier: aPackage.presentedOfferingContext?.offeringIdentifier ?? aPackage.offeringIdentifier,
    packageIdentifier: aPackage.identifier,
    packageType: aPackage.packageType,
    productIdentifier: aPackage.product.identifier ?? null,
    title: aPackage.product.title,
    description: aPackage.product.description,
    priceString: aPackage.product.priceString,
    pricePerMonthString: aPackage.product.pricePerMonthString,
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
      const packages = selectRevenueCatPackages(offerings, config).map(toProPaywallPackage);
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
