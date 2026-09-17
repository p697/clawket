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
  speechLanguage: 'Japanese',
  appVersion: '3.0.0',
  previewEnvironment: 'Preview',
};

describe('AccountSettings section model', () => {
  it('builds every root and fine-grained descriptor route', () => {
    const sections: ReadonlyArray<AccountSettingsDetailSection> = [
      'pro',
      'appearance',
      'voice',
      'notifications',
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
      'Appearance',
      'Voice',
      'Chat & notifications',
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
      'clear-cache',
      'reset-device',
    ]);
    expect(developerModel.groups[0]?.rows.find((row) => row.id === 'preview-update-announcement')).toMatchObject({
      kind: 'navigation',
      action: 'preview-update-announcement',
      titleKey: 'Preview update announcement',
    });

    const releaseDeveloperModel = buildAccountSettingsSectionModel({
      section: 'developer',
      labels,
      data: { debugMode: false },
    });
    expect(releaseDeveloperModel.groups[0]?.rows.map((row) => row.id)).not.toContain('preview-update-announcement');
  });

  it('keeps paywall locks separate from backend capability gates', () => {
    const appearance = buildAccountSettingsSectionModel({
      section: 'appearance',
      labels,
      data: { isPro: false },
    });
    expect(appearance.groups[0]?.rows.find((row) => row.id === 'app-icon')).toMatchObject({
      locked: true,
      paywallReason: 'appIcons',
    });

    const unavailableAppearance = buildAccountSettingsSectionModel({
      section: 'appearance',
      labels,
      data: { isPro: false },
      capabilities: { appIcons: false },
    });
    expect(
      unavailableAppearance.groups[0]?.rows.find((row) => row.id === 'app-icon'),
    ).toMatchObject({
      locked: false,
      disabled: true,
      valueKey: 'Unavailable',
    });
  });

  it('defaults only omitted capabilities', () => {
    const capabilities = resolveAccountSettingsSectionCapabilities({ designSystem: false });
    expect(capabilities.designSystem).toBe(false);
    expect(capabilities.connections).toBe(true);
  });
});
