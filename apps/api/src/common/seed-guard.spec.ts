import { assertSeedAllowed } from './seed-guard';

describe('assertSeedAllowed', () => {
  it.each(['production', 'Production', 'PRODUCTION', ' production '])(
    'throws when NODE_ENV is %j',
    (value) => {
      expect(() => assertSeedAllowed(value)).toThrow('Refusing to seed');
    },
  );

  it.each([undefined, '', 'development', 'test', 'staging'])('allows NODE_ENV %j', (value) => {
    expect(() => assertSeedAllowed(value)).not.toThrow();
  });
});
