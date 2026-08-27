import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { InstanceConfigDto } from '@kurul/shared-types';
import { InstanceConfigSchema } from '../openapi/schemas/instance.schema';
import { signUpEnabled } from '../auth/sign-up-policy';
import { demoConfig } from '../demo/demo-mode';
import { MailService } from '../mail/mail.service';
import { PlanLimitsService } from '../plan/plan-limits.service';
import { StorageService } from '../storage/storage.service';

/**
 * What this deployment is configured to do, for a client that cannot read its environment.
 *
 * ## Why not `/health`
 *
 * `mailEnabled` was very nearly a field on the liveness document, and it should not be. Three
 * reasons, in order of how much they would cost later:
 *
 * 1. **`/health` answers a different question, for a different reader.** It exists so an
 *    orchestrator can decide whether to restart this container; `HealthController.check` is
 *    documented as static and dependency-free precisely so that verdict stays about the
 *    process. "Is SMTP configured" is never a reason to restart anything — it is a permanent,
 *    intentional property of the deployment. Mixing the two makes the probe document grow a
 *    section no probe reads, and invites the next flag to be added there too.
 * 2. **`/health` is unauthenticated *and* unthrottled.** `@SkipRateLimit()` covers that whole
 *    controller, correctly: a throttled probe reports a healthy API as sick. That exemption is
 *    affordable only because the document says nothing about the product. Publishing
 *    deployment configuration on an endpoint with neither a session check nor a rate limit is
 *    a decision worth making on purpose, not one worth inheriting from a probe.
 * 3. **This surface is meant to grow.** The next "is this switched on here" flag belongs
 *    beside `mailEnabled`, and a capability document can gain fields without renegotiating
 *    what a healthcheck means.
 *
 * ## Why it requires a session
 *
 * The absence of `@Public()` is the decision, not an omission — `SessionAuthGuard` is global,
 * so this endpoint is behind sign-in by default and staying there was a choice. The leak is
 * genuinely small ("this server can send email" is close to public, and the README already
 * tells every reader that an unconfigured deployment cannot accept invitations), but small is
 * not zero and nothing needs it to be public: the only consumer is the members screen in
 * `apps/web`, which is behind sign-in anyway. Opting out would buy nothing and would hand an
 * unauthenticated scanner a per-instance list of which capabilities a self-hosted install has
 * left unconfigured. The moment a signed-out screen needs a flag from here, that is a
 * deliberate change to this comment and not an oversight.
 *
 * `signUpEnabled` is the first field a signed-out screen could want, and it does not cross that
 * line: the register page learns the answer from the `403` its own submit receives
 * (`error: "Sign-up Disabled"`, written at the Better Auth mount), which is the one refusal a
 * signed-out client is entitled to. The field here is for the signed-in surfaces that ask
 * before offering something, such as a members screen deciding whether "invite a teammate
 * who has no account yet" is a sentence that can come true on this instance.
 *
 * There is no role gate either, and no `:workspaceId`: nothing in the document varies by
 * tenant, so the workspace scoping rule in `docs/api-conventions.md` does not apply.
 *
 * Rate limiting is the global default on purpose: this is an ordinary client endpoint, and
 * unlike `/health` there is no probe whose verdict a `429` would corrupt.
 */
@ApiTags('Instance')
@Controller('config')
export class InstanceConfigController {
  constructor(
    private readonly mail: MailService,
    private readonly storage: StorageService,
    private readonly planLimits: PlanLimitsService,
  ) {}

  /**
   * Not cached and not memoized. The document is two booleans' worth of work — `mailEnabled`
   * reads a field off a transport that is built once per process, and `attachmentsEnabled`
   * reads the capability bit off a storage backend built the same way — and a cache would only
   * add a second copy of the truth that can disagree with the transport actually in use.
   *
   * `demo` is the one field that is not constant for the life of the process: `nextResetAt`
   * moves to the following boundary every interval. That is another reason not to memoize:
   * a cached document would pin the banner's countdown to whenever the first caller asked.
   */
  @ApiOperation({
    summary: 'Read what this deployment is configured to do',
    description:
      'Capability, never tenant state \u2014 nothing here varies by workspace, role or caller, ' +
      'which is why it carries no `{workspaceId}` and no role gate. It does require a session: ' +
      'the leak is small, but an unauthenticated version would hand a scanner a per-instance ' +
      'list of what a self-hosted install has left unconfigured, and nothing needs it public.',
  })
  @ApiOkResponse({ type: InstanceConfigSchema })
  @Get()
  config(): InstanceConfigDto {
    return {
      mailEnabled: this.mail.isEnabled(),
      attachmentsEnabled: this.storage.persistsFiles,
      // Read from the environment on every call, like `demo`: the same function the Better
      // Auth mount consults, so the document and the refusal cannot disagree.
      signUpEnabled: signUpEnabled(),
      demo: demoConfig(),
      // Instance ceilings only. A workspace's own resolved numbers, and what it is using, are
      // tenant state and are served from `GET /workspaces/{workspaceId}/plan` (ADR 0032).
      // This document is the same for every caller by definition.
      planLimits: this.planLimits.instanceCeilings(),
    };
  }
}
