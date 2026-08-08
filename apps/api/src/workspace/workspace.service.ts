import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MemberRole } from '@kurultay/shared-types';
import type {
  InvitationDto,
  WorkspaceDto,
  WorkspaceMemberDto,
} from '@kurultay/shared-types';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { auth } from '../auth/auth';
import { PrismaService } from '../prisma/prisma.service';
import { envString } from '../common/env';
import type { CreateInvitationDto } from './dto/create-invitation.dto';
import type { CreateWorkspaceDto } from './dto/create-workspace.dto';
import type { UpdateWorkspaceDto } from './dto/update-workspace.dto';

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
      if (error instanceof ConflictException || error instanceof BadRequestException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Failed to create workspace';
      if (/slug|unique|already/i.test(message)) {
        throw new ConflictException('Workspace slug already taken');
      }
      throw new BadRequestException(message);
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
      if (error instanceof ConflictException || error instanceof NotFoundException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Failed to update workspace';
      throw new BadRequestException(message);
    }
  }

  async remove(workspaceId: string, request: Request): Promise<void> {
    try {
      await auth.api.deleteOrganization({
        body: { organizationId: workspaceId },
        headers: this.headersFrom(request),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete workspace';
      throw new BadRequestException(message);
    }
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMemberDto[]> {
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });

    return members.map((m) => ({
      id: m.id,
      workspaceId: m.workspaceId,
      userId: m.userId,
      role: m.role as MemberRole,
    }));
  }

  async createInvitation(
    workspaceId: string,
    dto: CreateInvitationDto,
    request: Request,
  ): Promise<InvitationDto> {
    if (dto.role === MemberRole.OWNER) {
      throw new BadRequestException('Cannot invite someone as OWNER');
    }

    try {
      const invitation = await auth.api.createInvitation({
        body: {
          email: dto.email,
          role: dto.role,
          organizationId: workspaceId,
          resend: true,
        },
        headers: this.headersFrom(request),
      });

      if (!invitation?.id || !invitation.email || !invitation.status || !invitation.expiresAt) {
        throw new BadRequestException('Failed to create invitation');
      }

      const webUrl = envString('WEB_URL', 'http://localhost:3000');
      const role = (invitation.role as MemberRole | undefined) ?? dto.role;
      return {
        id: invitation.id,
        workspaceId,
        email: invitation.email,
        role,
        status: invitation.status,
        expiresAt: new Date(invitation.expiresAt).toISOString(),
        acceptUrl: `${webUrl}/invite/${invitation.id}`,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Failed to create invitation';
      throw new BadRequestException(message);
    }
  }

  async revokeInvitation(
    workspaceId: string,
    invitationId: string,
    request: Request,
  ): Promise<void> {
    const invitation = await this.prisma.workspaceInvitation.findFirst({
      where: { id: invitationId, workspaceId },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    try {
      await auth.api.cancelInvitation({
        body: { invitationId },
        headers: this.headersFrom(request),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to revoke invitation';
      throw new BadRequestException(message);
    }
  }

  async acceptInvitation(
    workspaceId: string,
    invitationId: string,
    request: Request,
  ): Promise<WorkspaceMemberDto> {
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { id: invitationId },
    });
    if (!invitation || invitation.status !== 'pending' || invitation.workspaceId !== workspaceId) {
      throw new NotFoundException('Invitation not found');
    }

    try {
      const result = await auth.api.acceptInvitation({
        body: { invitationId },
        headers: this.headersFrom(request),
      });

      const member = result?.member;
      if (!member) {
        throw new BadRequestException('Failed to accept invitation');
      }

      const memberWorkspaceId =
        'organizationId' in member && typeof member.organizationId === 'string'
          ? member.organizationId
          : workspaceId;

      return {
        id: member.id,
        workspaceId: memberWorkspaceId,
        userId: member.userId,
        role: member.role as MemberRole,
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Failed to accept invitation';
      throw new BadRequestException(message);
    }
  }
}
