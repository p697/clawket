import React, { useEffect, useState } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider, useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';
import { PresentationSafeAreaProvider } from './PresentationSafeAreaProvider';

// Exercise the installed provider, replacing only its native measurement boundary.
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/lib/commonjs/SafeAreaContext'));
jest.mock('react-native-safe-area-context/lib/commonjs/NativeSafeAreaProvider', () => ({
  NativeSafeAreaProvider: ({ children, ...props }: React.PropsWithChildren) => (
    require('react').createElement('NativeSafeAreaProvider', props, children)
  ),
}));

it('waits for presentation metrics and preserves content through frame and inset-only changes', () => {
  const mounted = jest.fn();
  const onMetrics = jest.fn();
  function Content() {
    const frame = useSafeAreaFrame();
    const insets = useSafeAreaInsets();
    const [draft, setDraft] = useState('');
    useEffect(() => { mounted(); }, []);
    return React.createElement('Metrics', { testID: 'metrics', frame, insets, draft, onChangeText: setDraft });
  }
  const parent = { frame: { x: 0, y: 0, width: 300, height: 800 }, insets: { top: 60, bottom: 34, left: 0, right: 0 } };
  const view = render(
    <SafeAreaProvider initialMetrics={parent}>
      <PresentationSafeAreaProvider testID="presentation" onMetrics={onMetrics}><Content /></PresentationSafeAreaProvider>
    </SafeAreaProvider>,
  );
  expect(view.queryByTestId('metrics')).toBeNull();
  expect(onMetrics).not.toHaveBeenCalled();
  const local = { frame: { x: 0, y: 0, width: 720, height: 600 }, insets: { top: 0, bottom: 24, left: 48, right: 0 } };
  fireEvent(view.getByTestId('presentation'), 'insetsChange', { nativeEvent: local });
  const content = view.getByTestId('metrics');
  expect(content.props.frame).toEqual(local.frame);
  expect(content.props.insets).toEqual(local.insets);
  expect(onMetrics).toHaveBeenLastCalledWith(local);
  fireEvent.changeText(content, '保持编辑');
  const switched = { ...local, insets: { top: 0, bottom: 24, left: 0, right: 48 } };
  fireEvent(view.getByTestId('presentation'), 'insetsChange', { nativeEvent: switched });
  expect(view.getByTestId('metrics')).toBe(content);
  expect(content.props.insets).toEqual(switched.insets);
  expect(onMetrics).toHaveBeenLastCalledWith(switched);
  const resized = { ...switched, frame: { x: 0, y: 0, width: 380, height: 700 } };
  fireEvent(view.getByTestId('presentation'), 'insetsChange', { nativeEvent: resized });
  expect(content.props.frame).toEqual(resized.frame);
  expect(onMetrics).toHaveBeenLastCalledWith(resized);
  expect(content.props.draft).toBe('保持编辑');
  expect(mounted).toHaveBeenCalledTimes(1);
});
