import { Logger } from '@nestjs/common';
import { MailDeliveryStatus } from '@kurultay/shared-types';
import { captureMailDelivery } from './mail-delivery-scope';
import type { MailMessage, MailSender } from './mail-sender';
import {
  closeMailSender,
  createMailSender,
  getMailSender,
  mailEnabled,
  sendMail,
  sendWith,
} from './send-mail';

const MESSAGE: MailMessage = {
  to: 'invitee@example.test',
  subject: 'Confirm your email address for Kurultay',
  text: 'Open http://localhost:3000/verify-email to continue',
  html: '<p>Open http://localhost:3000/verify-email to continue</p>',
};

describe('mail transport selection', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await closeMailSender();
  });

  it('falls back to the log transport when SMTP is not configured', () => {
    const sender = createMailSender({ from: 'Kurultay <noreply@localhost>', smtp: undefined });

    expect(sender.transport).toBe('log');
  });

  it('warns loudly when it falls back, because nothing is delivered in that state', () => {
    createMailSender({ from: 'Kurultay <noreply@localhost>', smtp: undefined });

    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('SMTP_HOST'));
  });

  it('logs the recipient, subject and body so a dev can follow the link from the console', async () => {
    const sender = createMailSender({ from: 'Kurultay <noreply@localhost>', smtp: undefined });

    await sender.send(MESSAGE);

    const logged = jest.mocked(Logger.prototype.log).mock.calls.at(-1)?.[0];
    expect(logged).toEqual(expect.stringContaining(MESSAGE.to));
    expect(logged).toEqual(expect.stringContaining(MESSAGE.subject));
    expect(logged).toEqual(expect.stringContaining('http://localhost:3000/verify-email'));
  });

  it('uses SMTP when a host is configured', () => {
    const sender = createMailSender({
      from: 'Kurultay <noreply@example.test>',
      smtp: { host: 'smtp.example.test', port: 587, secure: false },
    });

    expect(sender.transport).toBe('smtp');
  });

  it('marks the log transport as delivering nothing, and SMTP as delivering', () => {
    const log = createMailSender({ from: 'Kurultay <noreply@localhost>', smtp: undefined });
    const smtp = createMailSender({
      from: 'Kurultay <noreply@example.test>',
      smtp: { host: 'smtp.example.test', port: 587, secure: false },
    });

    expect(log.deliversMail).toBe(false);
    expect(smtp.deliversMail).toBe(true);
  });

  it('builds the process-wide sender once', () => {
    expect(getMailSender()).toBe(getMailSender());
  });

  it('closes the sender and drops it, so the next send builds a fresh one', async () => {
    const first = getMailSender();

    await closeMailSender();

    expect(getMailSender()).not.toBe(first);
  });
});

describe('sendWith', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  function failingSender(error: Error): MailSender {
    return {
      transport: 'smtp',
      deliversMail: true,
      send: jest.fn<Promise<void>, [MailMessage]>().mockRejectedValue(error),
      close: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    };
  }

  function workingSender(deliversMail: boolean): MailSender {
    return {
      transport: deliversMail ? 'smtp' : 'log',
      deliversMail,
      send: jest.fn<Promise<void>, [MailMessage]>().mockResolvedValue(undefined),
      close: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    };
  }

  it('passes the message to the transport', async () => {
    const sender = workingSender(false);

    await sendWith(sender, MESSAGE);

    expect(sender.send).toHaveBeenCalledWith(MESSAGE);
  });

  it('reports SENT when a delivering transport accepted the message', async () => {
    await expect(sendWith(workingSender(true), MESSAGE)).resolves.toBe(MailDeliveryStatus.SENT);
  });

  it('reports NOT_CONFIGURED when the transport delivers nothing', async () => {
    await expect(sendWith(workingSender(false), MESSAGE)).resolves.toBe(
      MailDeliveryStatus.NOT_CONFIGURED,
    );
  });

  it('reports FAILED when the transport refused it', async () => {
    const sender = failingSender(new Error('ECONNREFUSED smtp.example.test:587'));

    await expect(sendWith(sender, MESSAGE)).resolves.toBe(MailDeliveryStatus.FAILED);
  });

  /**
   * `deliversMail`, not `transport`, decides — so a second delivering transport added later
   * cannot be read as "no mail here" by a stale `=== 'smtp'` comparison.
   */
  it('reads the capability off the transport rather than its name', async () => {
    const sender: MailSender = { ...workingSender(true), transport: 'log' };

    await expect(sendWith(sender, MESSAGE)).resolves.toBe(MailDeliveryStatus.SENT);
  });

  it('swallows a delivery failure so the calling request still succeeds', async () => {
    const sender = failingSender(new Error('ECONNREFUSED smtp.example.test:587'));

    // Resolving at all is the assertion: the policy is that a refused relay never becomes the
    // caller's exception. What it resolves *to* is covered above.
    await expect(sendWith(sender, MESSAGE)).resolves.toBeDefined();
  });

  it('reports the swallowed failure at error level, with the recipient and subject', async () => {
    const sender = failingSender(new Error('ECONNREFUSED smtp.example.test:587'));

    await sendWith(sender, MESSAGE);

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining(MESSAGE.to),
      expect.stringContaining('ECONNREFUSED'),
    );
    expect(jest.mocked(Logger.prototype.error).mock.calls[0]?.[0]).toEqual(
      expect.stringContaining(MESSAGE.subject),
    );
  });
});

/**
 * The `mailEnabled` signal published by `GET /config`.
 *
 * The finding these tests guard (audit PM-04) is not "the boolean is wrong" but "the boolean
 * drifts": the temptation is to answer it by reading `SMTP_HOST` again, next to the read in
 * `mail-config.ts`, and then the UI and the transport can disagree about the same deployment.
 */
describe('mailEnabled', () => {
  const originalHost = process.env.SMTP_HOST;

  beforeEach(async () => {
    jest.restoreAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    // The signal reads the process-wide transport, so each case has to start without one.
    await closeMailSender();
  });

  afterEach(async () => {
    await closeMailSender();
    if (originalHost === undefined) {
      delete process.env.SMTP_HOST;
    } else {
      process.env.SMTP_HOST = originalHost;
    }
  });

  it('is false when SMTP_HOST is unset, because nothing is delivered', () => {
    delete process.env.SMTP_HOST;

    expect(mailEnabled()).toBe(false);
  });

  it('is true when SMTP_HOST is set', () => {
    process.env.SMTP_HOST = 'smtp.example.test';

    expect(mailEnabled()).toBe(true);
  });

  /**
   * Both directions of the same claim: the answer comes from the transport that was built, so
   * changing the environment underneath a running process cannot move it. A second reader of
   * `SMTP_HOST` would fail these — it would follow the environment while the transport did not.
   */
  it('follows the transport in use, not a later change to SMTP_HOST', () => {
    process.env.SMTP_HOST = 'smtp.example.test';
    expect(mailEnabled()).toBe(true);

    delete process.env.SMTP_HOST;

    expect(mailEnabled()).toBe(true);
  });

  it('stays false for a process that started without SMTP, whatever the environment says now', () => {
    delete process.env.SMTP_HOST;
    expect(mailEnabled()).toBe(false);

    process.env.SMTP_HOST = 'smtp.example.test';

    expect(mailEnabled()).toBe(false);
  });

  it('picks the new configuration up once the transport is rebuilt', async () => {
    delete process.env.SMTP_HOST;
    expect(mailEnabled()).toBe(false);

    process.env.SMTP_HOST = 'smtp.example.test';
    await closeMailSender();

    expect(mailEnabled()).toBe(true);
  });
});

describe('sendMail', () => {
  const originalHost = process.env.SMTP_HOST;

  beforeEach(async () => {
    jest.restoreAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await closeMailSender();
    delete process.env.SMTP_HOST;
  });

  afterEach(async () => {
    await closeMailSender();
    if (originalHost === undefined) {
      delete process.env.SMTP_HOST;
    } else {
      process.env.SMTP_HOST = originalHost;
    }
  });

  it('reports an undeliverable send into the enclosing capture', async () => {
    const { delivery } = await captureMailDelivery(() => sendMail(MESSAGE));

    expect(delivery).toBe(MailDeliveryStatus.NOT_CONFIGURED);
  });

  it('still resolves outside a capture, where there is nobody to report to', async () => {
    await expect(sendMail(MESSAGE)).resolves.toBe(MailDeliveryStatus.NOT_CONFIGURED);
  });
});
