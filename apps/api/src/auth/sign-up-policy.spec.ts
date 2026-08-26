import { SIGNUP_ENABLED_ENV, signUpEnabled } from './sign-up-policy';

/**
 * The switch itself. The mount (`mount-better-auth.ts`) and `GET /config` both read this, so
 * what it returns for a given spelling is the whole contract between the operator's `.env` and
 * the two places that act on it.
 */
describe('signUpEnabled', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('is open when the variable is unset, which is every install that predates the switch', () => {
    delete process.env[SIGNUP_ENABLED_ENV];

    expect(signUpEnabled()).toBe(true);
  });

  it('is open when the variable is blank, so an untouched .env.example row changes nothing', () => {
    process.env[SIGNUP_ENABLED_ENV] = '';

    expect(signUpEnabled()).toBe(true);
  });

  it.each(['false', '0', 'no', 'off', 'FALSE'])('closes registration for %s', (value) => {
    process.env[SIGNUP_ENABLED_ENV] = value;

    expect(signUpEnabled()).toBe(false);
  });

  it.each(['true', '1', 'yes', 'on'])('keeps it open for %s', (value) => {
    process.env[SIGNUP_ENABLED_ENV] = value;

    expect(signUpEnabled()).toBe(true);
  });

  /**
   * A typo must not silently open or close registration: `envBool` refuses anything that is not
   * a recognised spelling, and this pins that the switch inherits the refusal.
   */
  it('refuses a value that is neither true nor false', () => {
    process.env[SIGNUP_ENABLED_ENV] = 'maybe';

    expect(() => signUpEnabled()).toThrow(/Invalid SIGNUP_ENABLED/);
  });
});
