import { assertDemoResetAllowed, databaseNameOf } from './reset-guard';

const DEMO_URL = 'postgresql://kurul:secret@postgres:5432/kurul_demo';

/**
 * The guard in front of a script that deletes every row in the database and ships inside the
 * production image. Both of its checks have to hold, and neither is allowed to be satisfiable
 * by accident, so each one is tested on its own with the other one already passing.
 */
describe('assertDemoResetAllowed', () => {
  describe('DEMO_MODE', () => {
    it.each(['true', '1', 'yes', 'on', 'TRUE', ' true '])('allows %s', (demoMode) => {
      expect(assertDemoResetAllowed({ demoMode, databaseUrl: DEMO_URL })).toBe('kurul_demo');
    });

    it('refuses when it is unset, which is every deployment that did not ask for this', () => {
      expect(() => assertDemoResetAllowed({ demoMode: undefined, databaseUrl: DEMO_URL })).toThrow(
        /DEMO_MODE is not "true"/,
      );
    });

    it.each(['false', 'off', 'demo', ''])('refuses %s', (demoMode) => {
      expect(() => assertDemoResetAllowed({ demoMode, databaseUrl: DEMO_URL })).toThrow(
        /DEMO_MODE is not "true"/,
      );
    });
  });

  describe('the target database', () => {
    it.each(['kurul_demo', 'demo', 'kurul-demo-eu', 'kurul_test'])('allows %s', (name) => {
      const url = `postgresql://kurul:secret@postgres:5432/${name}`;

      expect(assertDemoResetAllowed({ demoMode: 'true', databaseUrl: url })).toBe(name);
    });

    /**
     * The names this project ships and documents. `DEMO_MODE=true` alone must never be enough
     * to empty one of them — that is the whole point of asking a second, independent question.
     */
    it.each(['kurul', 'kurul_prod', 'postgres'])('refuses %s even with DEMO_MODE on', (name) => {
      const url = `postgresql://kurul:secret@postgres:5432/${name}`;

      expect(() => assertDemoResetAllowed({ demoMode: 'true', databaseUrl: url })).toThrow(
        /is not a demo database/,
      );
    });

    it('refuses when DATABASE_URL is unset', () => {
      expect(() => assertDemoResetAllowed({ demoMode: 'true', databaseUrl: undefined })).toThrow(
        /DATABASE_URL is unset/,
      );
    });

    it('refuses a connection string it cannot parse rather than guessing', () => {
      expect(() => assertDemoResetAllowed({ demoMode: 'true', databaseUrl: 'not-a-url' })).toThrow(
        /names no database/,
      );
    });
  });
});

/**
 * A URL parse rather than a regex, because the parts of a connection string that can contain
 * the word "demo" are not all the database name.
 */
describe('databaseNameOf', () => {
  it('reads the database name', () => {
    expect(databaseNameOf(DEMO_URL)).toBe('kurul_demo');
  });

  it('ignores query parameters', () => {
    expect(databaseNameOf('postgresql://u:p@host:5432/kurul_demo?schema=public')).toBe(
      'kurul_demo',
    );
  });

  /** A password containing "demo" is not a database named "demo". */
  it('does not read the credentials', () => {
    expect(databaseNameOf('postgresql://demo:demo@host:5432/kurul')).toBe('kurul');
  });

  it('is undefined when there is no database path at all', () => {
    expect(databaseNameOf('postgresql://u:p@host:5432')).toBeUndefined();
    expect(databaseNameOf('postgresql://u:p@host:5432/')).toBeUndefined();
  });

  it('is undefined for an unset or unparseable value', () => {
    expect(databaseNameOf(undefined)).toBeUndefined();
    expect(databaseNameOf('')).toBeUndefined();
    expect(databaseNameOf('kurul_demo')).toBeUndefined();
  });
});
