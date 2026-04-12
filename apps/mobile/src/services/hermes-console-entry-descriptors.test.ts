import { buildHermesConsoleActionDescriptors } from './hermes-console-entry-descriptors';

describe('hermes-console-entry-descriptors', () => {
  const tConsole = ((key: string) => key) as any;
  const tCommon = ((key: string) => key) as any;

  it('builds stable Hermes console actions with docs params when available', () => {
    const items = buildHermesConsoleActionDescriptors({
      tConsole,
      tCommon,
      docsUrl: 'https://hermes-agent.nousresearch.com/docs/getting-started/quickstart',
    });

    expect(items.map((item) => item.key)).toEqual([
      'sessions',
      'history',
      'cron',
      'skills',
      'memory',
      'usage',
      'docs',
    ]);
    expect(items.at(-1)).toMatchObject({
      screen: 'Docs',
      params: { url: 'https://hermes-agent.nousresearch.com/docs/getting-started/quickstart' },
    });
  });

  it('omits docs params when no docs url is available', () => {
    const items = buildHermesConsoleActionDescriptors({
      tConsole,
      tCommon,
      docsUrl: null,
    });

    expect(items.at(-1)).toMatchObject({
      screen: 'Docs',
    });
    expect(items.at(-1)?.params).toBeUndefined();
  });
});
