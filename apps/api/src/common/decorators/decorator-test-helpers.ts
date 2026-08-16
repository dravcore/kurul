import 'reflect-metadata';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

/**
 * `createParamDecorator` never exposes the function it wraps — applying the decorator only
 * records metadata for Nest's own argument resolver to read at request time, so there is no
 * direct way to call a `CurrentUser()`/`CurrentMembership()` factory from a test. This is the
 * standard extraction Nest's own docs describe for unit-testing a custom param decorator: apply
 * it to a throwaway method, then pull the stored factory back out of `ROUTE_ARGS_METADATA` and
 * invoke it exactly as the framework would at request time.
 */
export function getParamDecoratorFactory<T>(
  decorator: (...args: never[]) => ParameterDecorator,
): (data: unknown, ctx: unknown) => T {
  class TestDecorator {
    public test(@decorator() _value: T): void {
      // Body intentionally empty — this method exists only so `@decorator()` has a parameter
      // to attach metadata to.
    }
  }

  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestDecorator, 'test') as Record<
    string,
    { factory: (data: unknown, ctx: unknown) => T }
  >;
  const key = Object.keys(args)[0]!;
  return args[key]!.factory;
}
