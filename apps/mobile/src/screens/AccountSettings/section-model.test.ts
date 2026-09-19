import {
  buildAccountSettingsSectionModel,
  resolveAccountSettingsSectionCapabilities,
  type AccountSettingsDetailSection,
  type AccountSettingsSectionLabels,
} from './section-model';

const labels: AccountSettingsSectionLabels = {
  theme: 'Dark',
  accent: 'Blue',
  chatAppearance: 'Compact',
  appIcon: 'Light',
  appVersion: '3.0.0',
  previewEnvironment: 'Preview',
};

describe('AccountSettings section model', () => {
  it('builds every root and fine-grained descriptor route', () => {
    const sections: ReadonlyArray<AccountSettingsDetailSection> = [
      'pro',
      'help',
      'community',
      'about',
      'developer',
    ];

    const models = sections.map((section) => buildAccountSettingsSectionModel({
      section,
      labels,
    }));

    expect(models.map((model) => model.titleKey)).toEqual([
      'Clawket Pro',
      'Help & feedback',
      'Community',
      'About',
      'Developer',
    ]);
    expect(models.every((model) => model.supported && model.groups.length > 0)).toBe(true);
    // Connection lifecycle and details live on the shared Connection route, never in a settings section.
    expect(JSON.stringify(models)).not.toMatch(/reconnect|remove-connection|relay-/u);
  });

  it('makes unsupported sections and row-level downgrades explicit', () => {
    const unsupported = buildAccountSettingsSectionModel({
      section: 'about',
      labels,
      capabilities: { about: false },
    });
    expect(unsupported).toMatchObject({ supported: false, groups: [] });

    const developerModel = buildAccountSettingsSectionModel({
      section: 'developer',
      labels,
      data: { debugMode: true },
    });
    expect(developerModel.groups[0]?.rows.map((row) => row.id)).toEqual([
      'debug-mode',
      'preview-environment',
      'design-system',
      'preview-update-announcement',
      'simulate-free-account',
      'clear-cache',
      'reset-device',
    ]);
    expect(developerModel.groups[0]?.rows.find((row) => row.id === 'preview-update-announcement')).toMatchObject({
      kind: 'navigation',
      action: 'preview-update-announcement',
      titleKey: 'Preview update announcement',
    });
    expect(developerModel.groups[0]?.rows.find((row) => row.id === 'simulate-free-account')).toMatchObject({
      kind: 'toggle',
      toggle: 'simulateFreeAccount',
      action: 'set-simulate-free-account',
      titleKey: 'Simulate free account',
    });

    const releaseDeveloperModel = buildAccountSettingsSectionModel({
      section: 'developer',
      labels,
      data: { debugMode: false },
    });
    expect(releaseDeveloperModel.groups[0]?.rows.map((row) => row.id)).not.toContain('preview-update-announcement');
    expect(releaseDeveloperModel.groups[0]?.rows.map((row) => row.id)).not.toContain('simulate-free-account');
  });

  it('marks capability-gated rows unavailable without a paywall lock', () => {
    // Theme, chat theme and app icon moved to the settings home page and the
    // voice / notification sections were removed; Advanced settings is the
    // remaining gated navigation row.
    const about = buildAccountSettingsSectionModel({
      section: 'about',
      labels,
      capabilities: { developer: false },
    });
    expect(
      about.groups[0]?.rows.find((row) => row.id === 'advanced-settings'),
    ).toMatchObject({
      locked: false,
      disabled: true,
      valueKey: 'Unavailable',
    });
    expect(JSON.stringify(about)).not.toMatch(/app-icon|chat-appearance|speech-language|reply-notifications/u);
  });

  it('defaults only omitted capabilities', () => {
    const capabilities = resolveAccountSettingsSectionCapabilities({ designSystem: false });
    expect(capabilities.designSystem).toBe(false);
    expect(capabilities.connections).toBe(true);
  });
});
