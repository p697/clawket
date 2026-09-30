import { formatAppVersionLabel, getAppVersionLabel } from './app-version-label';

describe('app version label', () => {
  it('appends the native build number to the marketing version', () => {
    expect(formatAppVersionLabel('3.1.0', '30101')).toBe('3.1.0 (30101)');
    expect(formatAppVersionLabel('3.1.0', ' 42 ')).toBe('3.1.0 (42)');
  });

  it('shows only the version when the build number is missing or repeats it', () => {
    expect(formatAppVersionLabel('3.1.0', null)).toBe('3.1.0');
    expect(formatAppVersionLabel('3.1.0', undefined)).toBe('3.1.0');
    expect(formatAppVersionLabel('3.1.0', '  ')).toBe('3.1.0');
    expect(formatAppVersionLabel('3.1.0', '3.1.0')).toBe('3.1.0');
  });

  it('reads the version and build number from the installed binary', () => {
    // jest.setup.ts mocks expo-application as version 1.0.0, build 1.
    expect(getAppVersionLabel()).toBe('1.0.0 (1)');
  });
});
