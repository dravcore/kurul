import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { InstanceConfigController } from './instance-config.controller';

/**
 * The instance capability document (`GET /config`).
 *
 * Its own module rather than a handler bolted onto `MailModule` or `HealthModule`: what it
 * publishes is a client contract assembled *from* feature modules, and it will keep gaining
 * flags owned by modules that have nothing to do with mail. Importing them here — instead of
 * teaching each of them to publish itself — keeps the shape of the document in one file that
 * can be read against `InstanceConfigDto`.
 */
@Module({
  imports: [MailModule],
  controllers: [InstanceConfigController],
})
export class InstanceConfigModule {}
