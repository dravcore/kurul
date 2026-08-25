import type { InstancePlanLimitsDto } from '@kurul/shared-types';
import { SIGNUP_ENABLED_ENV } from '../auth/sign-up-policy';
import { MailService } from '../mail/mail.service';
import { PlanLimitsService } from '../plan/plan-limits.service';
import { StorageService } from '../storage/storage.service';
import { InstanceConfigController } from './instance-config.controller';

/**
 * `DEMO_MODE` and `SIGNUP_ENABLED` are unset in this suite unless a test says otherwise, so
 * every document carries the off shape for the one and the open shape for the other. Spelled out
 * rather than matched loosely: the nulls are the contract (`demo-mode.ts` refuses to publish a
 * plausible-looking schedule on an instance that has none), and the schedule's own arithmetic
 * is tested in `src/demo/demo-mode.spec.ts`.
 */
const NO_DEMO = { enabled: false, resetIntervalMinutes: null, nextResetAt: null } as const;

/**
 * A stand-in instance plan document. The four counts are the ones an unconfigured instance
 * publishes (ADR 0032); the two byte quotas are `PlanLimitsService.instanceCeilings` own
 * concern, tested against `StorageService` in plan-limits.spec.ts, not here. This suite only
 * asserts that the controller passes the object through untouched.
 */
const PLAN_LIMITS: InstancePlanLimitsDto = {
  seatsPerWorkspace: null,
  boardsPerWorkspace: null,
  workspaces: null,
  users: null,
  storageBytesPerWorkspace: 2_147_483_648,
  storageBytesPerInstance: 21_474_836_480,
};

function buildController(
  mailEnabled: boolean,
  attachmentsEnabled = false,
): {
  controller: InstanceConfigController;
  isEnabled: jest.Mock;
  persistsFiles: jest.Mock;
} {
  const isEnabled = jest.fn().mockReturnValue(mailEnabled);
  const mail = { isEnabled } as unknown as MailService;

  // A getter, not a field: `StorageService.persistsFiles` is one, and a plain property here
  // would let a stale copy pass a test the real class would fail.
  const persistsFiles = jest.fn().mockReturnValue(attachmentsEnabled);
  const storage = {
    get persistsFiles() {
      return persistsFiles() as boolean;
    },
  } as unknown as StorageService;

  const planLimits = {
    instanceCeilings: jest.fn().mockReturnValue(PLAN_LIMITS),
  } as unknown as PlanLimitsService;

  return {
    controller: new InstanceConfigController(mail, storage, planLimits),
    isEnabled,
    persistsFiles,
  };
}

describe('InstanceConfigController', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('reports mail as enabled when the mail module has a delivering transport', () => {
    const { controller } = buildController(true);

    expect(controller.config()).toEqual({
      mailEnabled: true,
      attachmentsEnabled: false,
      signUpEnabled: true,
      demo: NO_DEMO,
      planLimits: PLAN_LIMITS,
    });
  });

  it('reports mail as disabled when it does not', () => {
    const { controller } = buildController(false);

    expect(controller.config()).toEqual({
      mailEnabled: false,
      attachmentsEnabled: false,
      signUpEnabled: true,
      demo: NO_DEMO,
      planLimits: PLAN_LIMITS,
    });
  });

  it('reports attachments as enabled when the storage module persists files', () => {
    const { controller } = buildController(false, true);

    expect(controller.config()).toEqual({
      mailEnabled: false,
      attachmentsEnabled: true,
      signUpEnabled: true,
      demo: NO_DEMO,
      planLimits: PLAN_LIMITS,
    });
  });

  /**
   * The same function the Better Auth mount reads, so a client that sees `false` here is the
   * client whose sign-up would be refused; the document is not allowed a second opinion.
   */
  it('reports registration as closed when SIGNUP_ENABLED is false', () => {
    process.env[SIGNUP_ENABLED_ENV] = 'false';
    const { controller } = buildController(false);

    expect(controller.config()).toEqual({
      mailEnabled: false,
      attachmentsEnabled: false,
      signUpEnabled: false,
      demo: NO_DEMO,
      planLimits: PLAN_LIMITS,
    });
  });

  /**
   * The controller owns the shape of the document and nothing else. If it ever grew its own
   * opinion about SMTP — an environment read, a cached copy — the UI could contradict the
   * transport that is actually running, which is the failure mode audit PM-04 describes. The
   * same holds for storage: `STORAGE_PATH` is read in `storage-config.ts` and nowhere else.
   */
  it('takes the values from the feature modules rather than deciding them', () => {
    const { controller, isEnabled, persistsFiles } = buildController(false);

    controller.config();

    expect(isEnabled).toHaveBeenCalledTimes(1);
    expect(persistsFiles).toHaveBeenCalledTimes(1);
  });

  /**
   * Not memoized: a transport swapped at runtime (`closeMailSender`) has to be visible on the
   * next request, and a second copy of the answer is a second thing that can be stale. Storage
   * has the same reset hook (`closeStorageBackend`) for the same reason.
   */
  it('asks again on every request instead of caching the answer', () => {
    const { controller, isEnabled, persistsFiles } = buildController(true, true);
    isEnabled.mockReturnValueOnce(true).mockReturnValueOnce(false);
    persistsFiles.mockReturnValueOnce(true).mockReturnValueOnce(false);

    expect(controller.config()).toEqual({
      mailEnabled: true,
      attachmentsEnabled: true,
      signUpEnabled: true,
      demo: NO_DEMO,
      planLimits: PLAN_LIMITS,
    });
    expect(controller.config()).toEqual({
      mailEnabled: false,
      attachmentsEnabled: false,
      signUpEnabled: true,
      demo: NO_DEMO,
      planLimits: PLAN_LIMITS,
    });
  });
});
