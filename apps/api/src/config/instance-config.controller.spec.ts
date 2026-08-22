import { MailService } from '../mail/mail.service';
import { StorageService } from '../storage/storage.service';
import { InstanceConfigController } from './instance-config.controller';

/**
 * `DEMO_MODE` is unset in this suite, so every document carries the off shape. Spelled out
 * rather than matched loosely: the nulls are the contract (`demo-mode.ts` refuses to publish a
 * plausible-looking schedule on an instance that has none), and the schedule's own arithmetic
 * is tested in `src/demo/demo-mode.spec.ts`.
 */
const NO_DEMO = { enabled: false, resetIntervalMinutes: null, nextResetAt: null } as const;

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

  return { controller: new InstanceConfigController(mail, storage), isEnabled, persistsFiles };
}

describe('InstanceConfigController', () => {
  it('reports mail as enabled when the mail module has a delivering transport', () => {
    const { controller } = buildController(true);

    expect(controller.config()).toEqual({
      mailEnabled: true,
      attachmentsEnabled: false,
      demo: NO_DEMO,
    });
  });

  it('reports mail as disabled when it does not', () => {
    const { controller } = buildController(false);

    expect(controller.config()).toEqual({
      mailEnabled: false,
      attachmentsEnabled: false,
      demo: NO_DEMO,
    });
  });

  it('reports attachments as enabled when the storage module persists files', () => {
    const { controller } = buildController(false, true);

    expect(controller.config()).toEqual({
      mailEnabled: false,
      attachmentsEnabled: true,
      demo: NO_DEMO,
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
      demo: NO_DEMO,
    });
    expect(controller.config()).toEqual({
      mailEnabled: false,
      attachmentsEnabled: false,
      demo: NO_DEMO,
    });
  });
});
