import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { MailMessage } from './mail-sender';
import { closeMailSender, sendMail } from './send-mail';

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
  /** Never rejects: a failed delivery is logged, not propagated to the caller's request. */
  send(message: MailMessage): Promise<void> {
    return sendMail(message);
  }

  async onModuleDestroy(): Promise<void> {
    await closeMailSender();
  }
}
