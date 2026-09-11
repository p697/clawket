const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const RELEASE_TASK_PREDICATE = 'task.name?.toLowerCase()?.contains("release")';

const SIGNING_BLOCK = `def releaseKeystorePropertiesFile = rootProject.file("app/keystore.properties")
def releaseKeystoreProperties = new Properties()
def releaseKeystorePropertiesLoaded = false

if (releaseKeystorePropertiesFile.exists()) {
    releaseKeystorePropertiesFile.withInputStream { stream ->
        releaseKeystoreProperties.load(stream)
    }
    releaseKeystorePropertiesLoaded = true
}

def readReleaseSigningValue = { String propertyKey, String envKey ->
    def envValue = System.getenv(envKey)
    if (envValue != null && !envValue.trim().isEmpty()) {
        return envValue.trim()
    }

    if (!releaseKeystorePropertiesLoaded) {
        return null
    }

    def propertyValue = releaseKeystoreProperties.getProperty(propertyKey)
    if (propertyValue == null) {
        return null
    }

    def trimmedValue = propertyValue.trim()
    return trimmedValue.isEmpty() ? null : trimmedValue
}

def releaseStoreFileValue = readReleaseSigningValue("storeFile", "CLAWKET_ANDROID_KEYSTORE_PATH")
def releaseStorePasswordValue = readReleaseSigningValue("storePassword", "CLAWKET_ANDROID_KEYSTORE_PASSWORD")
def releaseKeyAliasValue = readReleaseSigningValue("keyAlias", "CLAWKET_ANDROID_KEY_ALIAS")
def releaseKeyPasswordValue = readReleaseSigningValue("keyPassword", "CLAWKET_ANDROID_KEY_PASSWORD")
def hasReleaseSigningConfig = releaseStoreFileValue && releaseStorePasswordValue && releaseKeyAliasValue && releaseKeyPasswordValue
def allowDebugReleaseSigning = (findProperty("clawket.allowDebugReleaseSigning") ?: System.getenv("CLAWKET_ALLOW_DEBUG_RELEASE_SIGNING") ?: "false").toString().toBoolean()
def isEasBuild = (System.getenv("EAS_BUILD") ?: "false").toString().toBoolean()

gradle.taskGraph.whenReady { graph ->
    def releaseTaskRequested = graph.allTasks.any { task ->
        ${RELEASE_TASK_PREDICATE}
    }

    if (releaseTaskRequested && !hasReleaseSigningConfig && !allowDebugReleaseSigning && !isEasBuild) {
        throw new GradleException(
            "Missing Android release signing config. " +
            "Provide CLAWKET_ANDROID_KEYSTORE_PATH / CLAWKET_ANDROID_KEYSTORE_PASSWORD / " +
            "CLAWKET_ANDROID_KEY_ALIAS / CLAWKET_ANDROID_KEY_PASSWORD, create android/app/keystore.properties, " +
            "or run inside EAS Build with remote credentials enabled. " +
            "For temporary local-only testing, rerun with -Pclawket.allowDebugReleaseSigning=true."
        )
    }
}
`;

const SIGNING_CONFIG_BLOCK = `        if (hasReleaseSigningConfig) {
            release {
                storeFile file(releaseStoreFileValue)
                storePassword releaseStorePasswordValue
                keyAlias releaseKeyAliasValue
                keyPassword releaseKeyPasswordValue
            }
        }`;

const RELEASE_SIGNING_BRANCH = `            if (hasReleaseSigningConfig) {
                signingConfig signingConfigs.release
            } else {
                signingConfig signingConfigs.debug
            }`;
const DEBUG_SIGNING_LINE = `            signingConfig signingConfigs.debug`;

const KEYSTORE_PROPERTIES_EXAMPLE = `storeFile=/absolute/path/to/clawket-upload.keystore
storePassword=replace-me
keyAlias=upload
keyPassword=replace-me
`;

function findGroovyBlockRange(src, header, fromIndex = 0) {
  const headerIndex = src.indexOf(header, fromIndex);
  if (headerIndex === -1) {
    throw new Error(`Android build.gradle is missing required block: ${header.trim()}`);
  }

  const openingBraceIndex = src.indexOf('{', headerIndex + header.length - 1);
  if (openingBraceIndex === -1) {
    throw new Error(`Android build.gradle has a malformed block: ${header.trim()}`);
  }

  let depth = 0;
  for (let index = openingBraceIndex; index < src.length; index += 1) {
    if (src[index] === '{') {
      depth += 1;
    } else if (src[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        return { start: headerIndex, end: index + 1 };
      }
    }
  }

  throw new Error(`Android build.gradle has an unterminated block: ${header.trim()}`);
}

function updateBuildTypes(src) {
  const buildTypesRange = findGroovyBlockRange(src, '    buildTypes {');
  let buildTypesBlock = src.slice(buildTypesRange.start, buildTypesRange.end);

  const debugRange = findGroovyBlockRange(buildTypesBlock, '        debug {');
  let debugBlock = buildTypesBlock.slice(debugRange.start, debugRange.end);
  if (debugBlock.includes(RELEASE_SIGNING_BRANCH)) {
    debugBlock = debugBlock.replace(RELEASE_SIGNING_BRANCH, DEBUG_SIGNING_LINE);
  }
  if (!debugBlock.includes(DEBUG_SIGNING_LINE)) {
    throw new Error('Android debug build type is missing its debug signing config.');
  }
  buildTypesBlock = `${buildTypesBlock.slice(0, debugRange.start)}${debugBlock}${buildTypesBlock.slice(debugRange.end)}`;

  const releaseRange = findGroovyBlockRange(buildTypesBlock, '        release {');
  let releaseBlock = buildTypesBlock.slice(releaseRange.start, releaseRange.end);
  if (!releaseBlock.includes(RELEASE_SIGNING_BRANCH)) {
    if (!releaseBlock.includes(DEBUG_SIGNING_LINE)) {
      throw new Error('Android release build type is missing its signing config anchor.');
    }
    releaseBlock = releaseBlock.replace(DEBUG_SIGNING_LINE, RELEASE_SIGNING_BRANCH);
  }
  buildTypesBlock = `${buildTypesBlock.slice(0, releaseRange.start)}${releaseBlock}${buildTypesBlock.slice(releaseRange.end)}`;

  return `${src.slice(0, buildTypesRange.start)}${buildTypesBlock}${src.slice(buildTypesRange.end)}`;
}

function applyReleaseSigningToGradle(src) {
  let next = src;

  if (!next.includes('def releaseKeystorePropertiesFile = rootProject.file("app/keystore.properties")')) {
    if (!next.includes('def projectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()')) {
      throw new Error('Android build.gradle is missing the projectRoot signing insertion anchor.');
    }
    next = next.replace(
      'def projectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()',
      `def projectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()\n${SIGNING_BLOCK}`,
    );
  }

  if (!next.includes('if (hasReleaseSigningConfig) {\n            release {')) {
    const debugSigningConfig = `        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }`;
    if (!next.includes(debugSigningConfig)) {
      throw new Error('Android build.gradle is missing the debug signing config insertion anchor.');
    }
    next = next.replace(
      debugSigningConfig,
      `${debugSigningConfig}
${SIGNING_CONFIG_BLOCK}`,
    );
  }

  next = updateBuildTypes(next);

  if (!next.includes(RELEASE_TASK_PREDICATE) || next.includes('contains("bundle")')) {
    throw new Error('Android release task guard is missing or still matches debug bundle tasks.');
  }

  return next;
}

function isReleaseTaskName(taskName) {
  return typeof taskName === 'string' && taskName.toLowerCase().includes('release');
}

function withAndroidReleaseSigning(config) {
  config = withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withAndroidReleaseSigning only supports Groovy build.gradle files.');
    }

    cfg.modResults.contents = applyReleaseSigningToGradle(cfg.modResults.contents);
    return cfg;
  });

  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const targetPath = path.join(cfg.modRequest.projectRoot, 'android-keystore.properties.example');
      if (!fs.existsSync(targetPath)) {
        fs.writeFileSync(targetPath, KEYSTORE_PROPERTIES_EXAMPLE);
      }

      return cfg;
    },
  ]);
}

module.exports = withAndroidReleaseSigning;
module.exports.applyReleaseSigningToGradle = applyReleaseSigningToGradle;
module.exports.isReleaseTaskName = isReleaseTaskName;
