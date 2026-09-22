// SVG is a native drawing host. Preserve geometry props for component assertions.
jest.mock('react-native-svg', () => {
  const React = require('react');
  const host = (name: string) => ({ children, ...props }: any) => React.createElement(name, props, children);
  return {
    __esModule: true,
    default: host('Svg'),
    Path: host('Path'),
    Text: host('SvgText'),
    Defs: host('Defs'),
    LinearGradient: host('LinearGradient'),
    Rect: host('Rect'),
    Stop: host('Stop'),
  };
});

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
  clear: jest.fn(() => Promise.resolve()),
  getAllKeys: jest.fn(() => Promise.resolve([])),
  multiGet: jest.fn(() => Promise.resolve([])),
  multiSet: jest.fn(() => Promise.resolve()),
  multiRemove: jest.fn(() => Promise.resolve()),
}));

// Keep Reanimated's ESM runtime out of the Node test environment. Individual
// animation tests can still replace this baseline mock with a stricter factory.
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const primitive = (name: string) => React.forwardRef(
    ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>, ref: React.Ref<unknown>) => (
      React.createElement(name, { ...props, ref }, children)
    ),
  );
  const identity = <T>(value: T): T => value;
  const easingIdentity = (value: number): number => value;

  const Animated = {
    Image: primitive('AnimatedImage'),
    ScrollView: primitive('AnimatedScrollView'),
    Text: primitive('AnimatedText'),
    View: primitive('AnimatedView'),
    createAnimatedComponent: identity,
  };
  // Layout/entering presets are chainable builders; tests only need them to exist.
  const layoutAnimation = (name: string) => {
    const animation: Record<string, unknown> = { name };
    for (const method of ['duration', 'delay', 'easing', 'reduceMotion', 'springify', 'withInitialValues']) {
      animation[method] = () => animation;
    }
    return animation;
  };

  return {
    __esModule: true,
    default: Animated,
    cancelAnimation: jest.fn(),
    FadeIn: layoutAnimation('FadeIn'),
    FadeOut: layoutAnimation('FadeOut'),
    LinearTransition: layoutAnimation('LinearTransition'),
    Easing: {
      bezier: () => easingIdentity,
      cubic: (value: number) => value ** 3,
      ease: easingIdentity,
      in: identity,
      inOut: identity,
      linear: easingIdentity,
      out: identity,
      quad: (value: number) => value ** 2,
    },
    interpolate: (_value: number, _input: number[], output: unknown[]) => output[0],
    interpolateColor: (_value: number, _input: number[], output: unknown[]) => output[0],
    makeMutable: <T>(value: T) => ({ value }),
    ReduceMotion: { Always: 'always', Never: 'never', System: 'system' },
    runOnJS: identity,
    scrollTo: jest.fn(),
    useAnimatedRef: () => ({ current: null }),
    useAnimatedProps: (factory: () => unknown) => factory(),
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useScrollOffset: () => ({ value: 0 }),
    useReducedMotion: () => false,
    useSharedValue: <T>(value: T) => ({ value }),
    withDelay: (_delay: number, value: unknown) => value,
    withRepeat: (value: unknown) => value,
    withSequence: (...values: unknown[]) => values.at(-1),
    withSpring: identity,
    withTiming: identity,
  };
});

// Swipe trays render already revealed so tests can press their actions; the
// imperative handle is a stub because there is no gesture to close.
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => {
  const React = require('react');
  const Swipeable = React.forwardRef(function Swipeable(
    {
      children,
      renderRightActions,
      testID,
    }: {
      children?: React.ReactNode;
      renderRightActions?: (
        progress: { value: number },
        translation: { value: number },
        methods: Record<string, () => void>,
      ) => React.ReactNode;
      testID?: string;
    } & Record<string, unknown>,
    ref: React.Ref<Record<string, () => void>>,
  ) {
    const methods = React.useMemo(() => ({
      close: jest.fn(),
      openLeft: jest.fn(),
      openRight: jest.fn(),
      reset: jest.fn(),
    }), []);
    React.useImperativeHandle(ref, () => methods, [methods]);
    return React.createElement(
      'Swipeable',
      { testID },
      children,
      renderRightActions ? renderRightActions({ value: 1 }, { value: 0 }, methods) : null,
    );
  });
  return { __esModule: true, default: Swipeable };
});

// Mock expo-linking
jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn(() => Promise.resolve(null)),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  createURL: jest.fn((path: string) => `clawket://${path}`),
}));

// Mock expo-camera
jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');

  class MockCameraView extends React.Component {
    takePictureAsync = jest.fn(async (options?: { quality?: number }) => ({
      uri: 'file://camera-view.jpg',
      width: 1920,
      height: 1080,
      format: 'jpg',
      base64: options?.quality,
    }));

    componentDidMount() {
      this.props.onCameraReady?.();
    }

    render() {
      return React.createElement(View, this.props, this.props.children);
    }
  }

  return {
    Camera: {
      getCameraPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true, status: 'granted' })),
      requestCameraPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true, status: 'granted' })),
      scanFromURLAsync: jest.fn(() => Promise.resolve([])),
    },
    CameraView: MockCameraView,
  };
});

// Mock expo-application
jest.mock('expo-application', () => ({
  applicationId: 'com.clawket.test',
  nativeApplicationVersion: '1.0.0',
  nativeBuildVersion: '1',
  getIosIdForVendorAsync: jest.fn(() => Promise.resolve(null)),
  androidId: null,
}));

// Mock expo-device
jest.mock('expo-device', () => ({
  modelName: 'JestDevice',
  osName: 'JestOS',
  osVersion: '1.0',
  brand: 'Jest',
  manufacturer: 'Jest',
  isDevice: false,
}));

// The `expo` entry point ships TypeScript source; expose only the pieces the
// app imports from it.
jest.mock('expo', () => ({
  reloadAppAsync: jest.fn(() => Promise.resolve()),
  requireOptionalNativeModule: jest.fn(() => null),
}));

// Mock expo-localization
jest.mock('expo-localization', () => ({
  getCalendars: jest.fn(() => [{ timeZone: 'America/Los_Angeles' }]),
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
}));

// Mock expo-secure-store
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

// Mock expo-haptics
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

// Mock expo-clipboard
jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(() => Promise.resolve()),
  getStringAsync: jest.fn(() => Promise.resolve('')),
}));

// Mock expo-image-picker
jest.mock('expo-image-picker', () => ({
  CameraType: {
    front: 'front',
    back: 'back',
  },
  requestCameraPermissionsAsync: jest.fn(() =>
    Promise.resolve({ granted: true, status: 'granted' }),
  ),
  requestMediaLibraryPermissionsAsync: jest.fn(() =>
    Promise.resolve({ granted: true, status: 'granted' }),
  ),
  launchCameraAsync: jest.fn(() =>
    Promise.resolve({
      canceled: false,
      assets: [{
        base64: 'abc123',
        width: 2000,
        height: 4000,
        uri: 'file://photo.jpg',
        mimeType: 'image/jpeg',
        fileName: 'photo.jpg',
      }],
    }),
  ),
  launchImageLibraryAsync: jest.fn(() =>
    Promise.resolve({
      canceled: false,
      assets: [{
        base64: 'def456',
        width: 300,
        height: 400,
        uri: 'file://picked.jpg',
        mimeType: 'image/jpeg',
        fileName: 'picked.jpg',
        creationTime: Date.parse('2026-03-27T10:00:00.000Z'),
      }],
    }),
  ),
}));

// Mock expo-media-library
jest.mock('expo-media-library/legacy', () => ({
  MediaType: {
    photo: 'photo',
  },
  SortBy: {
    creationTime: 'creationTime',
  },
  requestPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted', granted: true }),
  ),
  getAssetsAsync: jest.fn(() =>
    Promise.resolve({
      assets: [{
        id: 'asset-1',
        filename: 'latest.jpg',
        uri: 'file://latest.jpg',
        mediaType: 'photo',
        width: 3000,
        height: 2000,
        creationTime: Date.parse('2026-03-28T08:30:00.000Z'),
        modificationTime: Date.parse('2026-03-28T08:30:00.000Z'),
        duration: 0,
      }],
    }),
  ),
  getAssetInfoAsync: jest.fn((asset) =>
    Promise.resolve({
      ...asset,
      localUri: asset?.uri ?? 'file://latest.jpg',
    }),
  ),
  saveToLibraryAsync: jest.fn(() => Promise.resolve()),
}));

// Mock expo-image-manipulator
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: {
    JPEG: 'jpeg',
    PNG: 'png',
  },
  manipulateAsync: jest.fn((uri: string, actions?: Array<{ resize?: { width?: number } }>, saveOptions?: {
    compress?: number;
    format?: string;
    base64?: boolean;
  }) => {
    const requestedWidth = actions?.find((action) => action.resize?.width)?.resize?.width;
    const width = requestedWidth ?? (uri.includes('latest') ? 3000 : 2000);
    const height = uri.includes('latest')
      ? Math.round(width * (2 / 3))
      : Math.round(width * 2);
    const format = saveOptions?.format === 'png' ? 'png' : 'jpg';
    const base64 = uri.includes('latest') ? 'latest-base64' : 'camera-base64';
    return Promise.resolve({
      uri,
      width,
      height,
      base64: saveOptions?.base64 ? `${base64}-${format}-${saveOptions?.compress ?? 1}` : undefined,
    });
  }),
}));

// Mock @react-native-menu/menu
jest.mock('@react-native-menu/menu', () => ({
  MenuView: ({ children }: { children: unknown }) => children,
}));

// Mock react-native-keyboard-controller: its module init touches Animated, which
// partial react-native mocks omit. Tests that exercise keyboard behavior override this.
jest.mock('react-native-keyboard-controller', () => {
  const ReactRuntime = require('react');
  const passthrough = (host: string) => ReactRuntime.forwardRef(
    ({ children, ...props }: Record<string, unknown>, ref: unknown) => ReactRuntime.createElement(
      require('react-native')[host],
      { ...props, ref },
      children,
    ),
  );
  return {
    KeyboardProvider: ({ children }: { children: unknown }) => children,
    KeyboardAvoidingView: passthrough('View'),
    KeyboardAwareScrollView: passthrough('ScrollView'),
    useKeyboardHandler: jest.fn(),
  };
});

// Mock react-native-screens
jest.mock('react-native-screens', () => ({
  FullWindowOverlay: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock @gorhom/bottom-sheet
jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const { View, TextInput, SectionList, Pressable } = require('react-native');

  const BottomSheetModal = React.forwardRef(function BottomSheetModal(
    {
      children,
      handleComponent: HandleComponent,
      backdropComponent: BackdropComponent,
      onDismiss,
      ...props
    }: {
      children: React.ReactNode | ((params: { data?: unknown }) => React.ReactNode);
      handleComponent?: React.ComponentType;
      backdropComponent?: React.ComponentType<{
        animatedIndex: { value: number };
        animatedPosition: { value: number };
      }>;
      onDismiss?: () => void;
    } & Record<string, unknown>,
    ref: React.Ref<{ present: () => void; dismiss: () => void }>,
  ) {
    const [presented, setPresented] = React.useState(false);
    const dismissedBeforeMount = React.useRef(false);
    React.useImperativeHandle(ref, () => ({
      present: jest.fn(() => { if (!dismissedBeforeMount.current) setPresented(true); }),
      dismiss: jest.fn(() => {
        if (!presented) dismissedBeforeMount.current = true;
        setPresented(false);
        onDismiss?.();
      }),
    }));
    if (!presented) {
      return null;
    }
    const backdropVariables = {
      animatedIndex: { value: 0 },
      animatedPosition: { value: 0 },
    };
    return React.createElement(
      View,
      props,
      BackdropComponent
        ? React.createElement(BackdropComponent, backdropVariables)
        : null,
      HandleComponent ? React.createElement(HandleComponent) : null,
      typeof children === 'function' ? children({}) : children,
    );
  });

  function BottomSheetView({
    children,
    ...props
  }: {
    children?: React.ReactNode;
  } & Record<string, unknown>) {
    return React.createElement(View, props, children);
  }

  return {
    __esModule: true,
    BottomSheetBackdrop: ({ children, ...props }: {
      children?: React.ReactNode;
    } & Record<string, unknown>) => React.createElement(View, props, children),
    BottomSheetModal,
    BottomSheetModalProvider: ({ children }: { children: React.ReactNode }) => children,
    TouchableOpacity: Pressable,
    BottomSheetFlatList: ({ data = [], renderItem, ListHeaderComponent, ...props }: any) => React.createElement(View, props,
      ListHeaderComponent, ...data.map((item: any, index: number) => React.createElement(React.Fragment, { key: item.key ?? index }, renderItem({ item, index })))),
    BottomSheetScrollView: ({ children, contentContainerStyle: _contentContainerStyle, ...props }: any) => React.createElement(View, props, children),
    BottomSheetSectionList: SectionList,
    BottomSheetTextInput: TextInput,
    BottomSheetView,
  };
});

// Mock expo-location
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(() => Promise.resolve({
    coords: {
      latitude: 37.7749,
      longitude: -122.4194,
      accuracy: 10,
      altitude: 0,
    },
    timestamp: 1234567890,
  })),
}));

// Mock expo-battery
jest.mock('expo-battery', () => ({
  getBatteryLevelAsync: jest.fn(() => Promise.resolve(0.67)),
  getBatteryStateAsync: jest.fn(() => Promise.resolve(3)),
  isLowPowerModeEnabledAsync: jest.fn(() => Promise.resolve(false)),
}));

// Mock expo-network
jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(() => Promise.resolve({
    type: 'WIFI',
    isConnected: true,
    isInternetReachable: true,
  })),
}));

// Mock expo-file-system (legacy API)
jest.mock('expo-file-system/legacy', () => ({
  writeAsStringAsync: jest.fn(() => Promise.resolve()),
  copyAsync: jest.fn(() => Promise.resolve()),
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///documents/',
  getInfoAsync: jest.fn(() => Promise.resolve({ exists: true })),
  makeDirectoryAsync: jest.fn(() => Promise.resolve()),
  deleteAsync: jest.fn(() => Promise.resolve()),
  EncodingType: { Base64: 'base64' },
}));

// Mock expo-notifications
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(() => Promise.resolve(null)),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('notif-1')),
  AndroidImportance: {
    DEFAULT: 3,
  },
}));

// Mock react-native-purchases
jest.mock('react-native-purchases', () => {
  const mockModule = {
    isConfigured: jest.fn(() => Promise.resolve(false)),
    configure: jest.fn(),
    setLogLevel: jest.fn(() => Promise.resolve()),
    getCustomerInfo: jest.fn(() => Promise.resolve({
      entitlements: { active: {}, all: {}, verification: 'NOT_REQUESTED' },
      activeSubscriptions: [],
      allPurchasedProductIdentifiers: [],
      latestExpirationDate: null,
      firstSeen: '2026-03-08T00:00:00.000Z',
      originalAppUserId: '$RCAnonymousID:test',
      requestDate: '2026-03-08T00:00:00.000Z',
      allExpirationDates: {},
      allPurchaseDates: {},
      originalApplicationVersion: null,
      originalPurchaseDate: null,
      managementURL: null,
      nonSubscriptionTransactions: [],
      subscriptionsByProductIdentifier: {},
    })),
    getOfferings: jest.fn(() => Promise.resolve({ all: {}, current: null })),
    purchasePackage: jest.fn(),
    PRORATION_MODE: { DEFERRED: 6, IMMEDIATE_WITHOUT_PRORATION: 3 },
    restorePurchases: jest.fn(),
    addCustomerInfoUpdateListener: jest.fn(),
    removeCustomerInfoUpdateListener: jest.fn(() => true),
    invalidateCustomerInfoCache: jest.fn(() => Promise.resolve()),
    LOG_LEVEL: {
      DEBUG: 'DEBUG',
      WARN: 'WARN',
    },
    PACKAGE_TYPE: {
      MONTHLY: 'MONTHLY',
      ANNUAL: 'ANNUAL',
      LIFETIME: 'LIFETIME',
    },
    PURCHASES_ERROR_CODE: {
      PURCHASE_CANCELLED_ERROR: '1',
      PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR: '5',
      INVALID_CREDENTIALS_ERROR: '11',
      PAYMENT_PENDING_ERROR: '20',
      CONFIGURATION_ERROR: '23',
    },
    ENTITLEMENT_VERIFICATION_MODE: {
      INFORMATIONAL: 'INFORMATIONAL',
    },
    STOREKIT_VERSION: {
      DEFAULT: 'DEFAULT',
    },
  };

  return {
    __esModule: true,
    default: mockModule,
    ...mockModule,
  };
});

// Mock posthog-react-native
jest.mock('posthog-react-native', () => {
  const client = {
    identify: jest.fn(() => Promise.resolve()),
    register: jest.fn(() => Promise.resolve()),
    screen: jest.fn(() => Promise.resolve()),
    capture: jest.fn(() => Promise.resolve()),
    reset: jest.fn(),
    flush: jest.fn(() => Promise.resolve()),
  };

  return {
    __esModule: true,
    default: jest.fn(() => client),
    PostHogProvider: ({ children }: { children: unknown }) => children,
    usePostHog: jest.fn(() => client),
  };
});

// Provide a minimal crypto.getRandomValues for gateway.ts
if (!globalThis.crypto) {
  (globalThis as any).crypto = {};
}
if (!globalThis.crypto.getRandomValues) {
  globalThis.crypto.getRandomValues = <T extends ArrayBufferView>(array: T): T => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return array;
  };
}

// Metro resolves official platform artwork to numeric native asset handles.
jest.mock('./assets/brands/openclaw.png', () => 301);
jest.mock('./assets/brands/hermes.png', () => 302);
jest.mock('./assets/brands/youmind.png', () => 303);
jest.mock('./assets/avatars/youmind-sprite-default.png', () => 306);

jest.mock('./assets/icon.png', () => 304);
jest.mock('./assets/app-icons/black/app-icon-black-1024.png', () => 305);

// Bundled model manufacturer artwork.
jest.mock('./assets/model-icons/select_model_chatgpt.png', () => 401);
jest.mock('./assets/model-icons/select_model_claude.png', () => 402);
jest.mock('./assets/model-icons/select_model_gemini.png', () => 403);
jest.mock('./assets/model-icons/select_model_deepseek.png', () => 404);
jest.mock('./assets/model-icons/select_model_qwen.png', () => 405);
jest.mock('./assets/model-icons/select_model_grok.png', () => 406);
jest.mock('./assets/model-icons/select_model_kimi.png', () => 407);
jest.mock('./assets/model-icons/select_model_minimax.png', () => 408);
jest.mock('./assets/model-icons/zhipuai.png', () => 409);

// Native capture is exercised through controlled buffers in voice lifecycle tests.
jest.mock('expo-audio', () => ({
  useAudioStream: jest.fn(() => ({ stream: { start: jest.fn(async () => {}), stop: jest.fn() } })),
  getRecordingPermissionsAsync: jest.fn(async () => ({ granted: false })),
  requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: false })),
  setAudioModeAsync: jest.fn(async () => {}),
}));
