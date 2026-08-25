import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  AttachmentKind,
  PlanLimitCode,
  type InstancePlanLimitsDto,
  type PlanLimitDetail,
  type WorkspacePlanDto,
  type WorkspacePlanLimitsDto,
} from '@kurul/shared-types';
import { Prisma } from '../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { planLimitRefusal } from './plan-limit.exception';
import {
  describeInstancePlanLimits,
  describePlanCeilings,
  parseWorkspacePlanOverride,
  readInstancePlanLimits,
  resolveWorkspacePlanLimits,
  type InstancePlanLimits,
} from './plan-limits';

/** A `PrismaService` or the transaction client of a `$transaction`, for count-then-write callers. */
export type PlanLimitsDb = PrismaService | Prisma.TransactionClient;

/**
 * The single place that answers "is there room for one more" (ADR 0032).
 *
 * Every ceiling in the product is resolved here: seats, boards, workspaces, accounts, and the
 * byte quotas of [ADR 0027](../../../docs/decisions/0027-attachment-quotas.md), which this
 * layer wraps rather than reimplements. One object answers every question, so a caller never
 * has to know whether a number came from a workspace override, from the instance environment,
 * or from nowhere at all.
 *
 * ## What it does not do
 *
 * It does not enforce anything by itself. The `assert*` methods are called by the write paths,
 * as close to the write as the write allows, because a guard or interceptor would have to
 * guess which quantity a request is about and would be silently skipped by the routes Better
 * Auth serves below the Nest router.
 */
@Injectable()
export class PlanLimitsService implements OnModuleInit {
  private readonly logger = new Logger(PlanLimitsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Reads the environment once at boot so a malformed `PLAN_MAX_*` refuses to start, and says
   * in one line what the ceilings are.
   *
   * The refusal is the load-bearing half. Every other read of these variables happens inside a
   * request, where a typo would surface as a 500 on the first create rather than as a line an
   * operator sees while deploying, the same reason `ATTACHMENT_MAX_BYTES` is validated at boot.
   */
  onModuleInit(): void {
    this.logger.log(describePlanCeilings(this.instanceLimits()));
  }

  instanceLimits(): InstancePlanLimits {
    return readInstancePlanLimits();
  }

  /** The instance document `GET /config` publishes: the four counts plus the two byte quotas. */
  instanceCeilings(): InstancePlanLimitsDto {
    return describeInstancePlanLimits(this.instanceLimits(), {
      workspaceQuotaBytes: this.storage.workspaceQuotaBytes,
      instanceQuotaBytes: this.storage.instanceQuotaBytes,
    });
  }

  /**
   * One workspace's resolved ceilings: its `planLimits` override where it has one, the
   * instance's configuration otherwise.
   *
   * Takes an optional client so a caller already inside a transaction resolves the ceiling
   * against the same snapshot as the count it is about to take.
   */
  async forWorkspace(
    workspaceId: string,
    db: PlanLimitsDb = this.prisma,
  ): Promise<WorkspacePlanLimitsDto> {
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { planLimits: true },
    });

    return resolveWorkspacePlanLimits(
      this.instanceLimits(),
      this.storage.workspaceQuotaBytes,
      parseWorkspacePlanOverride(workspace?.planLimits),
    );
  }

  /**
   * The per-workspace attachment ceiling, in the byte-quota spelling `AttachmentService`
   * already speaks (`0` is unlimited).
   *
   * This is how ADR 0027's quota becomes a member of the plan layer without changing its
   * environment variable or its 413: the number is now resolvable per workspace, and
   * everything else about the upload path is untouched.
   */
  async workspaceStorageQuotaBytes(workspaceId: string): Promise<number> {
    const limits = await this.forWorkspace(workspaceId);
    return limits.storageBytes ?? 0;
  }

  /** Resolved ceilings and current usage, for the members and boards screens. */
  async plan(workspaceId: string): Promise<WorkspacePlanDto> {
    const [limits, seats, boards, storageBytes] = await Promise.all([
      this.forWorkspace(workspaceId),
      this.seatsUsed(workspaceId),
      this.prisma.board.count({ where: { workspaceId } }),
      this.storedBytes(workspaceId),
    ]);

    return { limits, usage: { seats, boards, storageBytes } };
  }

  /**
   * Seats in use: members plus invitations still waiting for an answer.
   *
   * **A pending invitation holds its seat.** Counting members alone would make the ceiling
   * advisory (an admin at the limit could send twenty invitations and let them all be
   * accepted), and it would move the refusal from the person who can act on it (the admin
   * inviting) to the person who cannot (the invitee clicking a link they were sent). The same
   * `status: 'pending'` plus unexpired filter as `findPendingInvitations`, so what the settings
   * screen shows as revocable and what this counts can never disagree; an expired invitation
   * frees its seat by the clock, with no sweep required.
   */
  private async seatsUsed(workspaceId: string, db: PlanLimitsDb = this.prisma): Promise<number> {
    const [members, invitations] = await Promise.all([
      db.workspaceMember.count({ where: { workspaceId } }),
      db.workspaceInvitation.count({
        where: { workspaceId, status: 'pending', expiresAt: { gt: new Date() } },
      }),
    ]);
    return members + invitations;
  }

  /** Summed stored bytes of one workspace, counted exactly as the quota check counts them. */
  private async storedBytes(workspaceId: string): Promise<number> {
    const { _sum } = await this.prisma.attachment.aggregate({
      _sum: { size: true },
      where: { kind: AttachmentKind.File, task: { board: { workspaceId } } },
    });
    return _sum.size ?? 0;
  }

  /**
   * Refuses a write that would take a workspace past its seat ceiling.
   *
   * `countsInvitations` is `false` at accept time: the invitation being accepted is already
   * holding a seat, so counting both would refuse the last seat of a workspace that has room
   * for exactly the person walking through the door.
   */
  async assertSeatAvailable(
    workspaceId: string,
    options: { countsInvitations: boolean },
  ): Promise<void> {
    const { seats } = await this.forWorkspace(workspaceId);
    if (seats === null) {
      return;
    }

    const current = options.countsInvitations
      ? await this.seatsUsed(workspaceId)
      : await this.prisma.workspaceMember.count({ where: { workspaceId } });

    if (current >= seats) {
      throw planLimitRefusal(
        PlanLimitCode.Seats,
        seats,
        current,
        'This workspace has no seats left on its plan',
      );
    }
  }

  /**
   * Refuses a board that would take a workspace past its board ceiling.
   *
   * Called with the transaction client from inside the transaction that creates the board, by
   * both routes that create one: `BoardService.create` and `TrelloImportService.importBoard`.
   * The count and the insert are therefore one statement pair against one snapshot. That does
   * not make the ceiling exact (Postgres reads committed, so two concurrent creates can each
   * count `n`), and it is deliberately not hardened further, for ADR 0027's reason: the
   * overshoot is bounded by the number of simultaneous requests, the threat model is unbounded
   * growth, and an advisory lock keyed on the workspace would serialize every board create in a
   * workspace to defend an exactness nothing needs.
   */
  async assertBoardAvailable(workspaceId: string, db: PlanLimitsDb = this.prisma): Promise<void> {
    const { boards } = await this.forWorkspace(workspaceId, db);
    if (boards === null) {
      return;
    }

    const current = await db.board.count({ where: { workspaceId } });
    if (current >= boards) {
      throw planLimitRefusal(
        PlanLimitCode.Boards,
        boards,
        current,
        'This workspace has reached the number of boards its plan allows',
      );
    }
  }

  /** Refuses a workspace that would take the instance past `PLAN_MAX_WORKSPACES`. */
  async assertWorkspaceAvailable(): Promise<void> {
    const limit = this.instanceLimits().workspaces;
    if (limit === null) {
      return;
    }

    const current = await this.prisma.workspace.count();
    if (current >= limit) {
      throw planLimitRefusal(
        PlanLimitCode.Workspaces,
        limit,
        current,
        'This instance has reached the number of workspaces it allows',
      );
    }
  }

  /**
   * The account ceiling, as a value rather than a throw, because its one caller answers from
   * an Express handler mounted below the Nest router where no exception filter is listening.
   *
   * Anonymised accounts are not counted. The row survives an erasure as a tombstone
   * ([ADR 0026](../../../docs/decisions/0026-account-deletion-anonymisation.md)) because
   * content outlives its author, but it holds no credentials and nobody can sign in as it, so
   * charging a seat for it would make the ceiling drift down over the life of an instance with
   * no way for an operator to get it back.
   */
  async signUpRefusal(): Promise<PlanLimitDetail | null> {
    const limit = this.instanceLimits().users;
    if (limit === null) {
      return null;
    }

    const current = await this.prisma.user.count({ where: { deletedAt: null } });
    if (current < limit) {
      return null;
    }

    return { code: PlanLimitCode.Users, limit, current };
  }
}
