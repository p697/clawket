import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { AgentAdapter, ModelHealthReport } from '@clawket/agent-protocol';
import { ModelHealthSheet } from './ModelHealthSheet';

jest.mock('react-native', () => {
  const R = require('react');
  const host = (name: string) => ({ children, ...props }: any) => R.createElement(name, props, children);
  return { View: host('View'), Text: host('Text'), Pressable: host('Pressable'), StyleSheet: { create: (value: unknown) => value } };
});
jest.mock('@gorhom/bottom-sheet', () => ({ BottomSheetScrollView: ({ children }: any) => children }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../../components/ui/Sheet', () => ({ Sheet: ({ visible, children }: any) => visible ? children : null }));
jest.mock('../../components/ui/SettingsGroup', () => ({
  SettingsGroup: ({ children }: any) => children,
  SettingsDivider: () => null,
  SettingsRow: ({ title, value }: any) => require('react').createElement(require('react-native').Text, null, `${title} ${value ?? ''}`),
}));
jest.mock('../../components/ui/Button', () => ({ Button: (props: any) => require('react').createElement(require('react-native').Pressable, props) }));
jest.mock('../../components/ui/Banner', () => ({ Banner: ({ message }: any) => require('react').createElement(require('react-native').Text, null, message) }));
jest.mock('../../components/ui/LoadingState', () => ({ LoadingState: () => null }));

const report: ModelHealthReport = { scope: 'global', model: 'model-a', provider: 'provider-a', checkedAtMs: 1,
  providers: [{ id: 'provider-a', name: 'Provider A', credentials: 'configured' }], checks: [] };
const adapterWith = (health: jest.Mock) => ({ management: { models: { health } } }) as unknown as AgentAdapter;

test('opening reads configuration; only an explicit tap probes providers', async () => {
  const health = jest.fn().mockResolvedValue(report);
  const view = render(<ModelHealthSheet visible adapter={adapterWith(health)} online onClose={() => undefined} />);
  await waitFor(() => expect(view.getByText('Provider A Configured')).toBeTruthy());
  expect(health).toHaveBeenCalledTimes(1);
  expect(health).toHaveBeenCalledWith({ probe: false });
  health.mockResolvedValue({ ...report, checks: [{ name: 'Provider A', status: 'reachable' }] });
  fireEvent.press(view.getByTestId('model-health-probe'));
  await waitFor(() => expect(view.getByText('Provider A Connected')).toBeTruthy());
  expect(health).toHaveBeenLastCalledWith({ probe: true });
  expect(view.getByTestId('model-health-probe').props.disabled).toBe(true);
  view.unmount();
});

test.each(['offline', 'closed', 'changed'] as const)('ignores a pending result when the connection is %s', async change => {
  let resolve!: (value: ModelHealthReport) => void;
  const health = jest.fn(() => new Promise<ModelHealthReport>(done => { resolve = done; }));
  const adapter = adapterWith(health);
  const otherHealth = jest.fn().mockResolvedValue({ ...report, model: 'model-b' });
  const otherAdapter = adapterWith(otherHealth);
  const view = render(<ModelHealthSheet visible adapter={adapter} online onClose={() => undefined} />);
  expect(health).toHaveBeenCalledTimes(1);
  view.rerender(<ModelHealthSheet visible={change !== 'closed'} adapter={change === 'changed' ? otherAdapter : adapter}
    online={change !== 'offline'} onClose={() => undefined} />);
  await act(async () => resolve(report));
  expect(view.queryByText('model-a ')).toBeNull();
  if (change === 'changed') expect(view.getByText('model-b ')).toBeTruthy();
  expect(health).toHaveBeenCalledTimes(1);
});

test('offline opening makes no network request', () => {
  const health = jest.fn();
  const view = render(<ModelHealthSheet visible adapter={adapterWith(health)} online={false} onClose={() => undefined} />);
  expect(view.getByText('Offline')).toBeTruthy();
  expect(health).not.toHaveBeenCalled();
});
