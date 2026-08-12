import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useApiResource, useResourceField } from './use-api-resource';

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

  it('keeps the last loaded value on failure when asked to', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(['kept'])
      .mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() =>
      useApiResource<string[]>(fetcher, [], 'boom', { keepStaleOnError: true }),
    );

    await waitFor(() => expect(result.current.data).toEqual(['kept']));

    act(() => result.current.reload());

    await waitFor(() => expect(result.current.error).toBe('boom'));
    expect(result.current.data).toEqual(['kept']);
  });

  it('reports the error through onError without clearing the value', async () => {
    const onError = vi.fn();
    const fetcher = vi.fn().mockResolvedValueOnce([1]).mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() =>
      useApiResource<number[]>(fetcher, [], 'boom', { keepStaleOnError: true, onError }),
    );

    await waitFor(() => expect(result.current.data).toEqual([1]));
    act(() => result.current.reload());

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(result.current.data).toEqual([1]);
  });
});

describe('useResourceField', () => {
  interface Meta {
    comments: string[];
    activities: string[];
  }

  const initial: Meta = { comments: [], activities: [] };
  /** Stable by contract — an inline closure would refetch on every commit. */
  const loadMeta = (): Promise<Meta> => Promise.resolve({ comments: ['c1'], activities: ['a1'] });

  function renderField() {
    return renderHook(() => {
      const resource = useApiResource<Meta>(loadMeta, initial, 'boom');
      return { resource, setComments: useResourceField(resource.setData, 'comments') };
    });
  }

  it('edits one field and leaves the rest of the resource alone', async () => {
    const { result } = renderField();
    await waitFor(() => expect(result.current.resource.data.comments).toEqual(['c1']));

    act(() => result.current.setComments((current) => [...current, 'c2']));

    expect(result.current.resource.data).toEqual({ comments: ['c1', 'c2'], activities: ['a1'] });
  });

  it('accepts a bare value as well as an updater', async () => {
    const { result } = renderField();
    await waitFor(() => expect(result.current.resource.data.comments).toEqual(['c1']));

    act(() => result.current.setComments([]));

    expect(result.current.resource.data).toEqual({ comments: [], activities: ['a1'] });
  });

  it('is stable across renders so it can be an effect dependency', async () => {
    const { result, rerender } = renderField();
    await waitFor(() => expect(result.current.resource.data.comments).toEqual(['c1']));

    const first = result.current.setComments;
    rerender();

    expect(result.current.setComments).toBe(first);
  });
});
