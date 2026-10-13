import React from 'react';
import { render } from '@testing-library/react-native';
import { Animated, I18nManager, Platform, StyleSheet } from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';
import { CompanionScene } from './companion/CompanionScene';
import { drawLoadingScene } from './LoadingState';
import { Space } from '../../theme/tokens';
import { GlobalLoadingOverlay } from './GlobalLoadingOverlay';

let mockInsets = { top: 20, bottom: 24, left: 48, right: 0 };
jest.mock('./PresentationSafeAreaProvider', () => ({ PresentationSafeAreaProvider: ({ children, ...props }: React.PropsWithChildren) => require('react').createElement('LocalProvider', props, children) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mockInsets }));
jest.mock('react-native', () => {
  const R = require('react');
  const host = (name: string) => ({ children, ...props }: any) => R.createElement(name, props, children);
  return {
    ...require('../../../__mocks__/native-animated'),
    I18nManager: { isRTL: false }, Platform: { OS: 'ios', select: (v: any) => v.ios ?? v.default },
    View: host('View'), Text: host('Text'), ScrollView: host('ScrollView'), Modal: host('Modal'),
    StyleSheet: { create: (v: unknown) => v, flatten: (v: unknown) => Object.assign({}, ...[v].flat(Infinity).filter(Boolean)),
      absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }, hairlineWidth: 1 },
  };
});
jest.mock('react-native-screens', () => ({ FullWindowOverlay: ({ children }: React.PropsWithChildren) => require('react').createElement('FullWindowOverlay', null, children) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: { scheme: 'light', colors: { scrim: '#333333', ink: '#111111' } } }) }));
jest.mock('../../theme/tokens', () => ({ ...jest.requireActual('../../theme/tokens'), createSurfaceStyle: () => ({}) }));
jest.mock('./companion/CompanionScene', () => ({ CompanionScene: (props: unknown) => require('react').createElement('Scene', props) }));
jest.mock('./LoadingState', () => ({ drawLoadingScene: jest.fn(() => 'peek') }));

beforeEach(() => {
  jest.clearAllMocks();
  mockInsets = { top: 20, bottom: 24, left: 48, right: 0 };
  Platform.OS = 'ios'; I18nManager.isRTL = false;
});

it.each([['ios', false], ['ios', true], ['android', false], ['android', true]] as const)(
  'measures inside the %s presentation and preserves the loading scene through safe-area changes (RTL=%s)', (platform, rtl) => {
    Platform.OS = platform; I18nManager.isRTL = rtl;
    const view = render(<GlobalLoadingOverlay visible message="Preparing the test connection" />);
    const scene = view.UNSAFE_getByType(CompanionScene);
    const card = view.getByTestId('global-loading-card');
    const drawCount = (drawLoadingScene as jest.Mock).mock.calls.length;
    const animationCount = (Animated.timing as jest.Mock).mock.calls.length;
    const presentation = platform === 'ios' ? view.UNSAFE_getByType(FullWindowOverlay) : view.UNSAFE_getByType(require('react-native').Modal);
    expect(presentation.findByProps({ testID: 'global-loading-presentation' })).toBeTruthy();
    for (const [left, right, top, bottom] of [[48, 0, 20, 24], [0, 48, 0, 24], [16, 24, 0, 0]]) {
      mockInsets = { left, right, top, bottom };
      view.rerender(<GlobalLoadingOverlay visible message="Preparing the test connection" />);
      expect(view.UNSAFE_getByType(CompanionScene)).toBe(scene);
      expect(view.getByTestId('global-loading-card')).toBe(card);
      expect(StyleSheet.flatten(view.getByTestId('global-loading-safe-area').props.style)).toMatchObject({
        paddingTop: top + Space.lg, paddingBottom: bottom + Space.lg,
        paddingStart: (rtl ? right : left) + Space.lg, paddingEnd: (rtl ? left : right) + Space.lg,
      });
      const scrim = view.getByTestId('global-loading-scrim');
      expect(scrim.props.pointerEvents).toBe('auto');
      expect(StyleSheet.flatten(scrim.props.style)).toMatchObject({ top: 0, bottom: 0, left: 0, right: 0 });
      expect(StyleSheet.flatten(card.props.style)).toMatchObject({ maxWidth: '100%', maxHeight: '100%' });
    }
    expect(drawLoadingScene).toHaveBeenCalledTimes(drawCount);
    expect(Animated.timing).toHaveBeenCalledTimes(animationCount);
    expect(card.props.accessibilityRole).toBe('progressbar');
    expect(card.props.accessibilityState.busy).toBe(true);
    expect(card.props.accessibilityLabel).toBe('Preparing the test connection');
    view.rerender(<GlobalLoadingOverlay visible={false} />);
    expect(view.queryByTestId('global-loading-card')).toBeNull();
    view.rerender(<GlobalLoadingOverlay visible />);
    expect(drawLoadingScene).toHaveBeenCalledTimes(drawCount + 1);
    expect(view.getByTestId('global-loading-card').props.accessibilityLabel).toBe('Connecting');
  },
);
