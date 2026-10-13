import React, { useEffect, useMemo, useState } from 'react';
import { I18nManager, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Space } from '../theme/tokens';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../theme';
import { getRuntimePlatform } from '../utils/platform';
import { resolveWorkspaceLayout } from '../utils/ipad-layout';

import { WorkspaceContext } from './workspace-context';

/** The navigator stays in the same slot across resize, rotation and sidebar changes. */
export function AdaptiveWorkspace({ routeName, selectionKey, roster, children }: {
  routeName: string;
  selectionKey?: string;
  roster: React.ReactNode;
  children: (wideRoster: boolean) => React.ReactNode;
}): React.JSX.Element {
  const { width, fontScale } = useWindowDimensions();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const usableWidth = Math.max(0, width - insets.left - insets.right);
  const enabled = getRuntimePlatform() === 'ios';
  const horizontalInsets = enabled ? {
    paddingStart: I18nManager.isRTL ? insets.right : insets.left,
    paddingEnd: I18nManager.isRTL ? insets.left : insets.right,
  } : { paddingLeft: insets.left, paddingRight: insets.right };
  const { t } = useTranslation('common');
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const layout = resolveWorkspaceLayout({ width: usableWidth, fontScale, enabled });
  const eligible = !['Onboarding', 'Paywall'].includes(routeName);
  const wideRoster = layout.wide && eligible && (routeName === 'Roster' || !collapsed);
  const overlay = layout.canShowRoster && eligible && !layout.wide && drawer && routeName !== 'Roster';
  useEffect(() => { setDrawer(false); }, [routeName, selectionKey, layout.wide, layout.canShowRoster]);
  const context = useMemo(() => ({
    constrainContent: layout.canShowRoster,
    dismissRoster: () => setDrawer(false),
    paneWidth: enabled ? Math.max(0, usableWidth - (wideRoster ? layout.sidebarWidth : 0)) : undefined,
    toggleRoster: layout.canShowRoster ? () => {
      if (layout.wide) setCollapsed(value => !value);
      else setDrawer(value => !value);
    } : undefined,
  }), [enabled, usableWidth, wideRoster, layout.sidebarWidth, layout.wide, layout.canShowRoster]);
  return (
    <WorkspaceContext.Provider value={context}>
      <View testID="workspace" style={[styles.workspace, { backgroundColor: theme.colors.canvas }, horizontalInsets]}>
        <View testID="workspace-sidebar" style={[
          styles.sidebar,
          { width: layout.sidebarWidth, display: wideRoster ? 'flex' : 'none' },
        ]} accessibilityElementsHidden={!wideRoster} importantForAccessibility={wideRoster ? 'auto' : 'no-hide-descendants'}>
          {wideRoster ? roster : null}
        </View>
        <View testID="workspace-detail" style={styles.detail}
          accessibilityElementsHidden={overlay} importantForAccessibility={overlay ? 'no-hide-descendants' : 'auto'}>
          {children(wideRoster)}
        </View>
        {overlay ? <View testID="workspace-roster-overlay" style={[StyleSheet.absoluteFill, horizontalInsets]} accessibilityViewIsModal>
          <Pressable testID="workspace-dismiss-roster" accessibilityRole="button" accessibilityLabel={t('Close')}
            onPress={() => setDrawer(false)} style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.scrim }]} />
          <View testID="workspace-roster-drawer" style={[styles.drawer, { width: Math.min(layout.sidebarWidth, usableWidth - Space.xl * 2), backgroundColor: theme.colors.canvas }]}>
            {roster}
          </View>
        </View> : null}
      </View>
    </WorkspaceContext.Provider>
  );
}

const styles = StyleSheet.create({
  workspace: { flex: 1, flexDirection: 'row' },
  sidebar: { flexShrink: 0 },
  detail: { flex: 1, minWidth: 0 },
  drawer: { height: '100%' },
});
