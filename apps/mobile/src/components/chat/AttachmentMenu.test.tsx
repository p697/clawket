import React from 'react';
import { act, render } from '@testing-library/react-native';
import { View } from 'react-native';
import { AttachmentMenu } from './AttachmentMenu';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  return {
    StyleSheet: { flatten: (style: unknown) => style },
    View: ({ children, ...props }: Record<string, unknown>) => (
      ReactRuntime.createElement('View', props, children)
    ),
  };
});

jest.mock('@react-native-menu/menu', () => {
  const ReactRuntime = require('react');
  return {
    MenuView: ({ children, ...props }: Record<string, unknown>) => (
      ReactRuntime.createElement('MenuView', { ...props, testID: 'attachment-menu' }, children)
    ),
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../theme', () => ({
  useAppTheme: () => ({ theme: { scheme: 'light' } }),
}));

jest.mock('../../utils/platform', () => ({ isMacCatalyst: false }));

describe('AttachmentMenu', () => {
  it('keeps image actions but omits the arbitrary-file action without its handler', () => {
    const onPickImage = jest.fn();
    const onTakePhoto = jest.fn();
    const onChooseFile = jest.fn();
    const view = render(
      <AttachmentMenu onPickImage={onPickImage} onTakePhoto={onTakePhoto}>
        <View />
      </AttachmentMenu>,
    );

    expect(view.getByTestId('attachment-menu').props.actions.map(
      (action: { id: string }) => action.id,
    )).toEqual(['photo-library', 'take-photo']);

    view.rerender(
      <AttachmentMenu
        onPickImage={onPickImage}
        onTakePhoto={onTakePhoto}
        onChooseFile={onChooseFile}
      >
        <View />
      </AttachmentMenu>,
    );
    const menu = view.getByTestId('attachment-menu');
    expect(menu.props.actions.map((action: { id: string }) => action.id)).toEqual([
      'choose-file',
      'take-photo',
      'photo-library',
    ]);
    act(() => menu.props.onPressAction({ nativeEvent: { event: 'choose-file' } }));
    expect(onChooseFile).toHaveBeenCalledTimes(1);
  });
});
