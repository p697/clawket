const { withAndroidStyles, withMainActivity } = require('expo/config-plugins');

const IMPORT_START = '// @generated begin clawket-system-bars-imports';
const IMPORT_END = '// @generated end clawket-system-bars-imports';
const IMPORT_ANCHOR = 'import android.os.Bundle';
const IMPORT_BLOCK = `${IMPORT_START}
import android.content.res.Configuration
import androidx.core.view.WindowInsetsControllerCompat
${IMPORT_END}`;

const CREATE_START = '    // @generated begin clawket-navigation-bar-create';
const CREATE_END = '    // @generated end clawket-navigation-bar-create';
const CREATE_ANCHOR = '    super.onCreate(null)';
const CREATE_BLOCK = `${CREATE_START}
    applyNavigationBarAppearance(resources.configuration)
${CREATE_END}`;

const OVERRIDE_START = '  // @generated begin clawket-system-bars';
const OVERRIDE_END = '  // @generated end clawket-system-bars';
const OVERRIDE_ANCHOR = 'override fun getMainComponentName(): String = "main"';
const OVERRIDE_BLOCK = `${OVERRIDE_START}
  // The app theme (Settings -> Theme) can differ from the system one and reaches the activity later
  // as a uiMode change, so the navigation bar follows it here as well as on creation.
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    applyNavigationBarAppearance(newConfig)
  }

  // AppTheme opts out of the platform contrast scrim (a white band under 3-button navigation over
  // the chat wallpaper). React Native then leaves the button color alone, so it is set here.
  private fun applyNavigationBarAppearance(config: Configuration) {
    val night = (config.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightNavigationBars = !night
  }
${OVERRIDE_END}`;

const APP_THEME = 'AppTheme';
const CONTRAST_ITEM = 'android:enforceNavigationBarContrast';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function upsertBlock(contents, { start, end, block, anchor, label }) {
  const hasStart = contents.includes(start);
  const hasEnd = contents.includes(end);
  if (hasStart !== hasEnd) {
    throw new Error(`MainActivity contains an incomplete generated ${label} block.`);
  }
  if (hasStart) {
    return contents.replace(new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, 'm'), block);
  }
  const anchorIndex = contents.indexOf(anchor);
  if (anchorIndex === -1) throw new Error(`MainActivity is missing the ${label} anchor: ${anchor}`);
  if (contents.indexOf(anchor, anchorIndex + anchor.length) !== -1) {
    throw new Error(`MainActivity has more than one ${label} anchor: ${anchor}`);
  }
  const lineEnd = contents.indexOf('\n', anchorIndex);
  const insertionPoint = lineEnd === -1 ? contents.length : lineEnd;
  return `${contents.slice(0, insertionPoint)}\n${block}${contents.slice(insertionPoint)}`;
}

/** Adds the navigation bar appearance sync to a generated Kotlin MainActivity; fails closed on drift. */
function applyAndroidSystemBars(contents) {
  if (!contents.includes('class MainActivity : ReactActivity()')) {
    throw new Error('MainActivity is not the expected Kotlin ReactActivity.');
  }
  const blocks = [
    [IMPORT_START, IMPORT_END, 'system-bars import'],
    [CREATE_START, CREATE_END, 'navigation-bar create'],
    [OVERRIDE_START, OVERRIDE_END, 'system-bars override'],
  ];
  for (const [start, end, label] of blocks) {
    if (contents.includes(start) !== contents.includes(end)) {
      throw new Error(`MainActivity contains an incomplete generated ${label} block.`);
    }
  }
  const withoutOwnBlock = contents.replace(
    new RegExp(`${escapeRegExp(OVERRIDE_START)}[\\s\\S]*?${escapeRegExp(OVERRIDE_END)}`, 'm'),
    '',
  );
  if (withoutOwnBlock.includes('fun onConfigurationChanged(') || withoutOwnBlock.includes('fun applyNavigationBarAppearance(')) {
    throw new Error('MainActivity already overrides onConfigurationChanged; merge the navigation bar sync by hand.');
  }
  const withImports = upsertBlock(contents, {
    start: IMPORT_START, end: IMPORT_END, block: IMPORT_BLOCK, anchor: IMPORT_ANCHOR, label: 'system-bars import',
  });
  const withCreate = upsertBlock(withImports, {
    start: CREATE_START, end: CREATE_END, block: CREATE_BLOCK, anchor: CREATE_ANCHOR, label: 'navigation-bar create',
  });
  return upsertBlock(withCreate, {
    start: OVERRIDE_START, end: OVERRIDE_END, block: OVERRIDE_BLOCK, anchor: OVERRIDE_ANCHOR, label: 'system-bars override',
  });
}

/** Turns off the navigation bar contrast scrim on AppTheme (API 29+); fails closed without AppTheme. */
function applyNavigationBarContrastStyle(styles) {
  const list = styles?.resources?.style;
  if (!Array.isArray(list)) throw new Error('Android styles.xml has no styles.');
  const theme = list.find((style) => style?.$?.name === APP_THEME);
  if (!theme) throw new Error(`Android styles.xml is missing ${APP_THEME}.`);
  const items = (theme.item ?? []).filter((item) => item?.$?.name !== CONTRAST_ITEM);
  items.push({ _: 'false', $: { name: CONTRAST_ITEM, 'tools:targetApi': '29' } });
  theme.item = items;
  return styles;
}

function withAndroidSystemBars(config) {
  const withStyles = withAndroidStyles(config, (next) => {
    next.modResults = applyNavigationBarContrastStyle(next.modResults);
    return next;
  });
  return withMainActivity(withStyles, (next) => {
    if (next.modResults.language !== 'kt') {
      throw new Error('with-android-system-bars expects a Kotlin MainActivity.');
    }
    next.modResults.contents = applyAndroidSystemBars(next.modResults.contents);
    return next;
  });
}

module.exports = withAndroidSystemBars;
module.exports.applyAndroidSystemBars = applyAndroidSystemBars;
module.exports.applyNavigationBarContrastStyle = applyNavigationBarContrastStyle;
