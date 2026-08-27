import {
  DEFAULT_DEMO_RESET_INTERVAL_MINUTES,
  DEMO_MODE_ENV,
  DEMO_RESET_INTERVAL_ENV,
  demoConfig,
  demoModeEnabled,
  demoResetIntervalMinutes,
  nextDemoResetAt,
} from './demo-mode';

/**
 * The switch itself. Every demo behaviour in the API reads `demoModeEnabled()`, so the value
 * this returns for a given spelling is the whole contract, and `demoConfig` is what a browser
 * sees on `GET /config`.
 */
describe('demo mode configuration', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  describe('demoModeEnabled', () => {
    it('is off when the variable is unset, which is every ordinary deployment', () => {
      delete process.env[DEMO_MODE_ENV];

      expect(demoModeEnabled()).toBe(false);
    });

    it.each(['true', '1', 'yes', 'on', 'TRUE'])('accepts %s as on', (value) => {
      process.env[DEMO_MODE_ENV] = value;

      expect(demoModeEnabled()).toBe(true);
    });

    it.each(['false', '0', 'no', 'off', ''])('reads %s as off', (value) => {
      process.env[DEMO_MODE_ENV] = value;

      expect(demoModeEnabled()).toBe(false);
    });

    /**
     * Loud, not lenient. `Boolean('maybe')` is `true`, so a permissive reading would turn a
     * typo into a live demo instance with mail silenced and two routes refusing.
     */
    it('throws on a spelling it does not recognise', () => {
      process.env[DEMO_MODE_ENV] = 'demo';

      expect(() => demoModeEnabled()).toThrow(/DEMO_MODE/);
    });
  });

  describe('demoResetIntervalMinutes', () => {
    it('defaults to an hour', () => {
      delete process.env[DEMO_RESET_INTERVAL_ENV];

      expect(demoResetIntervalMinutes()).toBe(DEFAULT_DEMO_RESET_INTERVAL_MINUTES);
    });

    it('reads a configured interval', () => {
      process.env[DEMO_RESET_INTERVAL_ENV] = '15';

      expect(demoResetIntervalMinutes()).toBe(15);
    });

    /** Zero and negatives are a divisor and a modulus elsewhere, so they are refused at the source. */
    it.each(['0', '-5'])('refuses %s', (value) => {
      process.env[DEMO_RESET_INTERVAL_ENV] = value;

      expect(() => demoResetIntervalMinutes()).toThrow(/positive number of minutes/);
    });
  });

  /**
   * The arithmetic the API and the reset sidecar have to agree on without exchanging anything:
   * the API returns the next boundary of an epoch-anchored grid, the sidecar sleeps
   * `interval - (now % interval)` seconds to reach the same instant.
   */
  describe('nextDemoResetAt', () => {
    it('returns the next boundary of the interval grid', () => {
      const now = new Date('2026-08-22T14:23:45.000Z');

      expect(nextDemoResetAt(now, 60).toISOString()).toBe('2026-08-22T15:00:00.000Z');
    });

    it('divides the hour when the interval is shorter', () => {
      const now = new Date('2026-08-22T14:23:45.000Z');

      expect(nextDemoResetAt(now, 15).toISOString()).toBe('2026-08-22T14:30:00.000Z');
    });

    /** Exactly on a boundary is a full interval away, matching `interval - (now % interval)`. */
    it('never returns the current instant', () => {
      const now = new Date('2026-08-22T14:00:00.000Z');

      expect(nextDemoResetAt(now, 60).toISOString()).toBe('2026-08-22T15:00:00.000Z');
    });
  });

  describe('demoConfig', () => {
    it('publishes nulls rather than a plausible schedule when demo mode is off', () => {
      delete process.env[DEMO_MODE_ENV];

      expect(demoConfig(new Date('2026-08-22T14:23:45.000Z'))).toEqual({
        enabled: false,
        resetIntervalMinutes: null,
        nextResetAt: null,
      });
    });

    it('publishes the interval and the next reset when it is on', () => {
      process.env[DEMO_MODE_ENV] = 'true';
      process.env[DEMO_RESET_INTERVAL_ENV] = '30';

      expect(demoConfig(new Date('2026-08-22T14:23:45.000Z'))).toEqual({
        enabled: true,
        resetIntervalMinutes: 30,
        nextResetAt: '2026-08-22T14:30:00.000Z',
      });
    });
  });
});
