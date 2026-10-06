import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { QRScannerScreen } from './QRScannerScreen';
import { ControlSize, PresentationColor } from '../../theme/tokens';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => (
    ReactRuntime.createElement(name, props, children)
  );
  return {
    Alert: { alert: jest.fn() },
    Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default },
    Pressable: host('Pressable'),
    StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {}, hairlineWidth: 1 },
    Text: host('Text'),
    View: host('View'),
  };
});
jest.mock('expo-camera', () => ({ CameraView: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: { colors: { accent: '#1F5EFF' } } }) }));

type Style = Record<string, unknown> | null | undefined | false | Style[];
const flatten = (style: Style): Record<string, unknown> => (
  Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style || {}
);

describe('QRScannerScreen', () => {
  it('offers Cancel as a filled media capsule with a full touch target and no outline', () => {
    const onCancel = jest.fn();
    const view = render(<QRScannerScreen onScanned={jest.fn()} onCancel={onCancel} />);
    const cancel = view.getByTestId('qr-scanner-cancel');
    const style = flatten(cancel.props.style({ pressed: false }));

    expect(cancel.props.accessibilityRole).toBe('button');
    expect(view.getByText('Cancel')).toBeTruthy();
    expect(style).toMatchObject({
      minHeight: ControlSize.floatingButton,
      backgroundColor: PresentationColor.mediaControl,
    });
    expect(style.borderWidth ?? 0).toBe(0);
    fireEvent.press(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('offers photos beside Cancel as the same capsule and hands over only once', () => {
    const onChoosePhoto = jest.fn();
    const onCancel = jest.fn();
    const view = render(<QRScannerScreen onScanned={jest.fn()} onCancel={onCancel} onChoosePhoto={onChoosePhoto} />);
    const photos = view.getByTestId('qr-scanner-photos');
    const cancel = view.getByTestId('qr-scanner-cancel');

    expect(photos.props.accessibilityRole).toBe('button');
    expect(view.getByText('Choose from photos')).toBeTruthy();
    expect(flatten(photos.props.style({ pressed: false }))).toEqual(flatten(cancel.props.style({ pressed: false })));
    fireEvent.press(photos);
    fireEvent.press(photos);
    expect(onChoosePhoto).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('shows no photo action when the opener cannot read one', () => {
    const view = render(<QRScannerScreen onScanned={jest.fn()} onCancel={jest.fn()} />);
    expect(view.queryByTestId('qr-scanner-photos')).toBeNull();
    expect(view.getByTestId('qr-scanner-cancel')).toBeTruthy();
  });
});
