import { MailService } from '../mail/mail.service';
import { InstanceConfigController } from './instance-config.controller';

function buildController(mailEnabled: boolean): {
  controller: InstanceConfigController;
  isEnabled: jest.Mock;
} {
  const isEnabled = jest.fn().mockReturnValue(mailEnabled);
  const mail = { isEnabled } as unknown as MailService;

  return { controller: new InstanceConfigController(mail), isEnabled };
}

describe('InstanceConfigController', () => {
  it('reports mail as enabled when the mail module has a delivering transport', () => {
    const { controller } = buildController(true);

    expect(controller.config()).toEqual({ mailEnabled: true });
  });

  it('reports mail as disabled when it does not', () => {
    const { controller } = buildController(false);

    expect(controller.config()).toEqual({ mailEnabled: false });
  });

  /**
   * The controller owns the shape of the document and nothing else. If it ever grew its own
   * opinion about SMTP — an environment read, a cached copy — the UI could contradict the
   * transport that is actually running, which is the failure mode audit PM-04 describes.
   */
  it('takes the value from the mail module rather than deciding it', () => {
    const { controller, isEnabled } = buildController(false);

    controller.config();

    expect(isEnabled).toHaveBeenCalledTimes(1);
  });

  /**
   * Not memoized: a transport swapped at runtime (`closeMailSender`) has to be visible on the
   * next request, and a second copy of the answer is a second thing that can be stale.
   */
  it('asks again on every request instead of caching the answer', () => {
    const { controller, isEnabled } = buildController(true);
    isEnabled.mockReturnValueOnce(true).mockReturnValueOnce(false);

    expect(controller.config()).toEqual({ mailEnabled: true });
    expect(controller.config()).toEqual({ mailEnabled: false });
  });
});
