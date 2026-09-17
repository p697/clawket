import { AppState, Platform } from 'react-native';
import { getRuntimePlatform, getRuntimeSystemName, isMacCatalyst } from '../utils/platform';
import {
  NodeCameraCaptureError,
  requestNodeCameraCapture,
} from './node-camera-capture';

export type HandlerResult =
  | { ok: true; payload: unknown }
  | { ok: false; error: { code: string; message: string } };

export type NodeInvokeHandler = (params: unknown) => Promise<HandlerResult>;

type PickerAsset = {
  base64?: string | null;
  width?: number | null;
  height?: number | null;
  uri?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  creationTime?: number | null;
};

type NormalizedImage = {
  format: 'jpg' | 'png';
  base64: string;
  width: number;
  height: number;
};

type CameraSnapParams = {
  facing: 'front' | 'back';
  maxWidth: number;
  quality: number;
  format: 'jpg';
  delayMs: number;
  deviceId?: string;
};

type PhotosLatestParams = {
  limit: number;
  maxWidth: number;
  quality: number;
};

function parseParams(params: unknown): Record<string, unknown> {
  return params && typeof params === 'object' ? (params as Record<string, unknown>) : {};
}

function permissionDenied(message: string): HandlerResult {
  return { ok: false, error: { code: 'PERMISSION_DENIED', message } };
}

function invalidParams(message: string): HandlerResult {
  return { ok: false, error: { code: 'INVALID_PARAMS', message } };
}

function unavailable(message: string, code = 'UNAVAILABLE'): HandlerResult {
  return { ok: false, error: { code, message } };
}

function inferImageFormat(asset: PickerAsset): string {
  const fromMime = typeof asset.mimeType === 'string' ? asset.mimeType.trim().toLowerCase() : '';
  if (fromMime === 'image/png') return 'png';
  if (fromMime === 'image/jpeg' || fromMime === 'image/jpg') return 'jpg';

  const fileName = typeof asset.fileName === 'string' ? asset.fileName : '';
  const uri = typeof asset.uri === 'string' ? asset.uri : '';
  const match = (fileName || uri).match(/\.([a-z0-9]+)(?:$|\?)/i);
  const ext = match?.[1]?.toLowerCase();
  if (ext === 'png') return 'png';
  return 'jpg';
}

function toLegacyImagePayload(asset: PickerAsset): Record<string, unknown> {
  return {
    base64: asset.base64 ?? undefined,
    width: asset.width ?? undefined,
    height: asset.height ?? undefined,
    uri: asset.uri ?? undefined,
  };
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.floor(value)))
    : fallback;
}

function normalizeCameraFacing(value: unknown): 'front' | 'back' | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'front' || normalized === 'back') {
    return normalized;
  }
  return null;
}

function parseCameraSnapParams(params: unknown): CameraSnapParams | HandlerResult {
  const record = parseParams(params);
  const facing = record.facing == null ? 'front' : normalizeCameraFacing(record.facing);
  if (!facing) {
    return invalidParams('Invalid param: facing must be "front" or "back".');
  }

  const formatRaw = record.format == null ? 'jpg' : String(record.format).trim().toLowerCase();
  if (formatRaw !== 'jpg' && formatRaw !== 'jpeg') {
    return invalidParams('Invalid param: camera.snap currently supports only format "jpg".');
  }

  const deviceId = typeof record.deviceId === 'string' && record.deviceId.trim()
    ? record.deviceId.trim()
    : undefined;

  return {
    facing,
    maxWidth: clampInteger(record.maxWidth, 1600, 240, 4096),
    quality: clampNumber(record.quality, 0.95, 0.1, 1.0),
    format: 'jpg',
    delayMs: clampInteger(record.delayMs, 0, 0, 60_000),
    ...(deviceId ? { deviceId } : {}),
  };
}

function parsePhotosLatestParams(params: unknown): PhotosLatestParams {
  const record = parseParams(params);
  return {
    limit: clampInteger(record.limit, 1, 1, 20),
    maxWidth: clampInteger(record.maxWidth, 1600, 240, 4096),
    quality: clampNumber(record.quality, 0.85, 0.1, 1.0),
  };
}

function toOfficialImagePayload(asset: NormalizedImage): Record<string, unknown> {
  return {
    format: asset.format,
    base64: asset.base64,
    width: asset.width,
    height: asset.height,
  };
}

function createdAtPayload(creationTime: number | null | undefined): Record<string, unknown> {
  return typeof creationTime === 'number' && Number.isFinite(creationTime) && creationTime > 0
    ? { createdAt: new Date(creationTime).toISOString() }
    : {};
}

async function wait(delayMs: number): Promise<void> {
  if (delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function captureCameraAsset(options?: {
  facing?: 'front' | 'back';
  quality?: number;
  includeBase64?: boolean;
}): Promise<PickerAsset | null | { canceled: true }> {
  const ImagePicker = getImagePicker();
  const launchOptions = {
    base64: options?.includeBase64 ?? true,
    quality: options?.quality ?? 0.8,
    ...(options?.facing && ImagePicker.CameraType
      ? {
        cameraType: options.facing === 'front'
          ? ImagePicker.CameraType.front
          : ImagePicker.CameraType.back,
      }
      : {}),
  };
  const result = isMacCatalyst
    ? await ImagePicker.launchImageLibraryAsync({ ...launchOptions, mediaTypes: ['images'] })
    : await (async () => {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        return null;
      }
      return ImagePicker.launchCameraAsync(launchOptions);
    })();

  if (!result) {
    return null;
  }
  if (result.canceled || !result.assets?.length) {
    return { canceled: true };
  }
  return result.assets[0] as PickerAsset;
}

async function pickPhotoAssets(limit = 1): Promise<PickerAsset[] | null | { canceled: true }> {
  const ImagePicker = getImagePicker();
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    return null;
  }

  const allowsMultipleSelection = limit > 1;
  const result = await ImagePicker.launchImageLibraryAsync({
    base64: true,
    quality: 0.8,
    mediaTypes: ['images'],
    ...(allowsMultipleSelection ? { allowsMultipleSelection: true, selectionLimit: limit } : {}),
  });
  if (result.canceled || !result.assets?.length) {
    return { canceled: true };
  }
  return result.assets as PickerAsset[];
}

// Lazy-load native modules to avoid crash-on-import at app startup.

function getImagePicker() {
  return require('expo-image-picker') as typeof import('expo-image-picker');
}

function getImageManipulator() {
  return require('expo-image-manipulator') as typeof import('expo-image-manipulator');
}

function getClipboard() {
  return require('expo-clipboard') as typeof import('expo-clipboard');
}

function getMediaLibrary() {
  return require('expo-media-library/legacy') as typeof import('expo-media-library/legacy');
}

function getFileSystem() {
  return require('expo-file-system/legacy') as {
    cacheDirectory: string | null;
    writeAsStringAsync: (uri: string, contents: string, options?: { encoding?: string }) => Promise<void>;
    EncodingType: { Base64: string };
  };
}

function getLocation() {
  return require('expo-location') as typeof import('expo-location');
}

type BatteryStateValue = 0 | 1 | 2 | 3 | 4 | number;

type BatteryModule = {
  getBatteryLevelAsync: () => Promise<number>;
  getBatteryStateAsync: () => Promise<BatteryStateValue>;
  isLowPowerModeEnabledAsync: () => Promise<boolean>;
};

function getBattery(): BatteryModule | null {
  try {
    return require('expo-battery') as BatteryModule;
  } catch {
    return null;
  }
}

type NetworkState = {
  type?: string;
  isConnected?: boolean;
  isInternetReachable?: boolean | null;
};

type NetworkModule = {
  getNetworkStateAsync: () => Promise<NetworkState>;
};

function getNetwork(): NetworkModule | null {
  try {
    return require('expo-network') as NetworkModule;
  } catch {
    return null;
  }
}

type NotificationsPermissionStatus = {
  granted?: boolean;
};

type NotificationsModule = {
  AndroidImportance?: { DEFAULT?: number };
  getPermissionsAsync: () => Promise<NotificationsPermissionStatus>;
  requestPermissionsAsync: () => Promise<NotificationsPermissionStatus>;
  setNotificationHandler?: (handler: {
    handleNotification: () => Promise<{
      shouldShowBanner?: boolean;
      shouldShowList?: boolean;
      shouldPlaySound?: boolean;
      shouldSetBadge?: boolean;
    }>;
  }) => void;
  setNotificationChannelAsync?: (channelId: string, channel: {
    name: string;
    importance: number;
  }) => Promise<void>;
  scheduleNotificationAsync: (request: {
    content: { title: string; body?: string };
    trigger: null;
  }) => Promise<string>;
};

function getNotifications(): NotificationsModule | null {
  try {
    return require('expo-notifications') as NotificationsModule;
  } catch {
    return null;
  }
}

let notificationHandlerInitialized = false;
let androidChannelInitialized = false;

async function ensureNotificationRuntime(notifications: NotificationsModule): Promise<void> {
  if (!notificationHandlerInitialized && notifications.setNotificationHandler) {
    notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    notificationHandlerInitialized = true;
  }

  if (Platform.OS === 'android' && !androidChannelInitialized && notifications.setNotificationChannelAsync) {
    await notifications.setNotificationChannelAsync('node-system-notify', {
      name: 'Node Notifications',
      importance: notifications.AndroidImportance?.DEFAULT ?? 3,
    });
    androidChannelInitialized = true;
  }
}

// ── device ──────────────────────────────────────────────────────────────────

export async function handleDeviceInfo(): Promise<HandlerResult> {
  const constants = (Platform.constants ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    payload: {
      platform: getRuntimePlatform(),
      systemName: getRuntimeSystemName(),
      systemVersion: String(Platform.Version),
      model: constants.Model ?? constants.Brand ?? 'unknown',
    },
  };
}

export async function handleDeviceStatus(): Promise<HandlerResult> {
  const Battery = getBattery();
  const Network = getNetwork();

  let batteryLevel: number | null = null;
  let batteryState: string | null = null;
  let lowPowerMode: boolean | null = null;
  let networkType: string | null = null;
  let isConnected: boolean | null = null;
  let isInternetReachable: boolean | null = null;

  if (Battery) {
    try {
      batteryLevel = await Battery.getBatteryLevelAsync();
    } catch {
      batteryLevel = null;
    }
    try {
      const state = await Battery.getBatteryStateAsync();
      batteryState = mapBatteryState(state);
    } catch {
      batteryState = null;
    }
    try {
      lowPowerMode = await Battery.isLowPowerModeEnabledAsync();
    } catch {
      lowPowerMode = null;
    }
  }

  if (Network) {
    try {
      const state = await Network.getNetworkStateAsync();
      networkType = normalizeNetworkType(state.type);
      isConnected = typeof state.isConnected === 'boolean' ? state.isConnected : null;
      isInternetReachable = typeof state.isInternetReachable === 'boolean' ? state.isInternetReachable : null;
    } catch {
      networkType = null;
      isConnected = null;
      isInternetReachable = null;
    }
  }

  return {
    ok: true,
    payload: {
      batteryLevel,
      batteryState,
      lowPowerMode,
      networkType,
      isConnected,
      isInternetReachable,
      appState: AppState.currentState,
    },
  };
}

function mapBatteryState(state: BatteryStateValue): string | null {
  switch (state) {
    case 1:
      return 'unknown';
    case 2:
      return 'unplugged';
    case 3:
      return 'charging';
    case 4:
      return 'full';
    default:
      return null;
  }
}

function normalizeNetworkType(type: unknown): string | null {
  if (typeof type !== 'string' || !type.trim()) return null;
  return type.toLowerCase();
}

// ── system ──────────────────────────────────────────────────────────────────

export async function handleSystemNotify(params: unknown): Promise<HandlerResult> {
  const notifications = getNotifications();
  if (!notifications) {
    return {
      ok: false,
      error: {
        code: 'UNAVAILABLE',
        message: 'Notifications module is unavailable in this app build.',
      },
    };
  }

  const record = parseParams(params);
  const title = typeof record.title === 'string' ? record.title : 'Notification';
  const body = typeof record.body === 'string' ? record.body : undefined;
  await ensureNotificationRuntime(notifications);

  let permission = await notifications.getPermissionsAsync();
  if (!permission.granted) {
    permission = await notifications.requestPermissionsAsync();
  }
  if (!permission.granted) {
    return permissionDenied('Notification permission was denied.');
  }

  await notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: null,
  });
  return { ok: true, payload: { delivered: true } };
}

// ── camera ──────────────────────────────────────────────────────────────────

export async function handleCameraCapture(): Promise<HandlerResult> {
  const result = await captureCameraAsset();
  if (!result) {
    return permissionDenied('Camera permission was denied.');
  }
  if ('canceled' in result) {
    return { ok: true, payload: { canceled: true } };
  }
  return {
    ok: true,
    payload: toLegacyImagePayload(result),
  };
}

export async function handleCameraPick(): Promise<HandlerResult> {
  const result = await pickPhotoAssets(1);
  if (!result) {
    return permissionDenied('Media library permission was denied.');
  }
  if ('canceled' in result) {
    return { ok: true, payload: { canceled: true } };
  }
  return {
    ok: true,
    payload: toLegacyImagePayload(result[0] ?? {}),
  };
}

export async function handleCameraSnap(params?: unknown): Promise<HandlerResult> {
  const parsed = parseCameraSnapParams(params);
  if ('ok' in parsed) {
    return parsed;
  }
  if (parsed.deviceId) {
    return unavailable('camera.snap deviceId is not supported by this Clawket node yet.', 'UNSUPPORTED_FEATURE');
  }

  await wait(parsed.delayMs);
  let captureResult: { uri: string; width: number; height: number; format: 'jpg' | 'png' };
  try {
    captureResult = await requestNodeCameraCapture({
      facing: parsed.facing,
      quality: parsed.quality,
    });
  } catch (error) {
    if (error instanceof NodeCameraCaptureError) {
      if (error.code === 'PERMISSION_DENIED') {
        return permissionDenied(error.message);
      }
      return unavailable(error.message, error.code);
    }
    const message = error instanceof Error ? error.message : 'Camera capture failed.';
    return unavailable(message);
  }
  const normalized = await normalizeImageUri(captureResult.uri, {
    width: captureResult.width,
    height: captureResult.height,
    maxWidth: parsed.maxWidth,
    quality: parsed.quality,
    format: parsed.format,
  });
  return {
    ok: true,
    payload: toOfficialImagePayload(normalized),
  };
}

export async function handlePhotosLatest(params: unknown): Promise<HandlerResult> {
  const parsed = parsePhotosLatestParams(params);
  const MediaLibrary = getMediaLibrary();
  const perm = await MediaLibrary.requestPermissionsAsync();
  if (perm.status !== 'granted') {
    return permissionDenied('Media library permission was denied.');
  }

  const assetsPage = await MediaLibrary.getAssetsAsync({
    first: parsed.limit,
    sortBy: [[MediaLibrary.SortBy?.creationTime ?? 'creationTime', false]],
    mediaType: MediaLibrary.MediaType?.photo ?? 'photo',
  });
  const assets = Array.isArray(assetsPage.assets) ? assetsPage.assets : [];
  if (assets.length === 0) {
    return { ok: true, payload: { photos: [] } };
  }

  const photos: Array<Record<string, unknown>> = [];
  for (const asset of assets) {
    const info = await MediaLibrary.getAssetInfoAsync(asset);
    const sourceUri =
      typeof info.localUri === 'string' && info.localUri
        ? info.localUri
        : typeof info.uri === 'string' && info.uri
          ? info.uri
          : null;
    if (!sourceUri) {
      continue;
    }
    const normalized = await normalizeImageUri(sourceUri, {
      width: asset.width,
      height: asset.height,
      maxWidth: parsed.maxWidth,
      quality: parsed.quality,
      format: 'jpg',
    });
    photos.push({
      ...toOfficialImagePayload(normalized),
      ...createdAtPayload(asset.creationTime),
    });
  }

  return {
    ok: true,
    payload: {
      photos,
    },
  };
}

// ── location ────────────────────────────────────────────────────────────────

const ACCURACY_MAP: Record<string, number> = {
  coarse: 3,    // Accuracy.Balanced (expo-location enum value)
  balanced: 3,
  precise: 6,   // Accuracy.BestForNavigation
};

export async function handleLocationGet(params: unknown): Promise<HandlerResult> {
  const Location = getLocation();
  const record = parseParams(params);

  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== 'granted') {
    return permissionDenied('Location permission was denied.');
  }

  const desiredAccuracy = typeof record.desiredAccuracy === 'string'
    ? record.desiredAccuracy
    : 'balanced';
  const accuracy = ACCURACY_MAP[desiredAccuracy] ?? ACCURACY_MAP.balanced;

  const maxAgeMs = typeof record.maxAgeMs === 'number' ? record.maxAgeMs : undefined;

  const location = await Location.getCurrentPositionAsync({
    accuracy,
    ...(maxAgeMs != null ? { maxAge: maxAgeMs } : {}),
  });

  return {
    ok: true,
    payload: {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy,
      altitude: location.coords.altitude,
      timestamp: location.timestamp,
    },
  };
}

// ── clipboard ───────────────────────────────────────────────────────────────

export async function handleClipboardRead(): Promise<HandlerResult> {
  const Clip = getClipboard();
  const text = await Clip.getStringAsync();
  return { ok: true, payload: { text } };
}

export async function handleClipboardWrite(params: unknown): Promise<HandlerResult> {
  const record = parseParams(params);
  if (typeof record.text !== 'string') {
    return invalidParams('Missing required param: text (string).');
  }
  const Clip = getClipboard();
  await Clip.setStringAsync(record.text);
  return { ok: true, payload: { ok: true } };
}

// ── media ───────────────────────────────────────────────────────────────────

export async function handleMediaSave(params: unknown): Promise<HandlerResult> {
  const record = parseParams(params);
  if (typeof record.base64 !== 'string') {
    return invalidParams('Missing required param: base64 (string).');
  }

  const ML = getMediaLibrary();
  const perm = await ML.requestPermissionsAsync();
  if (perm.status !== 'granted') {
    return permissionDenied('Media library permission was denied.');
  }

  const FS = getFileSystem();
  const filename = typeof record.filename === 'string' ? record.filename : 'clawket_media.png';
  const tmpUri = `${FS.cacheDirectory}${filename}`;
  await FS.writeAsStringAsync(tmpUri, record.base64, {
    encoding: FS.EncodingType.Base64,
  });
  await ML.saveToLibraryAsync(tmpUri);
  return { ok: true, payload: { saved: true } };
}

async function normalizeImageAsset(
  asset: PickerAsset,
  options: {
    maxWidth: number;
    quality: number;
    format: 'jpg' | 'png';
  },
): Promise<NormalizedImage> {
  const sourceUri = typeof asset.uri === 'string' && asset.uri ? asset.uri : null;
  if (!sourceUri) {
    return {
      format: options.format,
      base64: asset.base64 ?? '',
      width: typeof asset.width === 'number' ? asset.width : 0,
      height: typeof asset.height === 'number' ? asset.height : 0,
    };
  }
  return normalizeImageUri(sourceUri, {
    width: typeof asset.width === 'number' ? asset.width : undefined,
    height: typeof asset.height === 'number' ? asset.height : undefined,
    maxWidth: options.maxWidth,
    quality: options.quality,
    format: options.format,
  });
}

async function normalizeImageUri(
  uri: string,
  options: {
    width?: number;
    height?: number;
    maxWidth: number;
    quality: number;
    format: 'jpg' | 'png';
  },
): Promise<NormalizedImage> {
  const ImageManipulator = getImageManipulator();
  const resizeWidth =
    typeof options.width === 'number' && options.width > options.maxWidth
      ? options.maxWidth
      : undefined;
  const actions = resizeWidth ? [{ resize: { width: resizeWidth } }] : [];
  const saveFormat =
    options.format === 'png'
      ? ImageManipulator.SaveFormat.PNG
      : ImageManipulator.SaveFormat.JPEG;
  const result = await ImageManipulator.manipulateAsync(uri, actions, {
    base64: true,
    compress: options.quality,
    format: saveFormat,
  });
  return {
    format: options.format,
    base64: result.base64 ?? '',
    width: result.width,
    height: result.height,
  };
}
