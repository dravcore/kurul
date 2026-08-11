import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberRole, type CursorPage, type WorkspaceMemberDto } from '@kurultay/shared-types';
import {
  WORKSPACE_MEMBER_PAGE_LIMIT,
  fetchAllWorkspaceMembers,
  fetchOwnMembership,
} from './member-query';
import { api } from './api';

vi.mock('./api', () => ({
  api: { get: vi.fn() },
}));

const apiGet = vi.mocked(api.get);
const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';

function member(id: string): WorkspaceMemberDto {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    userId: `user-${id}`,
    role: MemberRole.MEMBER,
    name: `Member ${id}`,
    avatarUrl: null,
  };
}

function page(ids: string[], nextCursor: string | null): CursorPage<WorkspaceMemberDto> {
  return { items: ids.map(member), nextCursor, hasMore: nextCursor !== null };
}

beforeEach(() => {
  apiGet.mockReset();
});

describe('fetchAllWorkspaceMembers', () => {
  it('asks for the largest page the API will serve', async () => {
    apiGet.mockResolvedValueOnce(page(['a'], null));

    await fetchAllWorkspaceMembers(WORKSPACE_ID);

    expect(WORKSPACE_MEMBER_PAGE_LIMIT).toBe(100);
    expect(apiGet).toHaveBeenCalledTimes(1);
    const url = apiGet.mock.calls[0]?.[0] ?? '';
    expect(url).toBe(`/workspaces/${WORKSPACE_ID}/members?limit=100`);
  });

  /** The bug this module exists for: a roster past one page must still arrive whole. */
  it('keeps walking the cursor until the roster is exhausted', async () => {
    apiGet
      .mockResolvedValueOnce(page(['a', 'b'], 'cursor-1'))
      .mockResolvedValueOnce(page(['c', 'd'], 'cursor-2'))
      .mockResolvedValueOnce(page(['e'], null));

    const members = await fetchAllWorkspaceMembers(WORKSPACE_ID);

    expect(members.map((entry) => entry.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(apiGet).toHaveBeenCalledTimes(3);
    expect(apiGet.mock.calls[1]?.[0]).toContain('cursor=cursor-1');
    expect(apiGet.mock.calls[2]?.[0]).toContain('cursor=cursor-2');
  });

  it('stops instead of looping when the cursor does not advance', async () => {
    apiGet.mockResolvedValue(page(['a'], 'stuck'));

    const members = await fetchAllWorkspaceMembers(WORKSPACE_ID);

    // Page one hands back `stuck`, page two hands back `stuck` again: that is the end of it.
    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(members).toHaveLength(2);
  });

  it('stops on a page that claims no more even with a cursor attached', async () => {
    apiGet.mockResolvedValueOnce({ items: [member('a')], nextCursor: 'cursor-1', hasMore: false });

    const members = await fetchAllWorkspaceMembers(WORKSPACE_ID);

    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(members.map((entry) => entry.id)).toEqual(['a']);
  });

  it('drops a page that landed after the caller aborted', async () => {
    const controller = new AbortController();
    apiGet.mockImplementation(() => {
      controller.abort();
      return Promise.resolve(page(['a'], 'cursor-1')) as never;
    });

    const members = await fetchAllWorkspaceMembers(WORKSPACE_ID, { signal: controller.signal });

    expect(members).toEqual([]);
    expect(apiGet).toHaveBeenCalledTimes(1);
  });
});

describe('fetchOwnMembership', () => {
  it('reads the single membership row, not the roster', async () => {
    apiGet.mockResolvedValueOnce(member('a'));

    const membership = await fetchOwnMembership(WORKSPACE_ID);

    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet.mock.calls[0]?.[0]).toBe(`/workspaces/${WORKSPACE_ID}/members/me`);
    expect(membership.id).toBe('a');
  });
});
