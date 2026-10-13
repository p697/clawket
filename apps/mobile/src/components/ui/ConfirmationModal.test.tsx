import React from 'react';
import { I18nManager } from 'react-native';
import { Space } from '../../theme/tokens';
import { fireEvent, render } from '@testing-library/react-native';
import { ConfirmationModal } from './ConfirmationModal';

let mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };

jest.mock('./PresentationSafeAreaProvider', () => ({ PresentationSafeAreaProvider: ({ children }: React.PropsWithChildren) => children }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mockInsets }));

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ({ children, ...props }: { children?: React.ReactNode }) => (
    ReactRuntime.createElement(name, props, children)
  );
  return {
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
    I18nManager: { isRTL: false },
    ScrollView: host('ScrollView'),
    Modal: host('Modal'),
    Pressable: host('Pressable'),
    Text: host('Text'),
    View: host('View'),
    StyleSheet: {
      absoluteFill: {},
      hairlineWidth: 0.5,
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
    },
  };
});

jest.mock('lucide-react-native', () => ({ X: () => null }));

jest.mock('../../theme', () => ({
  useAppTheme: () => ({
    theme: {
      scheme: 'light',
      colors: { canvas: '#fff', scrim: 'rgba(0,0,0,0.4)', ink: '#111', inkSecondary: '#666', surfaceFloating: '#fff', line: '#eee' },
    },
  }),
}));

jest.mock('../../theme/tokens', () => {
  const actual = jest.requireActual('../../theme/tokens');
  return { ...actual, createSurfaceStyle: () => ({}) };
});

jest.mock('./Button', () => {
  const ReactRuntime = require('react');
  return {
    Button: ({ testID, label, onPress }: { testID?: string; label: string; onPress: () => void }) => (
      ReactRuntime.createElement('Pressable', { testID, onPress, accessibilityLabel: label })
    ),
  };
});

jest.mock('./FloatingButton', () => {
  const ReactRuntime = require('react');
  return {
    FloatingButton: ({ testID, onPress }: { testID?: string; onPress: () => void }) => (
      ReactRuntime.createElement('Pressable', { testID, onPress })
    ),
  };
});

describe('ConfirmationModal', () => {
  beforeEach(() => {
    mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
    I18nManager.isRTL = false;
  });

  it.each([false, true])('keeps four independent safe edges when the inset switches sides (RTL=%s)', (rtl) => {
    I18nManager.isRTL = rtl;
    mockInsets = { top: 20, bottom: 34, left: 52, right: 0 };
    const props = { visible: true, title: 'Confirm', message: 'Message', cancelLabel: 'Cancel', confirmLabel: 'Save', onClose: jest.fn(), onConfirm: jest.fn() };
    const view = render(<ConfirmationModal {...props} />);
    const padding = () => Object.assign({}, ...view.getByTestId('confirmation-modal-safe-area').props.style);
    expect(padding()).toMatchObject({
      paddingTop: 20 + Space.xl, paddingBottom: 34 + Space.xl,
      paddingStart: (rtl ? 0 : 52) + Space.xl, paddingEnd: (rtl ? 52 : 0) + Space.xl,
    });
    mockInsets = { top: 20, bottom: 34, left: 0, right: 52 };
    view.rerender(<ConfirmationModal {...props} />);
    expect(padding()).toMatchObject({
      paddingStart: (rtl ? 52 : 0) + Space.xl, paddingEnd: (rtl ? 0 : 52) + Space.xl,
    });
    expect(view.getByTestId('confirmation-modal-card').props.style.maxHeight).toBe('100%');
    expect(view.getByTestId('confirmation-modal').props.style.flexShrink).toBe(1);
    expect(view.getByTestId('confirmation-modal').props.keyboardShouldPersistTaps).toBe('handled');
  });

  it('lets a long title wrap instead of cutting off the name it asks about', () => {
    const view = render(
      <ConfirmationModal visible title="Connect to Claude Code · Computer?" message="This secure pairing invitation will add the computer to Clawket."
        cancelLabel="Cancel" confirmLabel="Connect" onClose={jest.fn()} onConfirm={jest.fn()} testID="pairing" />,
    );
    const title = view.getByTestId('pairing-title');
    expect(title.props.children).toBe('Connect to Claude Code · Computer?');
    expect(title.props.numberOfLines).toBe(2);
  });

  it('confirms and cancels through the two actions and the close button', () => {
    const onClose = jest.fn();
    const onConfirm = jest.fn();
    const view = render(
      <ConfirmationModal visible title="Remove connection" message="This removes the saved pairing."
        cancelLabel="Cancel" confirmLabel="Remove" onClose={onClose} onConfirm={onConfirm} destructive />,
    );
    fireEvent.press(view.getByTestId('confirmation-modal-confirm'));
    fireEvent.press(view.getByTestId('confirmation-modal-cancel'));
    fireEvent.press(view.getByTestId('confirmation-modal-close'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
