export type AccountSettingsNamespace = 'common' | 'config' | 'settings';

export type AccountSettingsTranslator = (
  key: string,
  options?: Record<string, unknown>,
) => string;

function translateCommon(t: AccountSettingsTranslator, key: string): string {
  if (key === 'Advanced settings') return t('Advanced settings', { ns: 'config' });
  if (key === 'Chat & notifications') return t('Chat & notifications', { ns: 'config' });
  if (key === 'Help & feedback') return t('Help & feedback', { ns: 'config' });
  if (key === 'Offline') return t('Offline', { ns: 'common' });
  if (key === 'Connecting') return t('Connecting', { ns: 'common' });
  if (key === 'Online') return t('Online', { ns: 'common' });
  if (key === 'Error') return t('Error', { ns: 'common' });
  if (key === 'Uptime') return t('Uptime', { ns: 'common' });
  if (key === 'Reconnect') return t('Reconnect', { ns: 'common' });
  if (key === 'Remove') return t('Remove', { ns: 'common' });
  return key;
}

function translateSettings(t: AccountSettingsTranslator, key: string): string {
  if (key === 'Server address') return t('Server address', { ns: 'settings' });
  if (key === 'Environment') return t('Environment', { ns: 'settings' });
  if (key === 'Unavailable') return t('Unavailable', { ns: 'settings' });
  return key;
}

function translateConfig(t: AccountSettingsTranslator, key: string): string {
  if (key === 'Advanced settings') return t('Advanced settings', { ns: 'config' });
  if (key === 'Chat & notifications') return t('Chat & notifications', { ns: 'config' });
  if (key === 'Help & feedback') return t('Help & feedback', { ns: 'config' });
  if (key === 'Pro') return t('Pro', { ns: 'config' });
  if (key === 'Clawket Pro') return t('Clawket Pro', { ns: 'config' });
  if (key === 'Active') return t('Active', { ns: 'config' });
  if (key === 'Free') return t('Free', { ns: 'config' });
  if (key === 'Restore Purchases') return t('Restore Purchases', { ns: 'config' });
  if (key === 'Connections') return t('Connections', { ns: 'config' });
  if (key === 'Add Connection') return t('Add Connection', { ns: 'config' });
  if (key === 'Theme') return t('Theme', { ns: 'config' });
  if (key === 'Accent Color') return t('Accent Color', { ns: 'config' });
  if (key === 'Chat theme') return t('Chat theme', { ns: 'config' });
  if (key === 'Chat Appearance') return t('Chat Appearance', { ns: 'config' });
  if (key === 'App Icon') return t('App Icon', { ns: 'config' });
  if (key === 'Appearance') return t('Appearance', { ns: 'config' });
  if (key === 'Voice') return t('Voice', { ns: 'config' });
  if (key === 'Recognition Language') return t('Recognition Language', { ns: 'config' });
  if (key === 'Notifications') return t('Notifications', { ns: 'config' });
  if (key === 'Reply Notifications') return t('Reply Notifications', { ns: 'config' });
  if (key === 'Help') return t('Help', { ns: 'config' });
  if (key === 'Help Center') return t('Help Center', { ns: 'config' });
  if (key === 'OpenClaw Documentation') return t('OpenClaw Documentation', { ns: 'config' });
  if (key === 'Hermes Documentation') return t('Hermes Documentation', { ns: 'config' });
  if (key === 'Release Notes') return t('Release Notes', { ns: 'config' });
  if (key === 'OpenClaw Releases') return t('OpenClaw Releases', { ns: 'config' });
  if (key === 'Send Feedback') return t('Send Feedback', { ns: 'config' });
  if (key === 'Share Clawket') return t('Share Clawket', { ns: 'config' });
  if (key === 'Rate Clawket') return t('Rate Clawket', { ns: 'config' });
  if (key === 'Discord') return t('Discord', { ns: 'config' });
  if (key === 'Community') return t('Community', { ns: 'config' });
  if (key === 'About') return t('About', { ns: 'config' });
  if (key === 'Version') return t('Version', { ns: 'config' });
  if (key === 'Open Source Repository') return t('Open Source Repository', { ns: 'config' });
  if (key === 'Privacy Policy') return t('Privacy Policy', { ns: 'config' });
  if (key === 'Terms of Use') return t('Terms of Use', { ns: 'config' });
  if (key === 'Debug Mode') return t('Debug Mode', { ns: 'config' });
  if (key === 'Relay Environment') return t('Relay Environment', { ns: 'config' });
  if (key === 'Design System') return t('Design System', { ns: 'config' });
  if (key === 'Preview update announcement') return t('Preview update announcement', { ns: 'config' });
  if (key === 'Clear Cache') return t('Clear Cache', { ns: 'config' });
  if (key === 'Reset Device') return t('Reset Device', { ns: 'config' });
  if (key === 'Developer') return t('Developer', { ns: 'config' });
  if (key === 'Backend') return t('Backend', { ns: 'config' });
  if (key === 'Transport') return t('Transport', { ns: 'config' });
  if (key === 'Server address') return t('Server address', { ns: 'settings' });
  if (key === 'Environment') return t('Environment', { ns: 'settings' });
  if (key === 'Status') return t('Status', { ns: 'config' });
  if (key === 'Relay') return t('Relay', { ns: 'config' });
  if (key === 'Unknown') return t('Unknown', { ns: 'config' });
  if (key === 'OpenClaw') return t('OpenClaw', { ns: 'config' });
  if (key === 'Hermes') return t('Hermes', { ns: 'config' });
  if (key === 'YouMind Sprite') return t('YouMind Sprite', { ns: 'config' });
  if (key === 'Local') return t('Local', { ns: 'config' });
  if (key === 'Tailscale') return t('Tailscale', { ns: 'config' });
  if (key === 'Cloudflare') return t('Cloudflare', { ns: 'config' });
  if (key === 'Custom') return t('Custom', { ns: 'config' });
  if (key === 'HTTPS') return t('HTTPS', { ns: 'config' });
  if (key === 'Production') return t('Production', { ns: 'config' });
  if (key === 'Preview') return t('Preview', { ns: 'config' });
  return key;
}

export function translateAccountSettingsKey(
  t: AccountSettingsTranslator,
  key: string,
  namespace: AccountSettingsNamespace = 'config',
): string {
  if (namespace === 'common') return translateCommon(t, key);
  if (namespace === 'settings') return translateSettings(t, key);
  return translateConfig(t, key);
}
