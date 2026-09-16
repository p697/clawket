import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SegmentBar } from './SegmentBar';
import { ShareRow } from './ShareRow';
import { UsageBarChart } from './UsageBarChart';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const primitive = (name: string) => ReactRuntime.forwardRef(
    ({ children, ...props }: { children?: React.ReactNode }, ref: React.Ref<unknown>) => (
      ReactRuntime.createElement(name, { ...props, ref }, children)
    ),
  );
  const absoluteFillObject = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 };
  return {
    Pressable: primitive('Pressable'),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
      hairlineWidth: 1,
      absoluteFill: absoluteFillObject,
      absoluteFillObject,
    },
    Text: primitive('Text'),
    View: primitive('View'),
  };
});

jest.mock('../../theme', () => {
  const { buildTheme } = jest.requireActual('../../theme/theme');
  const { builtInAccents } = jest.requireActual('../../theme/accents');
  return { useAppTheme: () => ({ theme: buildTheme('light', 'light', builtInAccents.iceBlue) }) };
});

describe('usage charts', () => {
  it('draws segment shares in ink order and spells out every value in the legend', () => {
    const view = render(
      <SegmentBar
        testID="segments"
        segments={[
          { key: 'input', label: 'Input', value: 60, display: '60' },
          { key: 'output', label: 'Output', value: 0, display: '0' },
          { key: 'cacheRead', label: 'Cache Read', value: 40, display: '40' },
          { key: 'cacheWrite', label: 'Cache Write', value: 0, display: '0' },
        ]}
      />,
    );
    expect(view.getByTestId('segments-segment-input')).toBeTruthy();
    expect(view.getByTestId('segments-segment-cacheRead')).toBeTruthy();
    expect(view.queryByTestId('segments-segment-output')).toBeNull();
    expect(view.getByTestId('segments-value-cacheWrite').props.children).toBe('0');
    expect(view.getByText('Cache Read')).toBeTruthy();
  });

  it('renders an empty track when nothing was used', () => {
    const view = render(
      <SegmentBar testID="segments" segments={[{ key: 'input', label: 'Input', value: 0, display: '0' }]} />,
    );
    expect(view.queryByTestId('segments-segment-input')).toBeNull();
    expect(view.getByText('Input')).toBeTruthy();
  });

  it('clamps the share track to the row width', () => {
    const view = render(<ShareRow testID="row" name="claude-opus-5" value="77.6K" share={1.4} />);
    expect(view.getByTestId('row-share').props.style).toEqual(expect.arrayContaining([expect.objectContaining({ width: '100%' })]));
    view.rerender(<ShareRow testID="row" name="claude-haiku-4-5" value="1K" share={0.07} />);
    expect(view.getByTestId('row-share').props.style).toEqual(expect.arrayContaining([expect.objectContaining({ width: '7%' })]));
  });

  it('draws one bar per day, labels the selected value and reports taps by index', () => {
    const onSelect = jest.fn();
    const points = [
      { date: '2026-09-14', value: 142_000, today: false },
      { date: '2026-09-15', value: 0, today: false },
      { date: '2026-09-16', value: 77_600, today: true },
    ];
    const view = render(
      <UsageBarChart
        testID="chart"
        points={points}
        selectedIndex={2}
        onSelect={onSelect}
        formatValue={(value) => `${Math.round(value / 1000)}K`}
        formatDayLabel={(date) => date.slice(5)}
        todayLabel="Today"
      />,
    );
    for (const point of points) expect(view.getByTestId(`chart-bar-${point.date}`)).toBeTruthy();
    expect(view.getByTestId('chart-selected-value').props.children).toBe('78K');
    expect(view.getByText('Today')).toBeTruthy();
    expect(view.getByText('09-14')).toBeTruthy();
    expect(view.getByLabelText('09-15, 0K')).toBeTruthy();

    fireEvent.press(view.getByTestId('chart-slot-2026-09-14'));
    expect(onSelect).toHaveBeenCalledWith(0);
  });
});
