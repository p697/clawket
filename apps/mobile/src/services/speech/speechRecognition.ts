import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type SpeechRecognitionState = 'idle' | 'listening';

type SpeechRecognitionPermissions = {
  speechGranted: boolean;
  microphoneGranted: boolean;
};

type SpeechRecognitionResultEvent = {
  transcript: string;
  isFinal: boolean;
};

type SpeechRecognitionStateEvent = {
  state: SpeechRecognitionState;
};

type SpeechRecognitionErrorEvent = {
  code: string;
  message?: string;
};

type SpeechRecognitionLevelEvent = {
  level: number;
};

type SpeechRecognitionSubscription = {
  remove(): void;
};

type NativeSpeechRecognitionModule = {
  isAvailableAsync(localeIdentifier?: string | null): Promise<boolean>;
  requestPermissionsAsync(): Promise<SpeechRecognitionPermissions>;
  startAsync(localeIdentifier?: string | null): Promise<void>;
  stopAsync(): Promise<void>;
  addListener(
    eventName: 'onSpeechResult',
    listener: (event: SpeechRecognitionResultEvent) => void
  ): SpeechRecognitionSubscription;
  addListener(
    eventName: 'onSpeechState',
    listener: (event: SpeechRecognitionStateEvent) => void
  ): SpeechRecognitionSubscription;
  addListener(
    eventName: 'onSpeechError',
    listener: (event: SpeechRecognitionErrorEvent) => void
  ): SpeechRecognitionSubscription;
  addListener(
    eventName: 'onSpeechLevel',
    listener: (event: SpeechRecognitionLevelEvent) => void
  ): SpeechRecognitionSubscription;
};

const nativeModule = requireOptionalNativeModule<NativeSpeechRecognitionModule>(
  'ClawketSpeechRecognition'
);

export function isSpeechRecognitionSupported(): boolean {
  return Platform.OS === 'ios' && !!nativeModule;
}

export async function getSpeechRecognitionAvailabilityAsync(
  localeIdentifier?: string | null
): Promise<boolean> {
  if (!nativeModule) {
    return false;
  }
  return nativeModule.isAvailableAsync(localeIdentifier ?? null);
}

export async function requestSpeechRecognitionPermissionsAsync(): Promise<SpeechRecognitionPermissions> {
  if (!nativeModule) {
    return { speechGranted: false, microphoneGranted: false };
  }
  return nativeModule.requestPermissionsAsync();
}

export async function startSpeechRecognitionAsync(localeIdentifier?: string | null): Promise<void> {
  if (!nativeModule) {
    throw new Error('Speech recognition is unavailable.');
  }
  await nativeModule.startAsync(localeIdentifier ?? null);
}

export async function stopSpeechRecognitionAsync(): Promise<void> {
  if (!nativeModule) {
    return;
  }
  await nativeModule.stopAsync();
}

export function addSpeechRecognitionResultListener(
  listener: (event: SpeechRecognitionResultEvent) => void
): SpeechRecognitionSubscription | null {
  if (!nativeModule) {
    return null;
  }
  return nativeModule.addListener('onSpeechResult', listener);
}

export function addSpeechRecognitionStateListener(
  listener: (event: SpeechRecognitionStateEvent) => void
): SpeechRecognitionSubscription | null {
  if (!nativeModule) {
    return null;
  }
  return nativeModule.addListener('onSpeechState', listener);
}

export function addSpeechRecognitionErrorListener(
  listener: (event: SpeechRecognitionErrorEvent) => void
): SpeechRecognitionSubscription | null {
  if (!nativeModule) {
    return null;
  }
  return nativeModule.addListener('onSpeechError', listener);
}

export function addSpeechRecognitionLevelListener(
  listener: (event: SpeechRecognitionLevelEvent) => void
): SpeechRecognitionSubscription | null {
  if (!nativeModule) {
    return null;
  }
  return nativeModule.addListener('onSpeechLevel', listener);
}
