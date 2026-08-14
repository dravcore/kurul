/**
 * The activation funnel: eleven questions an operator can ask about their *own* instance.
 *
 * Two properties hold for every name in this file, and both are load-bearing:
 *
 * 1. **Nothing here leaves the instance.** These counts are computed on demand from rows the
 *    database already holds and are returned to one signed-in caller over the same API as
 *    everything else. The only thing this codebase ever sends outbound is
 *    `TelemetryPingPayload` at the bottom of this file, it is off by default, and it carries
 *    none of these numbers. See `docs/decisions/0021-activation-funnel-and-opt-in-telemetry.md`.
 * 2. **Nine of the eleven are derived, not recorded.** They are aggregates over `Activity`,
 *    `User` and `WorkspaceMember` — rows written for product reasons long before anyone
 *    wanted a funnel. Adding a metric must not add a write path, because a write path is a
 *    thing that can leak, drift, or slow down the request that carries it. Only
 *    `dashboard_viewed` and `wau_board_view` needed storage of their own (`UsagePing`), for
 *    the reason given on {@link UsagePingKind}.
 *
 * The strings are an API contract read by `apps/web`, not database values — unlike
 * `ActivityType`, nothing in Postgres stores them, so renaming one breaks a screen rather
 * than orphaning a row.
 */
export const ActivationEvent = {
  /** Somebody has an account. `User` rows; the denominator every later step is read against. */
  UserRegistered: 'user_registered',
  /** …and owns a workspace. `WorkspaceMember` rows with role `OWNER`. */
  WorkspaceCreated: 'workspace_created',
  /** …and made a board of their own. `Activity` `board.created`. */
  BoardCreated: 'board_created',
  /** …and put a card on it. `Activity` `task.created`. */
  FirstTaskCreated: 'first_task_created',
  /** …and moved one, which is the first moment the tool behaves like a board. `task.moved`. */
  FirstDrag: 'first_drag',
  /** …and asked somebody to join. `Activity` `invitation.created`. */
  InviteSent: 'invite_sent',
  /** …and somebody accepted. `Activity` `invitation.accepted`, whose actor is the invitee. */
  InviteAccepted: 'invite_accepted',
  /**
   * Outbound email works here. Instance-wide, not per person — and the reason it sits inside
   * a funnel about people is that without it `invite_accepted` is *unreachable*: an invitee
   * cannot verify their address, so the drop between the two steps above is caused by the
   * deployment rather than by the product (ADR 0013).
   */
  SmtpConfigured: 'smtp_configured',
  /** …and opened the dashboard, the one screen that is only worth opening after real use. */
  DashboardViewed: 'dashboard_viewed',
  /** …and looked at a board in the last {@link ACTIVATION_WINDOW_DAYS} days. Retention, not activation. */
  WauBoardView: 'wau_board_view',
  /** …and finished something: `task.moved` into a `COMPLETED` column. */
  TaskCompleted: 'task_completed',
} as const;

export type ActivationEvent = (typeof ActivationEvent)[keyof typeof ActivationEvent];

/**
 * Funnel order — the order the screen renders, and the order the drop-offs mean something in.
 *
 * `smtp_configured` is placed between "an invite was sent" and "an invite was accepted"
 * because that is exactly where it explains a drop; it is the one step whose count is not a
 * number of people, so a reader must never subtract across it. {@link ActivationStepDto.unit}
 * is what says so in the payload.
 */
export const ACTIVATION_EVENTS = [
  ActivationEvent.UserRegistered,
  ActivationEvent.WorkspaceCreated,
  ActivationEvent.BoardCreated,
  ActivationEvent.FirstTaskCreated,
  ActivationEvent.FirstDrag,
  ActivationEvent.InviteSent,
  ActivationEvent.SmtpConfigured,
  ActivationEvent.InviteAccepted,
  ActivationEvent.DashboardViewed,
  ActivationEvent.TaskCompleted,
  ActivationEvent.WauBoardView,
] as const;

/**
 * The rolling window for anything labelled "weekly" — the WAU step and the North Star.
 *
 * Seven days rather than a calendar week: a calendar week makes Monday morning look like a
 * collapse and Sunday night like a record, and an operator reading their own instance has no
 * cohort large enough for that noise to average out.
 */
export const ACTIVATION_WINDOW_DAYS = 7;

/**
 * What a step's `count` is counting. A funnel that mixes units and does not say so is worse
 * than no funnel: it invites a subtraction that produces a number meaning nothing.
 *
 * - `users` — distinct people who have ever done this (or, for `wau_board_view`, who did it
 *   inside the window). Distinct *people*, not events: a user who created forty boards is one.
 * - `instance` — `1` or `0`, a property of the deployment rather than of anybody in it.
 */
export type ActivationUnit = 'users' | 'instance';

/** Whether a step counts all of history or only the last {@link ACTIVATION_WINDOW_DAYS} days. */
export type ActivationWindow = 'all-time' | 'rolling-week';

export interface ActivationStepDto {
  event: ActivationEvent;
  count: number;
  unit: ActivationUnit;
  window: ActivationWindow;
}

/**
 * Weekly Active *Team* Workspaces — the North Star.
 *
 * "Team", not "workspace", is the whole of it. A workspace one person opens every day is a
 * to-do list, and Kurultay does not need to exist for that; a workspace where two or more
 * members were active in the same week is the thing the product claims to be for. The metric
 * is therefore deliberately harder to move than any of the funnel steps, and it is the only
 * number here that a growth in registrations cannot inflate on its own.
 *
 * "Active" means *left a trace*: an `Activity` row, or a `UsagePing` — which is why the ping
 * table exists at all. A team that spends the week reading the board and moving nothing is
 * active by any honest definition, and writes no `Activity`.
 */
export interface ActivationNorthStarDto {
  /** Workspaces with ≥2 members where ≥2 distinct members were active inside the window. */
  weeklyActiveTeamWorkspaces: number;
  /** Context for the number above: workspaces where *anybody* was active inside the window. */
  weeklyActiveWorkspaces: number;
  /** Context again: workspaces that have ≥2 members at all, active or not — the ceiling. */
  teamWorkspaces: number;
  windowDays: number;
}

export interface ActivationFunnelDto {
  /**
   * When these numbers were computed. Nothing is cached, so this is "now" — it is in the
   * payload so a screenshot pasted into an issue says which day it describes.
   */
  generatedAt: string;
  steps: ActivationStepDto[];
  northStar: ActivationNorthStarDto;
}

/**
 * The two things a user can *look at* that leave no other trace.
 *
 * Everything else in the funnel is derived from `Activity`, which only records writes. A team
 * that reads its board every morning and moves nothing writes nothing — so measuring
 * retention from `Activity` alone would report the quietest healthy instances as dead. These
 * two kinds are the minimum needed to close that gap, and each one is deduplicated to a
 * single row per user, per workspace, per UTC day: the question is "did they show up", never
 * "how many times", and storing the latter would be a browsing history nobody asked for.
 */
export const UsagePingKind = {
  BoardView: 'board_view',
  DashboardView: 'dashboard_view',
} as const;

export type UsagePingKind = (typeof UsagePingKind)[keyof typeof UsagePingKind];

/**
 * The complete outbound payload — every field, no exceptions, off unless the operator turned
 * it on (`TELEMETRY_ENABLED`, default `false`) *and* named a collector (`TELEMETRY_ENDPOINT`,
 * no default).
 *
 * This interface is the specification, not a convenience type: `docs/development.md` lists
 * these fields line by line, and the promise made there is that this is all of it. There is
 * no instance identifier on purpose — an id would let a collector count *installs* instead of
 * *starts*, which is more useful and is also a pseudonymous identifier for a deployment we
 * promised to leave anonymous. ADR 0021 records that trade and why the less useful side won.
 */
export interface TelemetryPingPayload {
  /** Always `instance_started`. A field rather than a constant so a collector can route on it. */
  event: 'instance_started';
  /** The `@kurultay/api` package version this process was built from, e.g. `0.1.0`. */
  version: string;
}
