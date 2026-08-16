import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

/**
 * Outbound email.
 *
 * Registered in `AppModule` independently of who imports it: the module is what gives the SMTP
 * transport a shutdown hook, and it has to exist whether or not anything injects `MailService`
 * in a given build. `InstanceConfigModule` is the first importer — it asks `MailService`
 * whether mail is configured, which is a question only the module that owns the transport can
 * answer — and the next consumer (digest or notification email) imports this module the same
 * way rather than reaching for the transport directly.
 */
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
