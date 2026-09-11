export type AgentSettingsTranslator = (
  key: string,
  options?: Record<string, unknown>,
) => string;

export function translateAgentSettingsKey(
  t: AgentSettingsTranslator,
  key: string,
): string {
  if (key === 'Agent settings') return t('Agent settings', { ns: 'common' });
  if (key === 'Agent unavailable') return t('Agent unavailable', { ns: 'common' });
  if (key === 'Offline · reconnecting') return t('Offline · reconnecting', { ns: 'common' });
  if (key === 'Reconnect') return t('Reconnect', { ns: 'common' });
  if (key === 'Settings could not load') return t('Settings could not load', { ns: 'common' });
  if (key === 'Pro required for this agent') return t('Pro required for this agent', { ns: 'common' });
  if (key === 'Identity') return t('Identity', { ns: 'config' });
  if (key === 'Name and avatar') return t('Name and avatar', { ns: 'config' });
  if (key === 'Read only') return t('Read only', { ns: 'config' });
  if (key === 'Persona and memory') return t('Persona and memory', { ns: 'config' });
  if (key === 'Models') return t('Models', { ns: 'common' });
  if (key === 'Default model') return t('Default model', { ns: 'config' });
  if (key === 'Thinking level') return t('Thinking level', { ns: 'config' });
  if (key === 'Providers') return t('Providers', { ns: 'config' });
  if (key === 'Providers and cost') return t('Providers and cost', { ns: 'config' });
  if (key === 'Skills') return t('Skills', { ns: 'common' });
  if (key === 'Installed') return t('Installed', { ns: 'config' });
  if (key === 'Discover') return t('Discover', { ns: 'common' });
  if (key === 'Cron jobs') return t('Cron jobs', { ns: 'common' });
  if (key === 'Cost today') return t('Cost today', { ns: 'settings' });
  if (key === 'Tokens today') return t('Tokens today', { ns: 'settings' });
  if (key === 'Heartbeat') return t('Heartbeat', { ns: 'settings' });
  if (key === 'New cron job') return t('New cron job', { ns: 'config' });
  if (key === 'Files') return t('Files', { ns: 'common' });
  if (key === 'Agent files') return t('Agent files', { ns: 'config' });
  if (key === 'Edit files') return t('Edit files', { ns: 'config' });
  if (key === 'Usage') return t('Usage', { ns: 'common' });
  if (key === 'Activity') return t('Activity', { ns: 'config' });
  if (key === 'Cost') return t('Cost', { ns: 'common' });
  if (key === 'Connection') return t('Connection', { ns: 'common' });
  if (key === 'Status') return t('Status', { ns: 'settings' });
  if (key === 'Last ready') return t('Last ready', { ns: 'settings' });
  if (key === 'Bridge version') return t('Bridge version', { ns: 'settings' });
  if (key === 'Bridge capabilities') return t('Bridge capabilities', { ns: 'settings' });
  if (key === 'Remove connection') return t('Remove connection', { ns: 'config' });
  if (key === 'Environment') return t('Environment', { ns: 'settings' });
  if (key === 'Preview') return t('Preview', { ns: 'config' });
  if (key === 'Production') return t('Production', { ns: 'config' });
  if (key === 'OpenClaw management') return t('OpenClaw management', { ns: 'common' });
  if (key === 'Configuration') return t('Configuration', { ns: 'settings' });
  if (key === 'Permissions') return t('Permissions', { ns: 'config' });
  if (key === 'Diagnostics') return t('Diagnostics', { ns: 'config' });
  if (key === 'Backups') return t('Backups', { ns: 'config' });
  if (key === 'Tools') return t('Tools', { ns: 'common' });
  if (key === 'Tool access') return t('Tool access', { ns: 'config' });
  if (key === 'Channels & devices') return t('Channels & devices', { ns: 'common' });
  if (key === 'Channels') return t('Channels', { ns: 'common' });
  if (key === 'Devices') return t('Devices', { ns: 'settings' });
  if (key === 'Nodes') return t('Nodes', { ns: 'settings' });
  if (key === 'Logs') return t('Logs', { ns: 'common' });
  if (key === 'Gateway logs') return t('Gateway logs', { ns: 'config' });
  if (key === 'Loading...') return t('Loading...', { ns: 'common' });
  if (key === 'Not supported by this backend') {
    return t('Not supported by this backend', { ns: 'config' });
  }
  if (key === 'Pro required for this setting') {
    return t('Pro required for this setting', { ns: 'config' });
  }
  if (key === 'No available settings') return t('No available settings', { ns: 'config' });
  if (key === 'Online') return t('Online', { ns: 'common' });
  if (key === 'Connecting') return t('Connecting', { ns: 'common' });
  if (key === 'Offline') return t('Offline', { ns: 'common' });
  if (key === 'Unavailable') return t('Unavailable', { ns: 'settings' });
  if (key === 'Bridge is not running on your computer') {
    return t('Bridge is not running on your computer', { ns: 'config' });
  }
  if (key === 'OpenClaw is not responding') return t('OpenClaw is not responding', { ns: 'config' });
  if (key === 'Pairing expired, pair again') return t('Pairing expired, pair again', { ns: 'config' });
  if (key === 'Sign-in expired') return t('Sign-in expired', { ns: 'config' });
  if (key === 'No network') return t('No network', { ns: 'config' });
  if (key === 'Connection timed out') return t('Connection timed out', { ns: 'config' });
  if (key === 'Too many requests, try again later') {
    return t('Too many requests, try again later', { ns: 'config' });
  }
  if (key === 'Message too large to send') return t('Message too large to send', { ns: 'config' });
  if (key === 'Server error') return t('Server error', { ns: 'config' });
  if (key === 'Available') return t('Available', { ns: 'config' });
  if (key === 'Every Command') return t('Every Command', { ns: 'config' });
  if (key === 'Allowlist') return t('Allowlist', { ns: 'config' });
  if (key === 'Blocked') return t('Blocked', { ns: 'config' });
  if (key === 'Not set') return t('Not set', { ns: 'config' });
  return key;
}
