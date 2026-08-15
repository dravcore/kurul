import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { AttachmentKind } from '@kurultay/shared-types';
import {
  ATTACHMENT_UPLOAD_RATE_LIMIT,
  DEFAULT_RATE_LIMIT,
  RATE_LIMIT_WINDOW_SECONDS,
} from '../common/rate-limit/rate-limit';
import type { AuthenticatedUser } from '../common/types/request-context';
import { AttachmentController } from './attachment.controller';
import { AttachmentService } from './attachment.service';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d55';
const USER = { id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d54' } as AuthenticatedUser;

function build() {
  const attachments = {
    list: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue({}),
    createLink: jest.fn().mockResolvedValue({}),
    createFile: jest.fn().mockResolvedValue({}),
    remove: jest.fn().mockResolvedValue(undefined),
  } as unknown as AttachmentService;
  return { controller: new AttachmentController(attachments), attachments };
}

const file = { originalname: 'a.png', mimetype: 'image/png', size: 3, buffer: Buffer.alloc(3) };

describe('AttachmentController.create', () => {
  it('routes a LINK body to the link path, whatever else the request carried', () => {
    const { controller, attachments } = build();

    void controller.create(
      WORKSPACE_ID,
      TASK_ID,
      USER,
      { kind: AttachmentKind.Link, url: 'https://example.com' },
      // A caller that sends both a `kind: LINK` body and a file part gets the kind it asked
      // for: `kind` is the declaration, and the file's presence is never the thing consulted
      // (plan decision D7).
      file,
    );

    expect(attachments.createLink).toHaveBeenCalled();
    expect(attachments.createFile).not.toHaveBeenCalled();
  });

  it('routes a FILE body with a part to the upload path', () => {
    const { controller, attachments } = build();

    void controller.create(WORKSPACE_ID, TASK_ID, USER, { kind: AttachmentKind.File }, file);

    expect(attachments.createFile).toHaveBeenCalledWith(WORKSPACE_ID, TASK_ID, USER.id, file);
  });

  it('names the missing part rather than guessing what the caller meant', () => {
    const { controller, attachments } = build();

    expect(() =>
      controller.create(WORKSPACE_ID, TASK_ID, USER, { kind: AttachmentKind.File }, undefined),
    ).toThrow(BadRequestException);
    expect(attachments.createFile).not.toHaveBeenCalled();
  });
});

describe('AttachmentController rate limits', () => {
  /** The metadata `Throttle()` writes; see `@nestjs/throttler/dist/throttler.decorator.js`. */
  function limitOn(handler: unknown): unknown {
    return Reflect.getMetadata('THROTTLER:LIMIT' + 'default', handler as object);
  }
  function ttlOn(handler: unknown): unknown {
    return Reflect.getMetadata('THROTTLER:TTL' + 'default', handler as object);
  }

  it('caps uploads well below the API default', () => {
    // The failure mode this pins is silent: a decorator that is dropped in a refactor leaves the
    // route on the global 100/min, which at 25 MiB a request is 2.5 GiB of disk a minute from
    // one IP. Nothing else in the build would notice (plan decision D9).
    expect(limitOn(AttachmentController.prototype.create)).toBe(ATTACHMENT_UPLOAD_RATE_LIMIT);
    expect(ATTACHMENT_UPLOAD_RATE_LIMIT).toBeLessThan(DEFAULT_RATE_LIMIT);
    expect(ttlOn(AttachmentController.prototype.create)).toBe(RATE_LIMIT_WINDOW_SECONDS * 1000);
  });

  it('leaves the ordinary reads on the default budget', () => {
    expect(limitOn(AttachmentController.prototype.list)).toBeUndefined();
    expect(limitOn(AttachmentController.prototype.findOne)).toBeUndefined();
    expect(limitOn(AttachmentController.prototype.remove)).toBeUndefined();
  });
});
