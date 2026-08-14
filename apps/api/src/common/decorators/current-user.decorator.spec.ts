import type { ExecutionContext } from '@nestjs/common';
import { CurrentUser } from './current-user.decorator';
import { getParamDecoratorFactory } from './decorator-test-helpers';
import type { AuthedRequest, AuthenticatedUser } from '../types/request-context';

function mockContext(request: Partial<AuthedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function user(): AuthenticatedUser {
  return {
    id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53',
    email: 'member@example.com',
    name: 'Member',
    avatarUrl: null,
    emailVerified: true,
    createdAt: new Date('2026-01-01'),
  };
}

describe('@CurrentUser', () => {
  const factory = getParamDecoratorFactory<AuthenticatedUser>(CurrentUser);

  it('returns the user SessionAuthGuard resolved onto the request', () => {
    const request = { user: user() };

    expect(factory(undefined, mockContext(request))).toBe(request.user);
  });

  /**
   * Every handler that uses `@CurrentUser()` sits behind `SessionAuthGuard` — but the two are
   * connected only by convention (a decorator applied at a route, a guard applied globally),
   * not by the type system. Throwing instead of returning `undefined` turns a controller wired
   * without the guard into a 500 at request time, which surfaces the missing guard immediately
   * instead of leaking `undefined` into a service that expects an id to scope its query by.
   */
  it('throws instead of handing a controller an undefined user', () => {
    expect(() => factory(undefined, mockContext({}))).toThrow(
      'CurrentUser used without SessionAuthGuard',
    );
  });
});
