import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useApiResource } from './use-api-resource';

describe('useApiResource', () => {
  it('loads data and clears the loading flag', async () => {
    const fetcher = vi.fn().mockResolvedValue(['a', 'b']);
    const { result } = renderHook(() => useApiResource<string[]>(fetcher, [], 'boom'));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(['a', 'b']);
    expect(result.current.error).toBeNull();
  });

  it('drops stale data and reports the caller message on failure', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useApiResource<string[]>(fetcher, [], 'boom'));

    await waitFor(() => expect(result.current.error).toBe('boom'));
    expect(result.current.data).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('does not fetch while the fetcher is null', () => {
    const { result } = renderHook(() => useApiResource<string[]>(null, [], 'boom'));

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('refetches on reload', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(['first']).mockResolvedValueOnce(['second']);
    const { result } = renderHook(() => useApiResource<string[]>(fetcher, [], 'boom'));

    await waitFor(() => expect(result.current.data).toEqual(['first']));

    act(() => result.current.reload());

    await waitFor(() => expect(result.current.data).toEqual(['second']));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('aborts the in-flight request on unmount', () => {
    let received: AbortSignal | undefined;
    const fetcher = (signal: AbortSignal): Promise<string[]> => {
      received = signal;
      return new Promise(() => {});
    };
    const { unmount } = renderHook(() => useApiResource<string[]>(fetcher, [], 'boom'));

    expect(received?.aborted).toBe(false);

    unmount();

    expect(received?.aborted).toBe(true);
  });
});
