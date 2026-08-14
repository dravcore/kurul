import { Injectable } from '@nestjs/common';
import {
  ACTIVATION_WINDOW_DAYS,
  ActivationEvent,
  ActivityType,
  ColumnCategory,
  MemberRole,
  UsagePingKind,
} from '@kurultay/shared-types';
import type {
  ActivationFunnelDto,
  ActivationNorthStarDto,
  ActivationStepDto,
} from '@kurultay/shared-types';
import { Prisma } from '../generated/prisma';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { utcDayStart } from './usage-ping.service';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Distinct actors per activity type, all in one pass over the table. */
interface ActivityActorCounts {
  boardCreated: number;
  taskCreated: number;
  taskMoved: number;
  inviteSent: number;
  inviteAccepted: number;
  taskCompleted: number;
}

interface NorthStarRow {
  teamWorkspaces: number;
  weeklyActiveWorkspaces: number;
  weeklyActiveTeamWorkspaces: number;
}

/**
 * The activation funnel, computed on demand from rows this instance already holds.
 *
 * ## Why there is no event table
 *
 * The obvious implementation of "count eleven events" is eleven `INSERT`s spread across the
 * services that cause them. That was rejected. Nine of the eleven are already implied by rows
 * the product writes for its own reasons — `Activity` has carried `<subject>.<verb>` plus an
 * actor since the feed shipped, and PR #188 added the board/label/member/invitation half of
 * that vocabulary for the audit trail. Deriving is strictly better here for three reasons:
 *
 * 1. **The history is retroactive.** An instance that upgrades into this release sees a funnel
 *    covering everything it has ever done, not a flat line starting at the deploy.
 * 2. **No write path can leak.** A counter that is never written cannot be written with the
 *    wrong payload; the failure PR #188 was corrected for (an e-mail address in an
 *    `invitation.*` payload, readable by every GUEST) is structurally unavailable to a query
 *    that only reads columns the schema already had.
 * 3. **Nothing on the hot path gets slower.** Creating a task stays one transaction.
 *
 * The two exceptions — `dashboard_viewed` and `wau_board_view` — needed `UsagePing`, because
 * `Activity` records changes and reading is not a change. That table's doc comment explains
 * what it stores and what it deliberately does not.
 *
 * ## Distinct people, never events
 *
 * Every count that is about people is `COUNT(DISTINCT "userId")`. A funnel of event totals
 * reads as growth when one enthusiastic user creates forty boards; the question each step
 * answers is "how many people ever got this far", and the answer is bounded by the number of
 * registered accounts, which is what makes step-to-step drop-off mean something.
 *
 * ## Not scoped by workspace, on purpose
 *
 * Every other query in this codebase is scoped by `workspaceId` (CLAUDE.md). These are not,
 * for the same reason `CleanupWorker`'s are not: the questions are about the deployment, and
 * no tenant owns "how many people registered here". The multi-tenant rule protects data a
 * *caller* can reach — so the protection lives on the controller instead, in the one
 * non-workspace authorisation boundary this codebase has (`InstanceAdminGuard`).
 */
@Injectable()
export class ActivationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async funnel(now: Date = new Date()): Promise<ActivationFunnelDto> {
    const since = new Date(now.getTime() - ACTIVATION_WINDOW_DAYS * MS_PER_DAY);
    // `UsagePing.day` is a DATE, so the window's lower bound has to be a day too. Truncating
    // *down* makes the window inclusive of the seventh day rather than clipping it at whatever
    // hour the page happened to be opened.
    const sinceDay = utcDayStart(since);

    const [registeredUsers, workspaceOwners, activity, dashboardViewers, boardViewers, northStar] =
      await Promise.all([
        this.prisma.user.count(),
        this.countWorkspaceOwners(),
        this.countActivityActors(),
        this.countUsagePingUsers(UsagePingKind.DashboardView),
        this.countUsagePingUsers(UsagePingKind.BoardView, sinceDay),
        this.northStar(since, sinceDay),
      ]);

    const users = (event: ActivationStepDto['event'], count: number): ActivationStepDto => ({
      event,
      count,
      unit: 'users',
      window: 'all-time',
    });

    const steps: ActivationStepDto[] = [
      users(ActivationEvent.UserRegistered, registeredUsers),
      users(ActivationEvent.WorkspaceCreated, workspaceOwners),
      users(ActivationEvent.BoardCreated, activity.boardCreated),
      users(ActivationEvent.FirstTaskCreated, activity.taskCreated),
      users(ActivationEvent.FirstDrag, activity.taskMoved),
      users(ActivationEvent.InviteSent, activity.inviteSent),
      {
        // The one step that is not a number of people. It sits here because it is the
        // deployment-level explanation for the drop to `invite_accepted`: with no SMTP
        // transport an invitee cannot verify their address and therefore cannot accept
        // (ADR 0013), so a zero here turns "our invites don't convert" into "our server
        // cannot send mail".
        event: ActivationEvent.SmtpConfigured,
        count: this.mail.isEnabled() ? 1 : 0,
        unit: 'instance',
        window: 'all-time',
      },
      users(ActivationEvent.InviteAccepted, activity.inviteAccepted),
      users(ActivationEvent.DashboardViewed, dashboardViewers),
      users(ActivationEvent.TaskCompleted, activity.taskCompleted),
      {
        // Retention rather than activation, which is why it is last and why it is the only
        // step whose window is not all of history: "has anyone ever opened a board" is
        // answered by every step above it, and the useful question is whether they still do.
        event: ActivationEvent.WauBoardView,
        count: boardViewers,
        unit: 'users',
        window: 'rolling-week',
      },
    ];

    return { generatedAt: now.toISOString(), steps, northStar };
  }

  /**
   * `workspace_created`, read from membership rather than from an activity row.
   *
   * There is deliberately no `workspace.created` in `ActivityType` — every `Activity` row
   * cascades with its workspace, so a row describing the workspace's own creation is a row
   * that only exists while the thing it describes does, which makes it useless as history and
   * confusing as an event. `WorkspaceMember` with role `OWNER` is the durable fact underneath
   * the same question: somebody owns a workspace, therefore somebody made one.
   *
   * It over-counts in one direction and that is the right direction: transferring ownership of
   * a workspace makes two people "have owned a workspace" for this step. A person who has been
   * handed an owner's seat has unambiguously got past the "does this product have a place to
   * put my work" question, which is what the step measures.
   */
  private async countWorkspaceOwners(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(DISTINCT "userId")::int AS "count"
      FROM "WorkspaceMember"
      WHERE "role" = ${MemberRole.OWNER}::"MemberRole"
    `;
    return rows[0]?.count ?? 0;
  }

  /**
   * Six steps, one scan.
   *
   * Six separate `COUNT(DISTINCT …)` statements would each walk the same table with the same
   * predicate shape; `FILTER` lets one pass answer all of them. `Activity` is the largest table
   * on a busy instance and this is an operator screen, so the difference is between a page that
   * loads and a page nobody opens twice.
   *
   * The `LEFT JOIN "Column"` exists only for `task_completed` and mirrors the two-branch rule
   * `DashboardService.countCompletedMovesByDay` documents: a move counts as a completion if the
   * destination column is `COMPLETED` *now*, or was `COMPLETED` at the time according to the
   * payload the move recorded. Branch one repairs history the moment somebody categorises a
   * column; branch two survives the column being deleted. Rows of any other type never match
   * `payload->>'toColumnId'`, so the join adds nothing for them.
   */
  private async countActivityActors(): Promise<ActivityActorCounts> {
    const completed = Prisma.sql`
      a."type" = ${ActivityType.TaskMoved}
      AND (
        c."category" = ${ColumnCategory.COMPLETED}::"ColumnCategory"
        OR a."payload"->>'toColumnCategory' = ${ColumnCategory.COMPLETED}
      )
    `;

    const rows = await this.prisma.$queryRaw<ActivityActorCounts[]>`
      SELECT
        (COUNT(DISTINCT a."userId") FILTER (WHERE a."type" = ${ActivityType.BoardCreated}))::int
          AS "boardCreated",
        (COUNT(DISTINCT a."userId") FILTER (WHERE a."type" = ${ActivityType.TaskCreated}))::int
          AS "taskCreated",
        (COUNT(DISTINCT a."userId") FILTER (WHERE a."type" = ${ActivityType.TaskMoved}))::int
          AS "taskMoved",
        (COUNT(DISTINCT a."userId") FILTER (WHERE a."type" = ${ActivityType.InvitationCreated}))::int
          AS "inviteSent",
        (COUNT(DISTINCT a."userId") FILTER (WHERE a."type" = ${ActivityType.InvitationAccepted}))::int
          AS "inviteAccepted",
        (COUNT(DISTINCT a."userId") FILTER (WHERE ${completed}))::int AS "taskCompleted"
      FROM "Activity" a
      LEFT JOIN "Column" c ON c."id" = a."payload"->>'toColumnId'
    `;

    return (
      rows[0] ?? {
        boardCreated: 0,
        taskCreated: 0,
        taskMoved: 0,
        inviteSent: 0,
        inviteAccepted: 0,
        taskCompleted: 0,
      }
    );
  }

  /** Distinct people who produced this kind of ping, optionally only since `sinceDay`. */
  private async countUsagePingUsers(kind: UsagePingKind, sinceDay?: Date): Promise<number> {
    const window = sinceDay ? Prisma.sql`AND "day" >= ${sinceDay}::date` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(DISTINCT "userId")::int AS "count"
      FROM "UsagePing"
      WHERE "kind" = ${kind}
      ${window}
    `;
    return rows[0]?.count ?? 0;
  }

  /**
   * Weekly Active Team Workspaces, plus the two numbers that stop it being read wrong.
   *
   * "Active" is the union of two traces, and needs to be: `Activity` sees only people who
   * changed something, `UsagePing` sees only people who opened a board or the dashboard. A team
   * that spent the week discussing a board they never edited is active by any honest reading,
   * and shows up in exactly one of those two sources.
   *
   * The union is then **joined back to current membership**. Activity rows outlive the
   * membership that produced them (`member.removed` does not delete history), so without this a
   * workspace whose two contributors both left last month would still count as an active team.
   * The metric has to describe who is there now.
   *
   * `teamWorkspaces` and `weeklyActiveWorkspaces` are returned alongside because the headline
   * number is meaningless on its own: 3 is excellent out of 4 team workspaces and a crisis out
   * of 400, and an instance where every workspace is one person has a ceiling of zero no amount
   * of product work can raise.
   */
  private async northStar(since: Date, sinceDay: Date): Promise<ActivationNorthStarDto> {
    const rows = await this.prisma.$queryRaw<NorthStarRow[]>`
      WITH traces AS (
        SELECT "workspaceId", "userId" FROM "Activity" WHERE "createdAt" >= ${since}
        UNION
        SELECT "workspaceId", "userId" FROM "UsagePing" WHERE "day" >= ${sinceDay}::date
      ),
      active AS (
        SELECT DISTINCT t."workspaceId", t."userId"
        FROM traces t
        INNER JOIN "WorkspaceMember" m
          ON m."workspaceId" = t."workspaceId" AND m."userId" = t."userId"
      ),
      member_counts AS (
        SELECT "workspaceId", COUNT(*)::int AS "members"
        FROM "WorkspaceMember"
        GROUP BY "workspaceId"
      ),
      active_counts AS (
        SELECT "workspaceId", COUNT(*)::int AS "actives"
        FROM active
        GROUP BY "workspaceId"
      )
      SELECT
        (SELECT COUNT(*)::int FROM member_counts WHERE "members" >= 2) AS "teamWorkspaces",
        (SELECT COUNT(*)::int FROM active_counts) AS "weeklyActiveWorkspaces",
        (
          SELECT COUNT(*)::int
          FROM active_counts ac
          INNER JOIN member_counts mc ON mc."workspaceId" = ac."workspaceId"
          WHERE ac."actives" >= 2 AND mc."members" >= 2
        ) AS "weeklyActiveTeamWorkspaces"
    `;

    const row = rows[0];
    return {
      weeklyActiveTeamWorkspaces: row?.weeklyActiveTeamWorkspaces ?? 0,
      weeklyActiveWorkspaces: row?.weeklyActiveWorkspaces ?? 0,
      teamWorkspaces: row?.teamWorkspaces ?? 0,
      windowDays: ACTIVATION_WINDOW_DAYS,
    };
  }
}
