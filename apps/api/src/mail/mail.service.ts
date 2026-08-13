import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { MailDeliveryStatus } from '@kurultay/shared-types';
import type { MailMessage } from './mail-sender';
import { closeMailSender, mailEnabled, sendMail } from './send-mail';

/**
 * The DI-facing face of the mail module.
 *
 * It deliberately holds no state: the transport is a process-wide singleton (see
 * `send-mail.ts` for why), and this class exists so Nest consumers inject a dependency they
 * can replace in a test instead of importing a module-level function — and so the transport
 * has an owner that closes it when the application shuts down.
 */
@Injectable()
export class MailService implements OnModuleDestroy {
  /**
   * Whether this deployment can deliver email at all.
   *
   * Cheap enough to call per request — it reads a field off the process-wide transport, which
   * is built once — and deliberately *not* cached here on top of that. A cached copy would
   * survive `closeMailSender`, and the one moment it would be wrong is a test that swaps the
   * transport, which is the moment anything reading it is being checked.
   */
  isEnabled(): boolean {
    return mailEnabled();
  }

  /**
   * Never rejects: a failed delivery is logged, not propagated to the caller's request. The
   * resolved value says which of the three outcomes it was, for a caller with somewhere to
   * show it.
   */
  send(message: MailMessage): Promise<MailDeliveryStatus> {
    return sendMail(message);
  }

  async onModuleDestroy(): Promise<void> {
    await closeMailSender();
  }
}
