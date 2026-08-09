import { BadRequestException } from '@nestjs/common';
import { Priority } from '@kurultay/shared-types';
import { createTaskAttributes, planTaskUpdate } from './task-fields';

const existing = {
  title: 'Ship the board',
  description: 'Original',
  priority: Priority.MEDIUM,
  dueDate: new Date('2026-09-01T00:00:00.000Z'),
  estimatedMinutes: 60,
};

describe('createTaskAttributes', () => {
  it('defaults the optional fields without pinning a priority', () => {
    const attributes = createTaskAttributes({ title: 'New', columnId: 'c1' });

    expect(attributes).toEqual({
      title: 'New',
      description: null,
      dueDate: null,
      estimatedMinutes: null,
    });
    expect('priority' in attributes).toBe(false);
  });

  it('carries priority, dueDate and estimatedMinutes through', () => {
    const attributes = createTaskAttributes({
      title: 'New',
      columnId: 'c1',
      priority: Priority.URGENT,
      dueDate: '2026-09-01T00:00:00.000Z',
      estimatedMinutes: 90,
    });

    expect(attributes).toEqual({
      title: 'New',
      description: null,
      priority: Priority.URGENT,
      dueDate: new Date('2026-09-01T00:00:00.000Z'),
      estimatedMinutes: 90,
    });
  });
});

describe('planTaskUpdate', () => {
  it('writes nothing and reports nothing for an empty patch', () => {
    expect(planTaskUpdate(existing, {})).toEqual({ data: {}, changes: {} });
  });

  it('writes a resent field but does not report it as a change', () => {
    const { data, changes } = planTaskUpdate(existing, { title: existing.title });

    expect(data).toEqual({ title: existing.title });
    expect(changes).toEqual({});
  });

  it('reports a real edit', () => {
    const { data, changes } = planTaskUpdate(existing, {
      title: 'Renamed',
      priority: Priority.HIGH,
    });

    expect(data).toEqual({ title: 'Renamed', priority: Priority.HIGH });
    expect(changes).toEqual({ title: 'Renamed', priority: Priority.HIGH });
  });

  it('clears a nullable field on an explicit null', () => {
    const { data, changes } = planTaskUpdate(existing, { dueDate: null, estimatedMinutes: null });

    expect(data).toEqual({ dueDate: null, estimatedMinutes: null });
    expect(changes).toEqual({ dueDate: null, estimatedMinutes: null });
  });

  it('compares due dates by instant, not by object identity', () => {
    const { changes } = planTaskUpdate(existing, { dueDate: '2026-09-01T00:00:00.000Z' });

    expect(changes).toEqual({});
  });

  it('records the new due date as an ISO string', () => {
    const { data, changes } = planTaskUpdate(existing, { dueDate: '2026-10-02T08:00:00.000Z' });

    expect(data.dueDate).toEqual(new Date('2026-10-02T08:00:00.000Z'));
    expect(changes).toEqual({ dueDate: '2026-10-02T08:00:00.000Z' });
  });

  it('rejects a timestamp Date cannot represent', () => {
    expect(() => planTaskUpdate(existing, { dueDate: '2026-13-45T99:99:99Z' })).toThrow(
      BadRequestException,
    );
  });
});
