import type {
  CursorPage,
  InvitationDto,
  InvitationStatus,
  Locale,
  MailDeliveryStatus,
  MemberRole,
  UserDto,
  WorkspaceDto,
  WorkspaceMemberDto,
  WorkspacePlanDto,
  WorkspacePlanLimitsDto,
  WorkspacePlanUsageDto,
} from '@kurul/shared-types';

/** The caller's own account. */
export class UserSchema implements UserDto {
  id!: string;
  email!: string;
  name!: string;
  avatarUrl!: string | null;
  /**
   * Chosen interface language as an IETF tag, or `null` for "never chose".
   *
   * `null` is a distinct state from `"en"`: an unset user follows their browser's
   * `Accept-Language`.
   */
  locale!: Locale | null;
  /**
   * Whether assignment, mention and due-soon notifications are also sent by email. One switch
   * for every kind. Has no effect while `InstanceConfigDto.mailEnabled` is `false`.
   */
  emailNotifications!: boolean;
  /** ISO 8601 UTC. */
  createdAt!: string;
}

/** A workspace — the tenant root every resource-bearing route hangs off. */
export class WorkspaceSchema implements WorkspaceDto {
  id!: string;
  name!: string;
  /** Lowercase alphanumeric with optional hyphens. Unique across the instance. */
  slug!: string;
  createdAt!: string;
}

/** One person's membership of one workspace. */
export class WorkspaceMemberSchema implements WorkspaceMemberDto {
  id!: string;
  workspaceId!: string;
  userId!: string;
  role!: MemberRole;
  name!: string;
  avatarUrl!: string | null;
}

/** A pending or resolved invitation to a workspace. */
export class InvitationSchema implements InvitationDto {
  id!: string;
  workspaceId!: string;
  email!: string;
  role!: MemberRole;
  status!: InvitationStatus;
  expiresAt!: string;
  /** Computed convenience URL for the client. Not a stored column. */
  acceptUrl!: string;
  /**
   * What became of the invitation email — on `POST .../invitations` and nowhere else.
   *
   * **Absent is not `SENT`.** It means this API observed no send for the request. A listed
   * invitation is a stored row while delivery is an event nothing records, so
   * `GET .../invitations` never carries the field.
   */
  emailDelivery?: MailDeliveryStatus;
}

/** One page of the workspace roster. */
export class WorkspaceMemberPageSchema implements CursorPage<WorkspaceMemberDto> {
  items!: WorkspaceMemberSchema[];
  /** Pass as `?cursor=` to fetch the next page. `null` on the last page. */
  nextCursor!: string | null;
  hasMore!: boolean;
}

/** One page of pending invitations. */
export class InvitationPageSchema implements CursorPage<InvitationDto> {
  items!: InvitationSchema[];
  nextCursor!: string | null;
  hasMore!: boolean;
}

/** One workspace's resolved ceilings. `null` is unlimited (ADR 0032). */
export class WorkspacePlanLimitsSchema implements WorkspacePlanLimitsDto {
  /** Members plus pending invitations this workspace may hold. */
  seats!: number | null;
  boards!: number | null;
  /** Summed stored-file bytes this workspace may hold. */
  storageBytes!: number | null;
}

/** What the workspace currently holds, counted the way the refusals count it. */
export class WorkspacePlanUsageSchema implements WorkspacePlanUsageDto {
  /** Members plus invitations still pending: an invitation holds its seat until it expires. */
  seats!: number;
  boards!: number;
  /** Stored bytes. LINK attachments carry none. */
  storageBytes!: number;
}

/**
 * The ceilings that apply to this workspace and how much of each is in use.
 *
 * "Resolved" means the workspace's own override where it has one and the instance's
 * configuration otherwise, so a client never has to know which of the two answered.
 */
export class WorkspacePlanSchema implements WorkspacePlanDto {
  limits!: WorkspacePlanLimitsSchema;
  usage!: WorkspacePlanUsageSchema;
}
