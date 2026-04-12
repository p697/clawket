import { buildConsoleLibraryEntryDescriptors } from './console-entry-descriptors';

describe('console-entry-descriptors', () => {
  const tConsole = ((key: string) => key) as any;
  const tCommon = ((key: string) => key) as any;

  it('uses backend-aware docs copy for Hermes', () => {
    const items = buildConsoleLibraryEntryDescriptors({
      backendKind: 'hermes',
      tConsole,
      tCommon,
    });

    expect(items.find((item) => item.key === 'docs')).toMatchObject({
      description: 'Open Hermes project documentation',
    });
  });

  it('uses OpenClaw docs copy for OpenClaw', () => {
    const items = buildConsoleLibraryEntryDescriptors({
      backendKind: 'openclaw',
      tConsole,
      tCommon,
    });

    expect(items.find((item) => item.key === 'docs')).toMatchObject({
      description: 'OpenClaw protocol docs',
    });
  });
});
