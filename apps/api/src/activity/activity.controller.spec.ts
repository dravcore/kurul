import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';

/**
 * Every handler here is a one-line delegation to `ActivityService`, gated entirely by
 * `@WorkspaceScoped()` — there is no branching logic to reach through e2e that a unit test would
 * add value over. What *is* worth locking down at this level is the delegation contract itself:
 * that `listForTask` forwards the URL's `taskId`, not the query's, and that neither handler
 * silently swaps `workspaceId`/`taskId`/`query` order, since a swap here compiles and typechecks
 * cleanly (both are `string`) and would only be caught by an e2e spec that happens to use two
 * different tasks.
 */
describe('ActivityController', () => {
  function buildController() {
    const activityService = {
      listWorkspace: jest.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
      listForTask: jest.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
    };
    return {
      controller: new ActivityController(activityService as unknown as ActivityService),
      activityService,
    };
  }

  const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
  const TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60';

  it('forwards the workspace id and query to listWorkspace', async () => {
    const { controller, activityService } = buildController();
    const query = { limit: 20 };

    await controller.listWorkspace(WORKSPACE_ID, query);

    expect(activityService.listWorkspace).toHaveBeenCalledWith(WORKSPACE_ID, query);
  });

  it('forwards the workspace id, the task id and the query — in that order — to listForTask', async () => {
    const { controller, activityService } = buildController();
    const query = { limit: 20 };

    await controller.listForTask(WORKSPACE_ID, TASK_ID, query);

    expect(activityService.listForTask).toHaveBeenCalledWith(WORKSPACE_ID, TASK_ID, query);
  });
});
