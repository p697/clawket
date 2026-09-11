import { requireOptionalNativeModule } from 'expo';

export type AppIconVariant = 'default' | 'black';

type NativeAppIconModule = {
  isSupportedAsync(): Promise<boolean>;
  getCurrentIconAsync(): Promise<string>;
  setIconAsync(icon: AppIconVariant): Promise<void>;
};

const nativeModule = requireOptionalNativeModule<NativeAppIconModule>('ClawketAppIcon');

function normalizeAppIconVariant(value: string | null | undefined): AppIconVariant {
  return value === 'black' ? 'black' : 'default';
}

export async function isAppIconChangeSupportedAsync(): Promise<boolean> {
  if (!nativeModule) {
    return false;
  }
  return nativeModule.isSupportedAsync();
}

export async function getCurrentAppIconAsync(): Promise<AppIconVariant> {
  if (!nativeModule) {
    return 'default';
  }
  return normalizeAppIconVariant(await nativeModule.getCurrentIconAsync());
}

export async function setCurrentAppIconAsync(icon: AppIconVariant): Promise<void> {
  if (!nativeModule) {
    throw new Error('App icon switching is unavailable.');
  }
  await nativeModule.setIconAsync(icon);
}
