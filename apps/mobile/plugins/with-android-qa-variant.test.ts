const { applyQaBuildGradle, applyQaManifest } = require('./with-android-qa-variant.js') as {
  applyQaBuildGradle: (contents: string) => string;
  applyQaManifest: <T>(manifest: T) => T;
};

const BUILD_GRADLE = `apply plugin: "com.android.application"

android {
    ndkVersion rootProject.ext.ndkVersion
    namespace 'com.p697.clawket'
    defaultConfig {
        applicationId 'com.p697.clawket'
        minSdkVersion rootProject.ext.minSdkVersion
    }
}
`;

type Manifest = { manifest: { application?: Array<{ $: Record<string, string> }> } };
const manifestWithLabel = (label: string): Manifest => ({ manifest: { application: [{ $: { 'android:label': label } }] } });

describe('withAndroidQaVariant', () => {
  it('adds an opt-in .qa suffix and label while keeping the namespace and store ID', () => {
    const output = applyQaBuildGradle(BUILD_GRADLE);
    expect(output).toContain('findProperty("clawket.qa") ?: System.getenv("CLAWKET_ANDROID_QA")');
    expect(output.indexOf('def clawketQaBuild')).toBeLessThan(output.indexOf('android {'));
    expect(output).toContain("namespace 'com.p697.clawket'");
    expect(output).toContain("applicationId 'com.p697.clawket'\n        if (clawketQaBuild) {");
    expect(output).toContain('applicationIdSuffix ".qa"');
    expect(output).toContain('manifestPlaceholders.put("clawketAppLabel", clawketQaBuild ? "Clawket QA" : "@string/app_name")');
    expect(applyQaBuildGradle(output)).toBe(output);
  });

  it('fails closed when the generated build.gradle anchors change', () => {
    expect(() => applyQaBuildGradle('plugins {}\n')).toThrow('android block');
    expect(() => applyQaBuildGradle('android {\n    defaultConfig {\n    }\n}\n')).toThrow('applicationId');
  });

  it('routes only the store application label through the QA placeholder', () => {
    const manifest = manifestWithLabel('@string/app_name');
    expect(applyQaManifest(manifest).manifest.application?.[0].$['android:label']).toBe('${clawketAppLabel}');
    expect(applyQaManifest(manifest).manifest.application?.[0].$['android:label']).toBe('${clawketAppLabel}');
    expect(() => applyQaManifest(manifestWithLabel('Other'))).toThrow('Unexpected Android application label');
    expect(() => applyQaManifest({ manifest: {} })).toThrow('application element');
  });
});
