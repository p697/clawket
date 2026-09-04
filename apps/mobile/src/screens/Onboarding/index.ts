export { OnboardingScreen } from './OnboardingScreen';
export type { OnboardingScreenProps } from './OnboardingScreen';
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
export type {
  OnboardingConnectionPhase,
  OnboardingErrorPresentation,
  OnboardingStatus,
  PairableBackendKind,
  PairingSubmission,
} from './model';
