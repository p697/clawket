export { OnboardingScreen } from './OnboardingScreen';
export type { OnboardingScreenProps } from './OnboardingScreen';
export { OnboardingRoute } from './OnboardingRoute';
export type {
  OnboardingConnectedResult,
  OnboardingRouteProps,
} from './OnboardingRoute';
export {
  createPairingSubmission,
  formatVerificationCode,
  isPlausibleEmail,
  isVerificationCodeComplete,
  normalizeEmail,
  normalizeVerificationCode,
  PAIRING_COMMAND,
  resolveOnboardingError,
  VERIFICATION_CODE_LENGTH,
} from './model';
export {
  assessOnboardingQr,
  getOnboardingPairingCommand,
  normalizePairableBackendKind,
  ONBOARDING_DOCUMENTATION_URLS,
  resolveOnboardingAdapterError,
  resolveOnboardingQrBackend,
  resolveOnboardingRouteStatus,
} from './route-model';
export type {
  OnboardingQrAssessment,
  OnboardingRouteOperation,
} from './route-model';
export type {
  OnboardingConnectionPhase,
  OnboardingErrorPresentation,
  OnboardingStatus,
  PairableBackendKind,
  PairingSubmission,
} from './model';
