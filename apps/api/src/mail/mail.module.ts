import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

/**
 * Outbound email.
 *
 * Registered in `AppModule` even though no Nest provider injects `MailService` yet: the
 * module is what gives the SMTP transport a shutdown hook, and the next consumer (digest or
 * notification email) imports this module rather than reaching for the transport directly.
 */
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
