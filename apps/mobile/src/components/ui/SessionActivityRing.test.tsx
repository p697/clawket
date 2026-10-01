import React from 'react';
import { render } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import { SessionActivityRing } from './SessionActivityRing';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  return {
    Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android ?? options.default },
    View: ({ children, ...props }: Record<string, unknown>) => ReactRuntime.createElement('View', props, children),
    StyleSheet: { create: (styles: unknown) => styles, flatten: (style: unknown) => style,
      absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } },
  };
});
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: { colors: { accent: '#6B95FF' } } }) }));
afterEach(() => jest.restoreAllMocks());
it('shares the theme arc while hiding decorative SVG from accessibility', () => {
  const view = render(<SessionActivityRing testID="session-running" />);
  const arc = view.getByTestId('session-running', { includeHiddenElements: true });
  expect(arc.findAll(node => (node.type as unknown) === 'Path')[0].props.stroke).toBe('#6B95FF');
  expect(view.queryByTestId('session-running')).toBeNull();
});
it('holds the native arc still when reduced motion is enabled', () => {
  jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
  const timing = jest.spyOn(Reanimated, 'withTiming');
  render(<SessionActivityRing testID="session-running" />);
  expect(timing).not.toHaveBeenCalled();
});
