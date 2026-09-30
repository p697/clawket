type StyleItem = { _: string; $: Record<string, string> };
type Styles = { resources: { style?: Array<{ $: { name: string; parent?: string }; item?: StyleItem[] }> } };
const { applyAndroidSystemBars, applyNavigationBarContrastStyle } = require('./with-android-system-bars.js') as {
  applyAndroidSystemBars: (contents: string) => string;
  applyNavigationBarContrastStyle: (styles: Styles) => Styles;
};

const MAIN_ACTIVITY = `package com.p697.clawket
import expo.modules.splashscreen.SplashScreenManager

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    SplashScreenManager.registerOnActivity(this)
    super.onCreate(null)
  }

  override fun getMainComponentName(): String = "main"

  override fun invokeDefaultOnBackPressed() {
    super.invokeDefaultOnBackPressed()
  }
}
`;

describe('withAndroidSystemBars', () => {
  it('applies the navigation bar appearance on creation and when the app night mode changes', () => {
    const output = applyAndroidSystemBars(MAIN_ACTIVITY);
    expect(output).toContain('import android.content.res.Configuration');
    expect(output).toContain('import androidx.core.view.WindowInsetsControllerCompat');
    expect(output).toContain('override fun onConfigurationChanged(newConfig: Configuration)');
    expect(output).toContain('isAppearanceLightNavigationBars = !night');
    // After super.onCreate, so the splash hand-off and React Native's window setup ran first.
    expect(output.indexOf('super.onCreate(null)')).toBeLessThan(output.indexOf('applyNavigationBarAppearance(resources.configuration)'));
    expect(output.indexOf('applyNavigationBarAppearance(resources.configuration)')).toBeLessThan(output.indexOf('getMainComponentName'));
    // Inside the class, after the component name and before the back handling.
    expect(output.indexOf('getMainComponentName')).toBeLessThan(output.indexOf('onConfigurationChanged'));
    expect(output.indexOf('onConfigurationChanged')).toBeLessThan(output.indexOf('invokeDefaultOnBackPressed'));
    expect(output.indexOf('super.onConfigurationChanged(newConfig)'))
      .toBeLessThan(output.indexOf('isAppearanceLightNavigationBars'));
  });

  it('is idempotent across repeated prebuilds', () => {
    const once = applyAndroidSystemBars(MAIN_ACTIVITY);
    expect(applyAndroidSystemBars(once)).toBe(once);
  });

  it('fails closed on a changed template, a duplicate anchor or a hand-written override', () => {
    expect(() => applyAndroidSystemBars(MAIN_ACTIVITY.replace('class MainActivity : ReactActivity()', 'class MainActivity : Activity()')))
      .toThrow(/Kotlin ReactActivity/);
    expect(() => applyAndroidSystemBars(MAIN_ACTIVITY.replace('import android.os.Bundle\n', '')))
      .toThrow(/import anchor/);
    expect(() => applyAndroidSystemBars(MAIN_ACTIVITY.replace('override fun getMainComponentName(): String = "main"', 'override fun getMainComponentName() = "main"')))
      .toThrow(/override anchor/);
    expect(() => applyAndroidSystemBars(`${MAIN_ACTIVITY}\n// override fun getMainComponentName(): String = "main"\n`))
      .toThrow(/more than one/);
    expect(() => applyAndroidSystemBars(MAIN_ACTIVITY.replace(
      '  override fun invokeDefaultOnBackPressed() {',
      '  override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {\n    super.onConfigurationChanged(newConfig)\n  }\n\n  override fun invokeDefaultOnBackPressed() {',
    ))).toThrow(/already overrides/);
    const truncated = applyAndroidSystemBars(MAIN_ACTIVITY).replace('  // @generated end clawket-system-bars\n', '');
    expect(() => applyAndroidSystemBars(truncated)).toThrow(/incomplete/);
    const truncatedCreate = applyAndroidSystemBars(MAIN_ACTIVITY).replace('    // @generated end clawket-navigation-bar-create\n', '');
    expect(() => applyAndroidSystemBars(truncatedCreate)).toThrow(/incomplete generated navigation-bar create/);
    expect(() => applyAndroidSystemBars(MAIN_ACTIVITY.replace('    super.onCreate(null)\n', '    super.onCreate(savedInstanceState)\n')))
      .toThrow(/create anchor/);
  });
});

describe('navigation bar contrast style', () => {
  const styles = (): Styles => ({ resources: { style: [
    { $: { name: 'AppTheme', parent: 'Theme.AppCompat.DayNight.NoActionBar' }, item: [
      { _: '@android:color/transparent', $: { name: 'android:navigationBarColor' } },
    ] },
    { $: { name: 'Theme.App.SplashScreen', parent: 'Theme.SplashScreen' }, item: [] },
  ] } });

  it('turns off the 3-button navigation contrast scrim on AppTheme only, once', () => {
    const once = applyNavigationBarContrastStyle(styles());
    const appTheme = once.resources.style![0]!;
    expect(appTheme.item).toContainEqual({ _: 'false', $: { name: 'android:enforceNavigationBarContrast', 'tools:targetApi': '29' } });
    expect(appTheme.item).toContainEqual({ _: '@android:color/transparent', $: { name: 'android:navigationBarColor' } });
    expect(once.resources.style![1]!.item).toEqual([]);
    const twice = applyNavigationBarContrastStyle(once);
    expect(twice.resources.style![0]!.item!.filter((item) => item.$.name === 'android:enforceNavigationBarContrast')).toHaveLength(1);
  });

  it('fails closed without styles or AppTheme', () => {
    expect(() => applyNavigationBarContrastStyle({ resources: {} })).toThrow(/no styles/);
    expect(() => applyNavigationBarContrastStyle({ resources: { style: [{ $: { name: 'Other' } }] } })).toThrow(/missing AppTheme/);
  });
});
