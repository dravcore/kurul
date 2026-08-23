import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ActivityType } from '@kurul/shared-types';
import type { CreatedPersonalAccessTokenDto, PersonalAccessTokenDto } from '@kurul/shared-types';
import { ActivityService } from '../activity/activity.service';
import type { AuthenticatedUser } from '../common/types/request-context';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateTokenDto } from './dto/create-token.dto';
import { hashToken, mintToken } from './personal-access-token';

/**
 * How often `lastUsedAt` is rewritten for a token in steady use.
 *
 * A script polling a board every few seconds would otherwise turn each read into a write on
 * the token row. The column answers "is this token still in use, and roughly since when",
 * and a minute's granularity answers that as well as a millisecond's does.
 */
export const LAST_USED_WRITE_INTERVAL_MS = 60_000;

type TokenRow = {
  id: string;
  workspaceId: string;
  userId: string;
  name: string;
  prefix: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
};

const TOKEN_SELECT = {
  id: true,
  workspaceId: true,
  userId: true,
  name: true,
  prefix: true,
  lastUsedAt: true,
  expiresAt: true,
  createdAt: true,
} as const;

/** What `SessionAuthGuard` needs from a valid token: who it acts as, and where. */
export interface ResolvedToken {
  id: string;
  workspaceId: string;
  user: AuthenticatedUser;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: ActivityService,
  ) {}

  private toDto(row: TokenRow): PersonalAccessTokenDto {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      userId: row.userId,
      name: row.name,
      prefix: row.prefix,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Mints a token for the caller in this workspace. The plaintext is in the return value and
   * nowhere else: the row holds its hash, and the activity entry holds its display prefix.
   */
  async create(
    workspaceId: string,
    userId: string,
    dto: CreateTokenDto,
    now: Date = new Date(),
  ): Promise<CreatedPersonalAccessTokenDto> {
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= now.getTime()) {
      throw new BadRequestException('expiresAt must be in the future');
    }

    const minted = mintToken();
    const row = await this.prisma.personalAccessToken.create({
      data: {
        workspaceId,
        userId,
        name: dto.name.trim(),
        prefix: minted.prefix,
        tokenHash: minted.hash,
        expiresAt,
      },
      select: TOKEN_SELECT,
    });

    await this.activityService.record(this.prisma, {
      workspaceId,
      userId,
      type: ActivityType.TokenCreated,
      payload: {
        tokenId: row.id,
        name: row.name,
        prefix: row.prefix,
        expiresAt: row.expiresAt?.toISOString() ?? null,
      },
    });

    return { ...this.toDto(row), token: minted.plaintext };
  }

  /** The caller's own live tokens in this workspace, newest first. Revoked rows are not listed. */
  async listForOwner(workspaceId: string, userId: string): Promise<PersonalAccessTokenDto[]> {
    const rows = await this.prisma.personalAccessToken.findMany({
      where: { workspaceId, userId, revokedAt: null },
      select: TOKEN_SELECT,
      orderBy: { id: 'desc' },
    });
    return rows.map((row) => this.toDto(row));
  }

  /**
   * Revokes one of the caller's own tokens. A token that belongs to somebody else, to another
   * workspace, or that is already revoked is `404`: the list never showed it, so there is
   * nothing to confirm by answering differently.
   */
  async revoke(workspaceId: string, userId: string, tokenId: string): Promise<void> {
    const now = new Date();
    const result = await this.prisma.personalAccessToken.updateMany({
      where: { id: tokenId, workspaceId, userId, revokedAt: null },
      data: { revokedAt: now },
    });
    if (result.count === 0) {
      throw new NotFoundException('Token not found');
    }

    const row = await this.prisma.personalAccessToken.findUniqueOrThrow({
      where: { id: tokenId },
      select: { name: true, prefix: true },
    });

    await this.activityService.record(this.prisma, {
      workspaceId,
      userId,
      type: ActivityType.TokenRevoked,
      payload: { tokenId, name: row.name, prefix: row.prefix },
    });
  }

  /**
   * Revokes every live token a user holds in one workspace. Called when the membership that
   * made those tokens meaningful ends, so that a member who is removed and later re-added does
   * not find their old credentials working again.
   */
  async revokeAllForMember(workspaceId: string, userId: string, now: Date = new Date()) {
    return this.prisma.personalAccessToken.updateMany({
      where: { workspaceId, userId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  /**
   * Resolves a presented plaintext to the user and workspace it acts as, or `null`.
   *
   * One answer for "unknown", "revoked" and "expired": the caller gets a `401` in every case,
   * and distinguishing them would tell whoever holds a stolen token whether it was ever real.
   * The owning account must still be live as well; an anonymised user has no tokens left in
   * practice, but the check costs nothing and the rule is worth stating.
   */
  async resolve(plaintext: string, now: Date = new Date()): Promise<ResolvedToken | null> {
    const row = await this.prisma.personalAccessToken.findUnique({
      where: { tokenHash: hashToken(plaintext) },
      select: {
        id: true,
        workspaceId: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
            emailVerified: true,
            createdAt: true,
            deletedAt: true,
          },
        },
      },
    });

    if (!row || row.revokedAt || row.user.deletedAt) return null;
    if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return null;

    if (
      row.lastUsedAt === null ||
      now.getTime() - row.lastUsedAt.getTime() >= LAST_USED_WRITE_INTERVAL_MS
    ) {
      // Fire-and-forget would be the cheaper shape, but an unawaited write racing the response
      // has no owner to report its failure to; the cost of awaiting one small update a minute
      // per token is nothing.
      await this.prisma.personalAccessToken.update({
        where: { id: row.id },
        data: { lastUsedAt: now },
        select: { id: true },
      });
    }

    return {
      id: row.id,
      workspaceId: row.workspaceId,
      user: {
        id: row.user.id,
        email: row.user.email,
        name: row.user.name,
        avatarUrl: row.user.avatarUrl,
        emailVerified: row.user.emailVerified,
        createdAt: row.user.createdAt,
      },
    };
  }
}
