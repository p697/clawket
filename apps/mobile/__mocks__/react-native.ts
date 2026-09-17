// Minimal react-native mock for unit tests
export const Platform = {
  OS: 'ios',
  Version: '17.0',
  isMacCatalyst: false,
  constants: {},
  select: (obj: Record<string, unknown>) => obj.ios ?? obj.default,
};

export const Alert = {
  alert: jest.fn(),
};

export const AppState = {
  currentState: 'active',
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
};

export const Dimensions = {
  get: jest.fn(() => ({ width: 375, height: 812, scale: 3, fontScale: 1 })),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
};

export const useWindowDimensions = jest.fn(() => ({
  width: 375,
  height: 812,
  scale: 3,
  fontScale: 1,
}));

export const StyleSheet = {
  absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  create: <T extends Record<string, unknown>>(styles: T) => styles,
  hairlineWidth: 1,
  flatten: (style: unknown) => style,
};

export const Keyboard = {
  dismiss: jest.fn(),
  addListener: jest.fn(() => ({ remove: jest.fn() })),
};

export const I18nManager = {
  isRTL: false,
  doLeftAndRightSwapInRTL: true,
  allowRTL: jest.fn(),
  forceRTL: jest.fn(),
  swapLeftAndRightInRTL: jest.fn(),
  getConstants: () => ({ isRTL: I18nManager.isRTL, doLeftAndRightSwapInRTL: true }),
};

export default {
  Platform,
  Alert,
  AppState,
  Dimensions,
  useWindowDimensions,
  StyleSheet,
  Keyboard,
  I18nManager,
};
