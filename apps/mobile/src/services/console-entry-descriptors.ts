import type { TFunction } from 'i18next';
import type { GatewayBackendKind } from '../types';
import { selectByBackend } from './gateway-backends';
import type { ConsoleStackParamList } from '../screens/ConsoleScreen/sharedNavigator';

export type ConsoleEntryDescriptor = {
  key: string;
  screen: keyof ConsoleStackParamList;
  source: string;
  emoji: string;
  title: string;
  description: string;
  hideBorderBottom?: boolean;
};

export function buildConsoleLibraryEntryDescriptors(params: {
  backendKind: GatewayBackendKind;
  tConsole: TFunction<'console'>;
  tCommon: TFunction<'common'>;
}): ConsoleEntryDescriptor[] {
  const { backendKind, tConsole, tCommon } = params;

  const docsDescription = selectByBackend<string>(backendKind, {
    openclaw: tConsole('OpenClaw protocol docs'),
    hermes: tConsole('Open Hermes project documentation'),
  });

  return [
    {
      key: 'discover',
      screen: 'Discover',
      source: 'list_discover',
      emoji: '🧩',
      title: tCommon('Discover'),
      description: tCommon('Browse skills across ClawHub and skills.sh'),
    },
    {
      key: 'clawhub',
      screen: 'ClawHub',
      source: 'list_clawhub',
      emoji: '🦞',
      title: tConsole('ClawHub'),
      description: tConsole('Browse and install community skills'),
    },
    {
      key: 'docs',
      screen: 'Docs',
      source: 'list_docs',
      emoji: '📖',
      title: tConsole('Documentation'),
      description: docsDescription,
      hideBorderBottom: true,
    },
  ];
}
