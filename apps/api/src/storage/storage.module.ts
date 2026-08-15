import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * Attachment storage.
 *
 * Registered in `AppModule` independently of who imports it: the module is what gives the
 * backend a shutdown hook, and it has to exist whether or not anything injects `StorageService`
 * in a given build. `InstanceConfigModule` and `AttachmentModule` are its two importers.
 */
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
