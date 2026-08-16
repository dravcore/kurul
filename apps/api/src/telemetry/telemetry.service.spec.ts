import { Logger } from '@nestjs/common';
import {
  DEFAULT_TELEMETRY_TIMEOUT_MS,
  TELEMETRY_ENABLED_ENV,
  TELEMETRY_ENDPOINT_ENV,
  TelemetryService,
  buildPingPayload,
  telemetrySettings,
} from './telemetry.service';

const ENV_KEYS = [TELEMETRY_ENABLED_ENV, TELEMETRY_ENDPOINT_ENV, 'NODE_ENV', 'JEST_WORKER_ID'];

describe('TelemetryService', () => {
  const saved = new Map<string, string | undefined>();
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    for (const key of ENV_KEYS) saved.set(key, process.env[key]);
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.restoreAllMocks();
  });

  /**
   * The claim this whole feature rests on. It is asserted three ways on purpose — the setting,
   * the boot path, and the absence of any outbound call — because a regression could arrive
   * through any one of them: a flipped `envBool` fallback, an `onModuleInit` that stops
   * checking, or a second sender added somewhere else in this file.
   *
   * Falsification check: change the fallback in `telemetrySettings` from `false` to `true` and
   * all three of these fail (the third with `fetch` having been called once).
   */
  describe('off by default', () => {
    it('reports disabled when nothing in the environment mentions telemetry', () => {
      delete process.env[TELEMETRY_ENABLED_ENV];
      delete process.env[TELEMETRY_ENDPOINT_ENV];

      expect(telemetrySettings()).toEqual({
        enabled: false,
        endpoint: '',
        timeoutMs: DEFAULT_TELEMETRY_TIMEOUT_MS,
      });
    });

    it('sends nothing at boot', () => {
      delete process.env[TELEMETRY_ENABLED_ENV];
      // An endpoint on its own must not be enough: a self-hoster who left a collector address
      // in `.env` while evaluating the feature has not consented to anything.
      process.env[TELEMETRY_ENDPOINT_ENV] = 'https://collector.example.com/ping';
      // The `isTestEnv()` guard is stood down for this one assertion, deliberately. With it in
      // place the handler returns before it ever reaches the sender, so the test would pass
      // even with the default flipped to `true` — it would be proving that Jest is running,
      // not that telemetry is off. Everything else about this process is a real boot.
      delete process.env.JEST_WORKER_ID;
      process.env.NODE_ENV = 'development';

      new TelemetryService().onModuleInit();

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('stays off for every value that is not an affirmative', () => {
      for (const value of ['false', '0', 'no', 'off', '']) {
        process.env[TELEMETRY_ENABLED_ENV] = value;
        expect(telemetrySettings().enabled).toBe(false);
      }
    });

    /** A typo is a configuration error, not a silent yes and not a silent no. */
    it('refuses a value that is neither true nor false', () => {
      process.env[TELEMETRY_ENABLED_ENV] = 'maybe';

      expect(() => telemetrySettings()).toThrow(/expected a boolean/);
    });
  });

  it('sends nothing when switched on with no endpoint to send to', () => {
    process.env[TELEMETRY_ENABLED_ENV] = 'true';
    delete process.env[TELEMETRY_ENDPOINT_ENV];
    delete process.env.JEST_WORKER_ID;
    process.env.NODE_ENV = 'development';

    new TelemetryService().onModuleInit();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /**
   * Building the whole `AppModule` is what every integration spec does. None of them may open a
   * connection to whatever a developer happens to have in `.env`.
   */
  it('sends nothing under a test runner even when fully configured', () => {
    process.env[TELEMETRY_ENABLED_ENV] = 'true';
    process.env[TELEMETRY_ENDPOINT_ENV] = 'https://collector.example.com/ping';

    new TelemetryService().onModuleInit();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe('the payload', () => {
    /**
     * The promise `docs/development.md` makes, checked against the object rather than against
     * prose: exactly two keys. `toEqual` on a key list rather than `toMatchObject`, so adding a
     * hostname, an instance id or a workspace count fails here before it reaches a reviewer.
     */
    it('carries the event name and the version, and nothing else', () => {
      const payload = buildPingPayload();

      expect(Object.keys(payload).sort()).toEqual(['event', 'version']);
      expect(payload.event).toBe('instance_started');
      expect(typeof payload.version).toBe('string');
      expect(payload.version.length).toBeGreaterThan(0);
    });

    it('reads the version from the running package rather than inventing one', () => {
      // apps/api/package.json is a semver string; `unknown` is the documented last resort and
      // would mean the resolver stopped finding the file it is supposed to walk up to.
      expect(buildPingPayload().version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe('when an operator turns it on', () => {
    const settings = {
      enabled: true,
      endpoint: 'https://collector.example.com/ping',
      timeoutMs: 50,
    };

    it('POSTs the payload as JSON, once, with a timeout', async () => {
      await new TelemetryService().sendPing(settings, buildPingPayload());

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(settings.endpoint);
      expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toEqual(buildPingPayload());
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    /** A collector that is down, hostile or slow must be indistinguishable from one that is off. */
    it('swallows a network failure instead of propagating it', async () => {
      fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        new TelemetryService().sendPing(settings, buildPingPayload()),
      ).resolves.toBeUndefined();
    });

    it('swallows a rejection from the collector', async () => {
      fetchSpy.mockResolvedValue(new Response(null, { status: 500 }));

      await expect(
        new TelemetryService().sendPing(settings, buildPingPayload()),
      ).resolves.toBeUndefined();
    });

    /** One ping per process start. No retry, no queue, no schedule. */
    it('does not retry', async () => {
      fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

      await new TelemetryService().sendPing(settings, buildPingPayload());

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
