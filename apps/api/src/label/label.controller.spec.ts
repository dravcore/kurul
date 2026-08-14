import { LabelController } from './label.controller';
import { LabelService } from './label.service';
import type { AuthenticatedUser } from '../common/types/request-context';

/**
 * Every handler is a one-line delegation to `LabelService`, gated entirely by decorators
 * (`@WorkspaceScoped`/`@WorkspaceRoles`) that carry the actual authorization logic and are
 * covered separately in `common/decorators/workspace-roles.decorator.spec.ts`. What is worth
 * asserting here is that each handler forwards the *right* actor id — `create`/`update`/`remove`
 * all take a `CurrentUser`, and swapping `user.id` for, say, `boardId` compiles cleanly (both are
 * `string`) but would attribute every label mutation to the wrong account in the audit trail.
 */
describe('LabelController', () => {
  function buildController() {
    const labelService = {
      list: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'label-1' }),
      update: jest.fn().mockResolvedValue({ id: 'label-1' }),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    return {
      controller: new LabelController(labelService as unknown as LabelService),
      labelService,
    };
  }

  const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
  const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d55';
  const LABEL_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d5a';
  const user: AuthenticatedUser = {
    id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53',
    email: 'admin@example.com',
    name: 'Admin',
    avatarUrl: null,
    emailVerified: true,
    createdAt: new Date('2026-01-01'),
  };

  it('lists labels for the workspace-scoped board', async () => {
    const { controller, labelService } = buildController();

    await controller.list(WORKSPACE_ID, BOARD_ID);

    expect(labelService.list).toHaveBeenCalledWith(WORKSPACE_ID, BOARD_ID);
  });

  it('attributes a create to the calling user, not the board or workspace id', async () => {
    const { controller, labelService } = buildController();
    const dto = { name: 'Bug', color: 'slot-1' } as never;

    await controller.create(WORKSPACE_ID, BOARD_ID, user, dto);

    expect(labelService.create).toHaveBeenCalledWith(WORKSPACE_ID, BOARD_ID, user.id, dto);
  });

  it('attributes an update to the calling user', async () => {
    const { controller, labelService } = buildController();
    const dto = { name: 'Renamed' } as never;

    await controller.update(WORKSPACE_ID, LABEL_ID, user, dto);

    expect(labelService.update).toHaveBeenCalledWith(WORKSPACE_ID, LABEL_ID, user.id, dto);
  });

  it('attributes a removal to the calling user', async () => {
    const { controller, labelService } = buildController();

    await controller.remove(WORKSPACE_ID, LABEL_ID, user);

    expect(labelService.remove).toHaveBeenCalledWith(WORKSPACE_ID, LABEL_ID, user.id);
  });
});
