import { ForbiddenException } from '@nestjs/common';
import { DEMO_MODE_ENV } from './demo-mode';
import { DemoRestrictedGuard } from './demo-restricted.guard';

/**
 * The two routes this guard is attached to are the ones a demo cannot let a stranger take
 * (`DELETE /me`, `DELETE /workspaces/:workspaceId`). What it must never do is refuse them on an
 * ordinary self-hosted install, where account and workspace deletion are the product working.
 */
describe('DemoRestrictedGuard', () => {
  const original = { ...process.env };
  const guard = new DemoRestrictedGuard();

  afterEach(() => {
    process.env = { ...original };
  });

  it('allows the action on an ordinary instance', () => {
    delete process.env[DEMO_MODE_ENV];

    expect(guard.canActivate()).toBe(true);
  });

  it('allows it when demo mode is explicitly off', () => {
    process.env[DEMO_MODE_ENV] = 'false';

    expect(guard.canActivate()).toBe(true);
  });

  /**
   * `403` and not `404`: the deployment already publishes `demo.enabled` on `GET /config`, so
   * there is nothing to hide, and an operator testing their own demo host should be told the
   * route exists and is switched off.
   */
  it('refuses with 403 on a demo instance', () => {
    process.env[DEMO_MODE_ENV] = 'true';

    expect(() => guard.canActivate()).toThrow(ForbiddenException);
    expect(() => guard.canActivate()).toThrow(/disabled on the demo instance/);
  });
});
