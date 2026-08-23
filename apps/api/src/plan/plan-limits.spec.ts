import {
  describeInstancePlanLimits,
  describePlanCeilings,
  parseWorkspacePlanOverride,
  PLAN_LIMIT_ENV,
  quotaBytesToCeiling,
  readInstancePlanLimits,
  resolveWorkspacePlanLimits,
} from './plan-limits';

const VARS = Object.values(PLAN_LIMIT_ENV);

describe('plan limits (ADR 0032)', () => {
  beforeEach(() => {
    for (const name of VARS) {
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of VARS) {
      delete process.env[name];
    }
  });

  describe('reading the environment', () => {
    it('is unlimited on an instance that configures nothing', () => {
      expect(readInstancePlanLimits()).toEqual({
        seatsPerWorkspace: null,
        boardsPerWorkspace: null,
        workspaces: null,
        users: null,
      });
    });

    it('reads each ceiling from its own variable', () => {
      process.env[PLAN_LIMIT_ENV.seatsPerWorkspace] = '10';
      process.env[PLAN_LIMIT_ENV.boardsPerWorkspace] = '3';
      process.env[PLAN_LIMIT_ENV.workspaces] = '50';
      process.env[PLAN_LIMIT_ENV.users] = '200';

      expect(readInstancePlanLimits()).toEqual({
        seatsPerWorkspace: 10,
        boardsPerWorkspace: 3,
        workspaces: 50,
        users: 200,
      });
    });

    it('treats a written 0 as unlimited, the spelling the byte quotas use', () => {
      process.env[PLAN_LIMIT_ENV.seatsPerWorkspace] = '0';

      expect(readInstancePlanLimits().seatsPerWorkspace).toBeNull();
    });

    it('treats blank as unset rather than as zero', () => {
      process.env[PLAN_LIMIT_ENV.boardsPerWorkspace] = '   ';

      expect(readInstancePlanLimits().boardsPerWorkspace).toBeNull();
    });

    it.each(VARS)('refuses a negative %s at boot', (name) => {
      process.env[name] = '-1';

      expect(() => readInstancePlanLimits()).toThrow(new RegExp(name));
    });

    it('refuses a non-integer at boot, naming the variable', () => {
      process.env[PLAN_LIMIT_ENV.users] = '12.5';

      expect(() => readInstancePlanLimits()).toThrow(/PLAN_MAX_USERS/);
    });

    it('refuses text at boot rather than reading it as unlimited', () => {
      process.env[PLAN_LIMIT_ENV.workspaces] = 'unlimited';

      expect(() => readInstancePlanLimits()).toThrow(/PLAN_MAX_WORKSPACES/);
    });
  });

  describe('the workspace override column', () => {
    it('is empty for a workspace that has none', () => {
      expect(parseWorkspacePlanOverride(null)).toEqual({});
      expect(parseWorkspacePlanOverride(undefined)).toEqual({});
    });

    it('reads the three understood keys', () => {
      expect(parseWorkspacePlanOverride({ seats: 5, boards: 2, storageBytes: 1024 })).toEqual({
        seats: 5,
        boards: 2,
        storageBytes: 1024,
      });
    });

    it('keeps an explicit null, which is not the same as an absent key', () => {
      expect(parseWorkspacePlanOverride({ seats: null })).toEqual({ seats: null });
      expect(parseWorkspacePlanOverride({})).toEqual({});
    });

    it('reads 0 as unlimited, as the environment does', () => {
      expect(parseWorkspacePlanOverride({ boards: 0 })).toEqual({ boards: null });
    });

    it('ignores unknown keys, so a later ceiling cannot break an older reader', () => {
      expect(parseWorkspacePlanOverride({ seats: 5, tasksPerBoard: 9 })).toEqual({ seats: 5 });
    });

    it.each([
      ['a string', { seats: '5' }],
      ['a fraction', { seats: 2.5 }],
      ['a negative', { seats: -1 }],
      ['an object', { seats: { max: 5 } }],
    ])('drops an unusable value (%s) instead of refusing the workspace', (_label, stored) => {
      expect(parseWorkspacePlanOverride(stored)).toEqual({});
    });

    it.each([
      ['an array', [1, 2]],
      ['a string', 'seats=5'],
      ['a number', 7],
    ])('reads a column that is not an object (%s) as no override', (_label, stored) => {
      expect(parseWorkspacePlanOverride(stored)).toEqual({});
    });
  });

  describe('resolution: override, then instance, then unlimited', () => {
    const instance = {
      seatsPerWorkspace: 10,
      boardsPerWorkspace: 4,
      workspaces: null,
      users: null,
    };

    it('falls back to the instance when the workspace has no override', () => {
      expect(resolveWorkspacePlanLimits(instance, 2048, {})).toEqual({
        seats: 10,
        boards: 4,
        storageBytes: 2048,
      });
    });

    it('is unlimited when neither the workspace nor the instance says anything', () => {
      expect(
        resolveWorkspacePlanLimits(
          { seatsPerWorkspace: null, boardsPerWorkspace: null, workspaces: null, users: null },
          0,
          {},
        ),
      ).toEqual({ seats: null, boards: null, storageBytes: null });
    });

    it('lets the workspace override one ceiling without touching the others', () => {
      expect(resolveWorkspacePlanLimits(instance, 2048, { seats: 25 })).toEqual({
        seats: 25,
        boards: 4,
        storageBytes: 2048,
      });
    });

    it('lets a workspace be unlimited on an instance that has a ceiling', () => {
      expect(resolveWorkspacePlanLimits(instance, 2048, { seats: null })).toEqual({
        seats: null,
        boards: 4,
        storageBytes: 2048,
      });
    });

    it('translates the byte quota spelling: 0 bytes is unlimited', () => {
      expect(quotaBytesToCeiling(0)).toBeNull();
      expect(quotaBytesToCeiling(2048)).toBe(2048);
      expect(resolveWorkspacePlanLimits(instance, 0, {}).storageBytes).toBeNull();
    });
  });

  describe('what the instance publishes', () => {
    it('carries the attachment quotas as members of the same object', () => {
      expect(
        describeInstancePlanLimits(
          { seatsPerWorkspace: 10, boardsPerWorkspace: null, workspaces: 5, users: null },
          { workspaceQuotaBytes: 2_147_483_648, instanceQuotaBytes: 0 },
        ),
      ).toEqual({
        seatsPerWorkspace: 10,
        boardsPerWorkspace: null,
        workspaces: 5,
        users: null,
        storageBytesPerWorkspace: 2_147_483_648,
        storageBytesPerInstance: null,
      });
    });
  });

  describe('the boot log line', () => {
    it('says unlimited for every ceiling nobody set', () => {
      expect(
        describePlanCeilings({
          seatsPerWorkspace: null,
          boardsPerWorkspace: null,
          workspaces: null,
          users: null,
        }),
      ).toBe(
        'Plan ceilings: seatsPerWorkspace=unlimited boardsPerWorkspace=unlimited ' +
          'workspaces=unlimited users=unlimited',
      );
    });

    it('names the numbers an operator configured', () => {
      expect(
        describePlanCeilings({
          seatsPerWorkspace: 10,
          boardsPerWorkspace: 4,
          workspaces: 50,
          users: 200,
        }),
      ).toBe('Plan ceilings: seatsPerWorkspace=10 boardsPerWorkspace=4 workspaces=50 users=200');
    });
  });
});
