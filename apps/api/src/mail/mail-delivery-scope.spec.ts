import { MailDeliveryStatus } from '@kurul/shared-types';
import { captureMailDelivery, recordMailDelivery } from './mail-delivery-scope';

describe('captureMailDelivery', () => {
  it('returns the operation result alongside the delivery recorded inside it', async () => {
    const { result, delivery } = await captureMailDelivery(async () => {
      recordMailDelivery(MailDeliveryStatus.NOT_CONFIGURED);
      return 'inv_1';
    });

    expect(result).toBe('inv_1');
    expect(delivery).toBe(MailDeliveryStatus.NOT_CONFIGURED);
  });

  it('reports `undefined` when the operation sent nothing', async () => {
    const { delivery } = await captureMailDelivery(() => Promise.resolve('inv_1'));

    // Not `SENT`: nothing was observed, and the caller has to be able to tell those apart.
    expect(delivery).toBeUndefined();
  });

  it('follows the await chain, so a send several awaits deep still reports', async () => {
    const { delivery } = await captureMailDelivery(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setImmediate(resolve));
      recordMailDelivery(MailDeliveryStatus.FAILED);
    });

    expect(delivery).toBe(MailDeliveryStatus.FAILED);
  });

  it('propagates a rejection instead of swallowing it', async () => {
    await expect(
      captureMailDelivery(() => Promise.reject(new Error('plugin refused'))),
    ).rejects.toThrow('plugin refused');
  });

  /**
   * The reason the scope exists at all: two admins inviting at once must not read each other's
   * outcome. Interleaved deliberately — both scopes are open when either one records.
   */
  it('keeps concurrent operations from reading each other outcomes', async () => {
    const gate = { open: () => undefined as void };
    const opened = new Promise<void>((resolve) => {
      gate.open = resolve;
    });

    const first = captureMailDelivery(async () => {
      await opened;
      recordMailDelivery(MailDeliveryStatus.NOT_CONFIGURED);
    });
    const second = captureMailDelivery(async () => {
      recordMailDelivery(MailDeliveryStatus.SENT);
      gate.open();
    });

    expect((await first).delivery).toBe(MailDeliveryStatus.NOT_CONFIGURED);
    expect((await second).delivery).toBe(MailDeliveryStatus.SENT);
  });

  it('keeps the first non-SENT outcome when a scope covers several sends', async () => {
    const { delivery } = await captureMailDelivery(async () => {
      recordMailDelivery(MailDeliveryStatus.FAILED);
      recordMailDelivery(MailDeliveryStatus.SENT);
      await Promise.resolve();
    });

    expect(delivery).toBe(MailDeliveryStatus.FAILED);
  });

  it('lets a failure replace an earlier success', async () => {
    const { delivery } = await captureMailDelivery(async () => {
      recordMailDelivery(MailDeliveryStatus.SENT);
      recordMailDelivery(MailDeliveryStatus.NOT_CONFIGURED);
      await Promise.resolve();
    });

    expect(delivery).toBe(MailDeliveryStatus.NOT_CONFIGURED);
  });
});

describe('recordMailDelivery outside a scope', () => {
  it('does nothing, so an unwatched send (verification email) is not an error', () => {
    expect(() => {
      recordMailDelivery(MailDeliveryStatus.FAILED);
    }).not.toThrow();
  });
});
