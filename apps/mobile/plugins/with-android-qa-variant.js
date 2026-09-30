const { withAndroidManifest, withAppBuildGradle } = require('expo/config-plugins');

// Local QA builds (-Pclawket.qa=true or CLAWKET_ANDROID_QA=1) install beside the store app:
// the application ID gains a .qa suffix and the launcher label reads "Clawket QA". The
// Kotlin namespace is unchanged, so generated sources and widget providers keep their package.
const QA_PROPERTY_LINE = 'def clawketQaBuild = (findProperty("clawket.qa") ?: System.getenv("CLAWKET_ANDROID_QA") ?: "false").toString().toBoolean()';
const QA_DEFAULT_CONFIG_BLOCK = `        if (clawketQaBuild) {
            applicationIdSuffix ".qa"
        }
        manifestPlaceholders.put("clawketAppLabel", clawketQaBuild ? "Clawket QA" : "@string/app_name")`;
const APPLICATION_ID_LINE = /^ {8}applicationId ['"][^'"]+['"]\n/m;
const STORE_LABEL = '@string/app_name';
const QA_LABEL_PLACEHOLDER = '${clawketAppLabel}';

function applyQaBuildGradle(src) {
  let output = src;
  if (!output.includes(QA_PROPERTY_LINE)) {
    const androidIndex = output.search(/^android \{/m);
    if (androidIndex === -1) {
      throw new Error('Android build.gradle is missing its android block.');
    }
    output = `${output.slice(0, androidIndex)}${QA_PROPERTY_LINE}\n\n${output.slice(androidIndex)}`;
  }
  if (!output.includes(QA_DEFAULT_CONFIG_BLOCK)) {
    const match = APPLICATION_ID_LINE.exec(output);
    if (!match) {
      throw new Error('Android defaultConfig is missing its applicationId.');
    }
    const insertAt = match.index + match[0].length;
    output = `${output.slice(0, insertAt)}${QA_DEFAULT_CONFIG_BLOCK}\n${output.slice(insertAt)}`;
  }
  return output;
}

function applyQaManifest(manifest) {
  const application = manifest?.manifest?.application?.[0];
  if (!application?.$) {
    throw new Error('AndroidManifest.xml is missing its application element.');
  }
  const label = application.$['android:label'];
  if (label !== STORE_LABEL && label !== QA_LABEL_PLACEHOLDER) {
    throw new Error(`Unexpected Android application label ${label}; update with-android-qa-variant.`);
  }
  application.$['android:label'] = QA_LABEL_PLACEHOLDER;
  return manifest;
}

function withAndroidQaVariant(config) {
  config = withAppBuildGradle(config, (nextConfig) => {
    if (nextConfig.modResults.language !== 'groovy') {
      throw new Error('with-android-qa-variant supports only a Groovy app build.gradle.');
    }
    nextConfig.modResults.contents = applyQaBuildGradle(nextConfig.modResults.contents);
    return nextConfig;
  });
  return withAndroidManifest(config, (nextConfig) => {
    nextConfig.modResults = applyQaManifest(nextConfig.modResults);
    return nextConfig;
  });
}

module.exports = withAndroidQaVariant;
module.exports.applyQaBuildGradle = applyQaBuildGradle;
module.exports.applyQaManifest = applyQaManifest;
