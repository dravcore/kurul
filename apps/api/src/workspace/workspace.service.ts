import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CursorPage, WorkspaceDto, WorkspaceMemberDto } from '@kurultay/shared-types';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { auth } from '../auth/auth';
import { betterAuthErrorCode, rethrowBetterAuthError } from '../auth/better-auth-error';
import { toCursorPage } from '../common/pagination/cursor-page';
import { MAX_PAGE_LIMIT } from '../common/pagination/page-limit';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateWorkspaceDto } from './dto/create-workspace.dto';
import type { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import type { WorkspaceMemberQueryDto } from './dto/workspace-member-query.dto';
import { memberInclude, toMemberDto } from './workspace-member.mapper';

/**
 * The Better Auth organization codes that mean "this slug is already in use".
 *
 * The plugin does not use one code for both routes: `/organization/create` reports
 * `ORGANIZATION_ALREADY_EXISTS`, while `/organization/update` reports
 * `ORGANIZATION_SLUG_ALREADY_TAKEN` (a uniqueness check the route only grew in
 * better-auth 1.6). Both are the same uniqueness violation to us, and
 * `docs/api-conventions.md` answers that with a `409`, so both are matched here.
 */
const SLUG_CONFLICT_CODES = new Set([
  'ORGANIZATION_ALREADY_EXISTS',
  'ORGANIZATION_SLUG_ALREADY_TAKEN',
]);

/** True when the failure is Better Auth reporting a slug uniqueness violation. */
function isSlugConflict(error: unknown): boolean {
  const code = betterAuthErrorCode(error);
  return code !== undefined && SLUG_CONFLICT_CODES.has(code);
}

@Injectable()
export class WorkspaceService {
  constructor(private readonly prisma: PrismaService) {}

  private headersFrom(request: Request): Headers {
    return fromNodeHeaders(request.headers);
  }

  private toWorkspaceDto(row: {
    id: string;
    name: string;
    slug: string;
    createdAt: Date;
  }): WorkspaceDto {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listForUser(userId: string): Promise<WorkspaceDto[]> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((m) => this.toWorkspaceDto(m.workspace));
  }

  async create(_userId: string, dto: CreateWorkspaceDto, request: Request): Promise<WorkspaceDto> {
    const existing = await this.prisma.workspace.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) {
      throw new ConflictException('Workspace slug already taken');
    }

    try {
      const created = await auth.api.createOrganization({
        body: {
          name: dto.name,
          slug: dto.slug,
          keepCurrentActiveOrganization: false,
        },
        headers: this.headersFrom(request),
      });

      if (!created) {
        throw new BadRequestException('Failed to create workspace');
      }

      return this.toWorkspaceDto({
        id: created.id,
        name: created.name,
        slug: created.slug,
        createdAt: new Date(created.createdAt),
      });
    } catch (error) {
      // The Prisma pre-check above catches the ordinary case; this covers the race where
      // the slug is taken between that read and the write. Better Auth reports it as a
      // `400`, but `docs/api-conventions.md` makes a uniqueness violation a `409`.
      if (isSlugConflict(error)) {
        throw new ConflictException('Workspace slug already taken');
      }
      rethrowBetterAuthError(error, 'Failed to create workspace');
    }
  }

  async getById(workspaceId: string): Promise<WorkspaceDto> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }
    return this.toWorkspaceDto(workspace);
  }

  async update(
    workspaceId: string,
    dto: UpdateWorkspaceDto,
    request: Request,
  ): Promise<WorkspaceDto> {
    if (dto.slug !== undefined) {
      const clash = await this.prisma.workspace.findFirst({
        where: { slug: dto.slug, NOT: { id: workspaceId } },
      });
      if (clash) {
        throw new ConflictException('Workspace slug already taken');
      }
    }

    try {
      const updated = await auth.api.updateOrganization({
        body: {
          organizationId: workspaceId,
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
          },
        },
        headers: this.headersFrom(request),
      });

      if (!updated) {
        throw new NotFoundException('Workspace not found');
      }

      return this.toWorkspaceDto({
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        createdAt: new Date(updated.createdAt),
      });
    } catch (error) {
      if (isSlugConflict(error)) {
        throw new ConflictException('Workspace slug already taken');
      }
      rethrowBetterAuthError(error, 'Failed to update workspace', {
        404: 'Workspace not found',
      });
    }
  }

  async remove(workspaceId: string, request: Request): Promise<void> {
    try {
      await auth.api.deleteOrganization({
        body: { organizationId: workspaceId },
        headers: this.headersFrom(request),
      });
    } catch (error) {
      rethrowBetterAuthError(error, 'Failed to delete workspace', {
        404: 'Workspace not found',
      });
    }
  }

  /**
   * One cursor page of the workspace roster.
   *
   * This used to be a plain array behind `take: 1000`, which meant the 1001st member simply
   * did not exist as far as any client could tell. Paging by `id` (UUIDv7, so ascending id
   * is ascending join time — the order the array had) makes the remainder reachable instead
   * of invisible: the response says `hasMore`, and the caller decides what to do about it.
   */
  async listMembers(
    workspaceId: string,
    query: WorkspaceMemberQueryDto,
  ): Promise<CursorPage<WorkspaceMemberDto>> {
    const limit = query.limit ?? MAX_PAGE_LIMIT;

    const rows = await this.prisma.workspaceMember.findMany({
      where: {
        workspaceId,
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
      },
      include: memberInclude,
      orderBy: { id: 'asc' },
      take: limit + 1,
    });

    return toCursorPage(rows, limit, toMemberDto);
  }

  /**
   * The caller's own membership.
   *
   * The shell only ever wanted the signed-in user's role, and paying for the whole roster to
   * run `.find()` over it is exactly what made the truncation above load-bearing. This is the
   * single indexed row that question actually needs.
   */
  async getMembership(workspaceId: string, userId: string): Promise<WorkspaceMemberDto> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      include: memberInclude,
    });

    if (!member) {
      throw new NotFoundException('Workspace member not found');
    }

    return toMemberDto(member);
  }
}
