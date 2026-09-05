import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { HitSize, IconSize } from '../../theme/tokens';
import { PendingImageBar } from './PendingImageBar';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const primitive = (name: string) => ({ children, ...props }: Record<string, unknown>) => (
    ReactRuntime.createElement(name, props, children)
  );
  const flatten = (style: unknown): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    const append = (value: unknown): void => {
      if (!value) return;
      if (Array.isArray(value)) value.forEach(append);
      else if (typeof value === 'object') Object.assign(result, value);
    };
    append(style);
    return result;
  };
  return {
    Image: primitive('Image'),
    Pressable: primitive('Pressable'),
    StyleSheet: { create: <T,>(styles: T) => styles, flatten, hairlineWidth: 1 },
    Text: primitive('Text'),
    TouchableOpacity: primitive('TouchableOpacity'),
    View: primitive('View'),
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    FileText: (props: Record<string, unknown>) => ReactRuntime.createElement(View, props),
    Plus: (props: Record<string, unknown>) => ReactRuntime.createElement(View, props),
    X: (props: Record<string, unknown>) => ReactRuntime.createElement(View, props),
  };
});

jest.mock('../../theme', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        line: '#ddd',
        bad: '#d00',
        onAccent: '#fff',
        surface: '#fff',
        inkSecondary: '#666',
        inkTertiary: '#999',
      },
    },
  }),
}));

jest.mock('./AttachmentMenu', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    AttachmentMenu: ({ children }: { children: React.ReactNode }) => (
      ReactRuntime.createElement(View, null, children)
    ),
  };
});

describe('PendingImageBar', () => {
  it('classifies a trimmed case-insensitive image MIME as an image preview', () => {
    const view = render(
      <PendingImageBar
        images={[{ uri: 'file://image.png', mimeType: ' Image/PNG ', base64: 'image-data' }]}
        canAddMore={false}
        onOpenPreview={jest.fn()}
        onRemove={jest.fn()}
        onPickImage={jest.fn()}
        onTakePhoto={jest.fn()}
      />,
    );

    expect(view.getByTestId('pending-attachment-image-0')).toBeTruthy();
    expect(view.queryByTestId('pending-attachment-file-0')).toBeNull();
  });

  it('uses localized file fallback copy without rendering a document as an image', () => {
    const view = render(
      <PendingImageBar
        images={[{
          uri: 'file://document.pdf',
          mimeType: ' Application/PDF ',
          base64: 'pdf-data',
          fileName: '   ',
        }]}
        canAddMore={false}
        onOpenPreview={jest.fn()}
        onRemove={jest.fn()}
        onPickImage={jest.fn()}
        onTakePhoto={jest.fn()}
      />,
    );

    expect(view.getByTestId('pending-attachment-file-0')).toBeTruthy();
    expect(view.getByText('File')).toBeTruthy();
    expect(view.queryByTestId('pending-attachment-image-0')).toBeNull();
  });

  it('keeps the 20pt remove affordance inside a dedicated 44pt hit target', () => {
    const onRemove = jest.fn();
    const view = render(
      <PendingImageBar
        images={[{ uri: 'file://image.jpg', mimeType: 'image/jpeg', base64: 'image-data' }]}
        canAddMore={false}
        onOpenPreview={jest.fn()}
        onRemove={onRemove}
        onPickImage={jest.fn()}
        onTakePhoto={jest.fn()}
        onChooseFile={jest.fn()}
      />,
    );

    const hitTarget = view.getByTestId('pending-attachment-remove-0');
    const visual = view.getByTestId('pending-attachment-remove-0-visual');
    expect(StyleSheet.flatten(hitTarget.props.style)).toMatchObject({
      width: HitSize.md,
      height: HitSize.md,
    });
    expect(StyleSheet.flatten(visual.props.style)).toMatchObject({
      width: IconSize.md,
      height: IconSize.md,
    });

    fireEvent.press(hitTarget);
    expect(onRemove).toHaveBeenCalledWith(0);
  });
});
