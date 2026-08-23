import { ForbiddenException } from '@nestjs/common';
import { PLAN_LIMIT_ERROR, type PlanLimitCode, type PlanLimitDetail } from '@kurul/shared-types';

/**
 * The refusal every plan ceiling answers with (ADR 0032).
 *
 * **403, with its own `error`.** That is the ADR 0027 move, one status along: the quota reused
 * `413` (already taken by the per-file size limit) and told the two apart by the envelope's
 * `error` field, because the status alone cannot say which fix to suggest. Here `403` is
 * already taken by "your role is too low" (`docs/api-conventions.md`), and a ceiling needs the
 * opposite advice: no role change helps, somebody has to free a seat or raise a number. So the
 * status stays the honest one (authenticated, understood, refused) and `PLAN_LIMIT_ERROR`
 * carries the distinction.
 *
 * `402 Payment Required` was the other candidate and is wrong for the code as it stands: this
 * layer ships to self-hosters who have no payment relationship with anybody, and a self-hoster
 * capping their own instance at 20 seats is not being asked for money. When the hosted billing
 * of ADR 0028 lands, a hosted deployment can map this envelope to its own upgrade prompt from
 * `planLimit.code` without the API having to lie about what happened.
 */
export class PlanLimitExceededException extends ForbiddenException {
  constructor(detail: PlanLimitDetail, message: string) {
    super({ message, error: PLAN_LIMIT_ERROR, planLimit: detail });
  }
}

/** Builds the refusal for one ceiling, so the four call sites cannot spell the payload differently. */
export function planLimitRefusal(
  code: PlanLimitCode,
  limit: number,
  current: number,
  message: string,
): PlanLimitExceededException {
  return new PlanLimitExceededException({ code, limit, current }, message);
}
