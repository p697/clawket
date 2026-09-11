import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ThreadAddSheet } from './ThreadAddSheet';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ({ children, ...props }: Record<string, unknown>) => (
    ReactRuntime.createElement(name, props, children)
  );
  return {
    Pressable: host('Pressable'),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
      hairlineWidth: 1,
    },
    Text: host('Text'),
    View: host('View'),
  };
});

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  return new Proxy({}, {
    get: (_target, property) => (props: Record<string, unknown>) => (
      ReactRuntime.createElement(String(property), props)
    ),
  });
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../../utils/platform', () => ({ isMacCatalyst: false }));

jest.mock('../../../theme', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: '#1f5eff',
        inkSecondary: '#6b6b72',
      },
    },
  }),
}));

jest.mock('../../../components/ui/Sheet', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    Sheet: ({ children, testID, visible, onAfterClose }: {
      children: React.ReactNode;
      testID?: string;
      visible: boolean;
      onAfterClose?: () => void;
    }) => visible ? ReactRuntime.createElement(View, { testID, onAfterClose }, children) : null,
  };
});

jest.mock('../../../components/ui/SettingsGroup', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    SettingsDivider: () => ReactRuntime.createElement(View),
    SettingsGroup: ({ children }: { children: React.ReactNode }) => (
      ReactRuntime.createElement(View, null, children)
    ),
    SettingsRow: ({ leading, onPress, testID, title }: {
      leading?: React.ReactNode;
      onPress?: () => void;
      testID?: string;
      title: string;
    }) => ReactRuntime.createElement(
      Pressable,
      { onPress, testID },
      leading,
      ReactRuntime.createElement(Text, null, title),
    ),
  };
});

describe('Thread sheets', () => {
  it('gates add actions by capabilities and closes before invoking the selected action', () => {
    const onClose = jest.fn();
    const onPickImage = jest.fn();
    const onTakePhoto = jest.fn();
    const onChooseFile = jest.fn();
    const onOpenSkills = jest.fn();
    const onOpenPrompts = jest.fn();
    const view = render(
      <ThreadAddSheet
        visible
        attachmentsEnabled
        skillsEnabled
        onClose={onClose}
        onPickImage={onPickImage}
        onTakePhoto={onTakePhoto}
        onChooseFile={onChooseFile}
        onOpenSkills={onOpenSkills}
        onOpenPrompts={onOpenPrompts}
      />,
    );

    expect(view.getByTestId('thread-add-photo-library')).toBeTruthy();
    expect(view.getByTestId('thread-add-camera')).toBeTruthy();
    expect(view.getByTestId('thread-add-file')).toBeTruthy();
    expect(view.getByTestId('thread-add-skills')).toBeTruthy();
    expect(view.getByTestId('thread-add-prompts')).toBeTruthy();
    fireEvent.press(view.getByTestId('thread-add-photo-library'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPickImage).not.toHaveBeenCalled();
    fireEvent.press(view.getByTestId('thread-add-prompts'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent(view.getByTestId('thread-add-sheet'), 'afterClose');
    expect(onPickImage).toHaveBeenCalledTimes(1);
    expect(onOpenPrompts).not.toHaveBeenCalled();
    fireEvent(view.getByTestId('thread-add-sheet'), 'afterClose');
    expect(onPickImage).toHaveBeenCalledTimes(1);
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(onPickImage.mock.invocationCallOrder[0]);

    view.rerender(
      <ThreadAddSheet
        visible
        attachmentsEnabled
        skillsEnabled={false}
        onClose={onClose}
        onPickImage={onPickImage}
        onTakePhoto={onTakePhoto}
        onOpenPrompts={onOpenPrompts}
      />,
    );
    expect(view.getByTestId('thread-add-photo-library')).toBeTruthy();
    expect(view.getByTestId('thread-add-camera')).toBeTruthy();
    expect(view.queryByTestId('thread-add-file')).toBeNull();

    view.rerender(
      <ThreadAddSheet
        visible
        attachmentsEnabled={false}
        skillsEnabled={false}
        onClose={onClose}
        onPickImage={onPickImage}
        onTakePhoto={onTakePhoto}
        onChooseFile={onChooseFile}
        onOpenSkills={onOpenSkills}
        onOpenPrompts={onOpenPrompts}
      />,
    );
    expect(view.queryByTestId('thread-add-photo-library')).toBeNull();
    expect(view.queryByTestId('thread-add-camera')).toBeNull();
    expect(view.queryByTestId('thread-add-file')).toBeNull();
    expect(view.queryByTestId('thread-add-skills')).toBeNull();
    expect(view.getByTestId('thread-add-prompts')).toBeTruthy();
  });
});
