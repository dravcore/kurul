import { Logger } from '@nestjs/common';
import { MailDeliveryStatus } from '@kurul/shared-types';
import type { MailMessage } from './mail-sender';
import { MailService } from './mail.service';
import { closeMailSender, getMailSender } from './send-mail';

const MESSAGE: MailMessage = {
  to: 'invitee@example.test',
  subject: 'You have been invited to join Analytical Engine on Kurul',
  text: 'http://localhost:3000/invite/1',
  html: '<p>http://localhost:3000/invite/1</p>',
};

describe('MailService', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('hands the message to the process-wide sender', async () => {
    const service = new MailService();
    const send = jest.spyOn(getMailSender(), 'send').mockResolvedValue(undefined);

    await service.send(MESSAGE);

    expect(send).toHaveBeenCalledWith(MESSAGE);
  });

  it('does not reject when delivery fails, and says so in the resolved value', async () => {
    const service = new MailService();
    jest.spyOn(getMailSender(), 'send').mockRejectedValue(new Error('relay refused'));

    await expect(service.send(MESSAGE)).resolves.toBe(MailDeliveryStatus.FAILED);
  });

  /**
   * The `mailEnabled` signal behind `GET /config`, read through the DI face a controller has.
   * Both directions come from the transport itself, never from a second read of `SMTP_HOST` —
   * see `send-mail.spec.ts`, which pins that down against the environment.
   */
  it('reports mail as disabled while the process-wide transport delivers nothing', async () => {
    const originalHost = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    await closeMailSender();

    try {
      expect(new MailService().isEnabled()).toBe(false);
    } finally {
      if (originalHost !== undefined) process.env.SMTP_HOST = originalHost;
      await closeMailSender();
    }
  });

  it('closes the transport when the application shuts down', async () => {
    const service = new MailService();
    const close = jest.spyOn(getMailSender(), 'close');

    await service.onApplicationShutdown();

    expect(close).toHaveBeenCalled();
  });
});
