import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { CreatedPersonalAccessTokenDto, PersonalAccessTokenDto } from '@kurul/shared-types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UuidParam } from '../common/decorators/uuid-param.decorator';
import { WorkspaceScoped } from '../common/decorators/workspace-roles.decorator';
import { SessionOnlyGuard } from '../common/guards/session-only.guard';
import type { AuthenticatedUser } from '../common/types/request-context';
import { ErrorEnvelopeSchema } from '../openapi/schemas/error.schema';
import {
  CreatedPersonalAccessTokenSchema,
  PersonalAccessTokenSchema,
} from '../openapi/schemas/token.schema';
import { CreateTokenDto } from './dto/create-token.dto';
import { TokenService } from './token.service';

/**
 * The gate on every token route: workspace membership, then a session.
 *
 * Membership first, so that a token presented against another workspace gets the same `404`
 * every other route answers across the tenant boundary and never the `403` below; session
 * second, because a token must not be able to mint, list or revoke tokens. No role in the
 * chain: a token acts as its owner with whatever role the owner has, so a GUEST minting a
 * token gains exactly nothing a GUEST did not already have.
 */
const TokenRoute = (): MethodDecorator =>
  applyDecorators(
    WorkspaceScoped(),
    UseGuards(SessionOnlyGuard),
    ApiForbiddenResponse({
      description:
        'The request authenticated with a personal access token. Tokens cannot create, list ' +
        'or revoke tokens; these routes take a session cookie only.',
      type: ErrorEnvelopeSchema,
    }),
  );

/** A member's own personal access tokens for one workspace. */
@ApiTags('Tokens')
@Controller('workspaces/:workspaceId/tokens')
export class TokenController {
  constructor(private readonly tokenService: TokenService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a personal access token',
    description:
      'The response is the only place the plaintext `token` ever appears; the server keeps its ' +
      'SHA-256 and cannot show it again. The token acts as the caller, in this workspace only, ' +
      'with whatever role the caller holds at the time of each request. No scopes: the ' +
      'workspace is the scope.',
  })
  @ApiCreatedResponse({ type: CreatedPersonalAccessTokenSchema })
  @TokenRoute()
  create(
    @UuidParam('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTokenDto,
  ): Promise<CreatedPersonalAccessTokenDto> {
    return this.tokenService.create(workspaceId, user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: "List the caller's own tokens",
    description:
      'Only the tokens the caller created, and only the live ones: a revoked token leaves the ' +
      'list. Bounded by one person in one workspace, so a plain array.',
  })
  @ApiOkResponse({ type: [PersonalAccessTokenSchema] })
  @TokenRoute()
  list(
    @UuidParam('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PersonalAccessTokenDto[]> {
    return this.tokenService.listForOwner(workspaceId, user.id);
  }

  @Delete(':tokenId')
  @ApiOperation({
    summary: 'Revoke a token',
    description:
      'Immediate: the next request carrying the token is `401`. Only the owner can revoke, and ' +
      "another member's token is `404`, the same answer as a token that never existed.",
  })
  @ApiNoContentResponse({ description: 'Revoked. Empty body.' })
  @HttpCode(204)
  @TokenRoute()
  async revoke(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('tokenId') tokenId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.tokenService.revoke(workspaceId, user.id, tokenId);
  }
}
