import { Logger } from '@nestjs/common';
import type { MailMessage, MailSender } from './mail-sender';
import { closeMailSender, createMailSender, getMailSender, sendWith } from './send-mail';

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
      send: jest.fn<Promise<void>, [MailMessage]>().mockRejectedValue(error),
      close: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    };
  }

  it('passes the message to the transport', async () => {
    const sender: MailSender = {
      transport: 'log',
      send: jest.fn<Promise<void>, [MailMessage]>().mockResolvedValue(undefined),
      close: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    };

    await sendWith(sender, MESSAGE);

    expect(sender.send).toHaveBeenCalledWith(MESSAGE);
  });

  it('swallows a delivery failure so the calling request still succeeds', async () => {
    const sender = failingSender(new Error('ECONNREFUSED smtp.example.test:587'));

    await expect(sendWith(sender, MESSAGE)).resolves.toBeUndefined();
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
