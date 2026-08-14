import 'reflect-metadata';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { ParseUuidV7Pipe } from '../pipes/parse-uuid-v7.pipe';
import { UuidParam } from './uuid-param.decorator';

/**
 * `UuidParam` is a thin `Param(property, ParseUuidV7Pipe)` wrapper, but the pipe binding is the
 * entire point of it existing separately from `@Param()` — every controller in the app reaches
 * for `@UuidParam` specifically so a raw path segment can never skip `ParseUuidV7Pipe` on its
 * way to a Prisma `where`. Reading the metadata Nest actually stores confirms the binding
 * survived, rather than merely asserting the decorator runs without throwing.
 */
describe('UuidParam', () => {
  it('binds the property name and ParseUuidV7Pipe the way @Param would', () => {
    class TestController {
      get(@UuidParam('workspaceId') _workspaceId: string): void {
        // Body intentionally empty — only the parameter's metadata is under test.
      }
    }

    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestController, 'get') as Record<
      string,
      { data?: string; pipes: unknown[] }
    >;
    const [entry] = Object.values(args);

    expect(entry?.data).toBe('workspaceId');
    expect(entry?.pipes).toEqual([ParseUuidV7Pipe]);
  });

  it('scopes each call to its own property name', () => {
    class TestController {
      get(
        @UuidParam('workspaceId') _workspaceId: string,
        @UuidParam('taskId') _taskId: string,
      ): void {
        // Body intentionally empty.
      }
    }

    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestController, 'get') as Record<
      string,
      { data?: string }
    >;
    const names = Object.values(args).map((entry) => entry.data);

    expect(names.sort()).toEqual(['taskId', 'workspaceId']);
  });
});
