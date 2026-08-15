import { openApiDocsEnabled } from './serve-openapi';

/**
 * These assertions pin a **decision**, not an implementation.
 *
 * `/docs` is an unauthenticated HTML surface with a request console attached, published by an
 * API that people self-host without choosing it. Off in production is the answer this project
 * arrived at, and the reasoning is on `openApiDocsEnabled`. Flipping the default is allowed —
 * it is a decision, and decisions change — but it must be a decision, so it has to break a test
 * that says what it costs rather than slipping through as a one-character diff.
 */
describe('openApiDocsEnabled', () => {
  // Two keys are saved and restored individually rather than the whole of `process.env` being
  // swapped out. Reassigning `process.env` replaces the object every other module in this
  // worker already closed over, which is a much larger blast radius than the two variables
  // under test — and `NODE_ENV` in particular is read by `isTestEnv()`.
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDocsEnabled = process.env.API_DOCS_ENABLED;

  function restore(key: 'NODE_ENV' | 'API_DOCS_ENABLED', value: string | undefined): void {
    if (value === undefined) {
      delete process.env[key];
      return;
    }
    process.env[key] = value;
  }

  afterEach(() => {
    restore('NODE_ENV', originalNodeEnv);
    restore('API_DOCS_ENABLED', originalDocsEnabled);
  });

  it('is on when NODE_ENV is not production', () => {
    delete process.env.API_DOCS_ENABLED;
    process.env.NODE_ENV = 'development';

    expect(openApiDocsEnabled()).toBe(true);
  });

  it('is off under NODE_ENV=production unless an operator asks for it', () => {
    delete process.env.API_DOCS_ENABLED;
    process.env.NODE_ENV = 'production';

    expect(openApiDocsEnabled()).toBe(false);
  });

  it('is on in production when API_DOCS_ENABLED says so', () => {
    process.env.NODE_ENV = 'production';
    process.env.API_DOCS_ENABLED = 'true';

    expect(openApiDocsEnabled()).toBe(true);
  });

  it('can be switched off outside production too', () => {
    process.env.NODE_ENV = 'development';
    process.env.API_DOCS_ENABLED = 'false';

    expect(openApiDocsEnabled()).toBe(false);
  });

  it('refuses a value that is not a boolean rather than guessing', () => {
    process.env.NODE_ENV = 'production';
    process.env.API_DOCS_ENABLED = 'maybe';

    // `envBool` throws on an unrecognised spelling for the same reason every other variable
    // does: `Boolean('false')` is `true`, and a lenient reading here would publish a console on
    // an instance whose operator wrote something they believed meant "no".
    expect(() => openApiDocsEnabled()).toThrow(/API_DOCS_ENABLED/);
  });
});
