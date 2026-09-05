import { Platform } from 'react-native';

export const isMacCatalyst = Platform.OS === 'ios' && Platform.isMacCatalyst === true;
export const isIPad = Platform.OS === 'ios' && Platform.isPad === true && !isMacCatalyst;

export function getRuntimePlatform(): 'ios' | 'android' | 'macos' {
  if (isMacCatalyst) {
    return 'macos';
  }
  return Platform.OS === 'android' ? 'android' : 'ios';
}

export function getRuntimeSystemName(): 'iOS' | 'iPadOS' | 'Android' | 'macOS' {
  if (isMacCatalyst) {
    return 'macOS';
  }
  if (isIPad) {
    return 'iPadOS';
  }
  return Platform.OS === 'android' ? 'Android' : 'iOS';
}

export function getRuntimeDeviceFamily(): 'iphone' | 'ipad' | 'android' | 'mac' {
  if (isMacCatalyst) {
    return 'mac';
  }
  if (isIPad) {
    return 'ipad';
  }
  return Platform.OS === 'android' ? 'android' : 'iphone';
}

export function getRuntimeClientId(): 'openclaw-ios' | 'openclaw-android' | 'openclaw-macos' {
  if (isMacCatalyst) {
    return 'openclaw-macos';
  }
  return Platform.OS === 'android' ? 'openclaw-android' : 'openclaw-ios';
}
