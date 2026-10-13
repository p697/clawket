import { act, renderHook } from '@testing-library/react-native';
import { useChatImagePreview } from './useChatImagePreview';

describe('useChatImagePreview', () => {
  it('opens preview with clamped index and resets state on close', () => {
    const { result } = renderHook(() => useChatImagePreview());

    act(() => {
      result.current.openPreview(['a', 'b', 'c'], 9);
    });

    expect(result.current.previewVisible).toBe(true);
    expect(result.current.previewUris).toEqual(['a', 'b', 'c']);
    expect(result.current.previewIndex).toBe(2);

    act(() => {
      result.current.closePreview();
    });

    expect(result.current.previewVisible).toBe(false);
    expect(result.current.previewUris).toEqual([]);
    expect(result.current.previewIndex).toBe(0);
  });
});
