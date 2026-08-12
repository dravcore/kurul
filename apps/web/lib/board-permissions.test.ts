import { describe, expect, it } from 'vitest';
import { MemberRole } from '@kurultay/shared-types';
import {
  canCreateOrUpdateBoard,
  canDeleteBoard,
  canMutateColumns,
  canMutateLabels,
  canMutateTasks,
} from './board-permissions';

const { OWNER, ADMIN, MEMBER, GUEST } = MemberRole;

describe('board permissions', () => {
  it('lets MEMBER and above create or update boards', () => {
    expect(canCreateOrUpdateBoard(OWNER)).toBe(true);
    expect(canCreateOrUpdateBoard(ADMIN)).toBe(true);
    expect(canCreateOrUpdateBoard(MEMBER)).toBe(true);
    expect(canCreateOrUpdateBoard(GUEST)).toBe(false);
    expect(canCreateOrUpdateBoard(null)).toBe(false);
  });

  it('restricts board deletion to ADMIN and above', () => {
    expect(canDeleteBoard(OWNER)).toBe(true);
    expect(canDeleteBoard(ADMIN)).toBe(true);
    expect(canDeleteBoard(MEMBER)).toBe(false);
    expect(canDeleteBoard(GUEST)).toBe(false);
    expect(canDeleteBoard(null)).toBe(false);
  });

  it('restricts column structure changes to ADMIN and above (ADR 0009)', () => {
    expect(canMutateColumns(OWNER)).toBe(true);
    expect(canMutateColumns(ADMIN)).toBe(true);
    expect(canMutateColumns(MEMBER)).toBe(false);
    expect(canMutateColumns(GUEST)).toBe(false);
    expect(canMutateColumns(null)).toBe(false);
  });

  it('lets MEMBER and above mutate tasks (ADR 0010)', () => {
    expect(canMutateTasks(OWNER)).toBe(true);
    expect(canMutateTasks(ADMIN)).toBe(true);
    expect(canMutateTasks(MEMBER)).toBe(true);
    expect(canMutateTasks(GUEST)).toBe(false);
    expect(canMutateTasks(null)).toBe(false);
  });

  it('restricts label management to ADMIN and above (ADR 0011)', () => {
    expect(canMutateLabels(OWNER)).toBe(true);
    expect(canMutateLabels(ADMIN)).toBe(true);
    expect(canMutateLabels(MEMBER)).toBe(false);
    expect(canMutateLabels(GUEST)).toBe(false);
    expect(canMutateLabels(null)).toBe(false);
  });
});
