import { Logger } from '@nestjs/common';
import type { MailMessage } from './mail-sender';
import { MailService } from './mail.service';
import { getMailSender } from './send-mail';

const MESSAGE: MailMessage = {
  to: 'invitee@example.test',
  subject: 'You have been invited to join Analytical Engine on Kurultay',
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

  it('does not reject when delivery fails', async () => {
    const service = new MailService();
    jest.spyOn(getMailSender(), 'send').mockRejectedValue(new Error('relay refused'));

    await expect(service.send(MESSAGE)).resolves.toBeUndefined();
  });

  it('closes the transport when the application shuts down', async () => {
    const service = new MailService();
    const close = jest.spyOn(getMailSender(), 'close');

    await service.onModuleDestroy();

    expect(close).toHaveBeenCalled();
  });
});
