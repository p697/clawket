import React from 'react';
import { I18nManager } from 'react-native';
import { render } from '@testing-library/react-native';
import { ArrowRight, ChevronLeft } from './DirectionalIcon';

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  const icon = (props: Record<string, unknown>) => ReactRuntime.createElement('Icon', props);
  return { ChevronLeft: icon, ChevronRight: icon, ArrowLeft: icon, ArrowRight: icon };
});

describe('DirectionalIcon', () => {
  afterEach(() => { I18nManager.isRTL = false; });

  it('renders lucide glyphs unchanged in left-to-right layouts', () => {
    const view = render(<ChevronLeft testID="glyph" size={16} />);
    expect(view.getByTestId('glyph').props.style).toBeUndefined();
  });

  it('mirrors semantic glyphs horizontally in right-to-left layouts', () => {
    I18nManager.isRTL = true;
    const view = render(<ArrowRight testID="glyph" size={16} style={{ opacity: 0.5 }} />);
    expect(view.getByTestId('glyph').props.style).toEqual([{ opacity: 0.5 }, { transform: [{ scaleX: -1 }] }]);
  });
});
