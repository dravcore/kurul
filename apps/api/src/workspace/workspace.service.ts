import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MemberRole } from '@kurultay/shared-types';
import type { WorkspaceDto, WorkspaceMemberDto } from '@kurultay/shared-types';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { auth } from '../auth/auth';
import { betterAuthErrorCode, rethrowBetterAuthError } from '../auth/better-auth-error';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateWorkspaceDto } from './dto/create-workspace.dto';
import type { UpdateWorkspaceDto } from './dto/update-workspace.dto';

/**
 * Hard cap on `listMembers` — the endpoint returns a plain array (no cursor contract), so
 * this bounds worst-case row count for very large workspaces instead of full pagination.
 */
const MAX_MEMBERS = 1000;

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

  async listMembers(workspaceId: string): Promise<WorkspaceMemberDto[]> {
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'asc' },
      take: MAX_MEMBERS,
    });

    return members.map((m) => ({
      id: m.id,
      workspaceId: m.workspaceId,
      userId: m.userId,
      role: m.role as MemberRole,
      name: m.user.name,
      avatarUrl: m.user.avatarUrl,
    }));
  }
}
