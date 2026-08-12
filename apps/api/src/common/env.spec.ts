import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { envBool, envInt, envPort, envString, loadRootEnv } from './env';

const NAME = 'KURULTAY_TEST_VAR';

// `.env` is git-ignored, so the assertion that actually reads it only runs where a
// developer has one (locally); everywhere else the environment comes from the runtime.
const ROOT_ENV = resolve(__dirname, '..', '..', '..', '..', '.env');
const itWithRootEnv = existsSync(ROOT_ENV) ? it : it.skip;

describe('env helpers', () => {
  afterEach(() => {
    delete process.env[NAME];
  });

  describe('envInt / envPort', () => {
    it('falls back when unset', () => {
      expect(envPort(NAME, 4000)).toBe(4000);
    });

    it.each(['', '   '])('falls back when blank (%j)', (value) => {
      process.env[NAME] = value;
      expect(envPort(NAME, 4000)).toBe(4000);
    });

    it('parses a valid integer', () => {
      process.env[NAME] = '5000';
      expect(envPort(NAME, 4000)).toBe(5000);
    });

    it.each(['abc', '80x', '3.5', 'NaN'])('throws on non-integer (%j)', (value) => {
      process.env[NAME] = value;
      expect(() => envInt(NAME, 4000)).toThrow(`Invalid ${NAME}`);
    });

    it('throws on a port outside the TCP range', () => {
      process.env[NAME] = '70000';
      expect(() => envPort(NAME, 4000)).toThrow(`Invalid ${NAME}`);
    });
  });

  describe('envString', () => {
    it('falls back when unset or blank', () => {
      expect(envString(NAME, 'http://localhost:3000')).toBe('http://localhost:3000');
      process.env[NAME] = '';
      expect(envString(NAME, 'http://localhost:3000')).toBe('http://localhost:3000');
    });

    it('returns the trimmed value when set', () => {
      process.env[NAME] = ' http://example.test ';
      expect(envString(NAME, 'http://localhost:3000')).toBe('http://example.test');
    });
  });

  describe('envBool', () => {
    it('falls back when unset or blank', () => {
      expect(envBool(NAME, true)).toBe(true);
      process.env[NAME] = '   ';
      expect(envBool(NAME, false)).toBe(false);
    });

    it.each(['true', 'TRUE', '1', 'yes', 'on'])('reads %j as true', (value) => {
      process.env[NAME] = value;
      expect(envBool(NAME, false)).toBe(true);
    });

    it.each(['false', 'False', '0', 'no', 'off'])('reads %j as false', (value) => {
      process.env[NAME] = value;
      expect(envBool(NAME, true)).toBe(false);
    });

    it.each(['maybe', '2', 'y'])('throws on an unrecognised value (%j)', (value) => {
      process.env[NAME] = value;
      expect(() => envBool(NAME, false)).toThrow(`Invalid ${NAME}`);
    });
  });

  describe('loadRootEnv', () => {
    itWithRootEnv('loads the monorepo-root .env regardless of cwd', () => {
      const cwd = process.cwd();
      const existing = process.env.DATABASE_URL;
      delete process.env.DATABASE_URL;
      process.chdir('/');

      try {
        loadRootEnv();
        expect(process.env.DATABASE_URL).toBeDefined();
      } finally {
        process.chdir(cwd);
        if (existing === undefined) {
          delete process.env.DATABASE_URL;
        } else {
          process.env.DATABASE_URL = existing;
        }
      }
    });

    it('does not override an already-set variable', () => {
      process.env.DATABASE_URL = 'postgresql://from-the-real-environment';

      loadRootEnv();

      expect(process.env.DATABASE_URL).toBe('postgresql://from-the-real-environment');
    });
  });
});
