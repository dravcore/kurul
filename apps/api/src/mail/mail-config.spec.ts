import { readMailConfig } from './mail-config';

const VARS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_SECURE', 'MAIL_FROM'];

describe('readMailConfig', () => {
  const original = new Map(VARS.map((name) => [name, process.env[name]]));

  beforeEach(() => {
    for (const name of VARS) {
      delete process.env[name];
    }
  });

  afterAll(() => {
    for (const [name, value] of original) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it('reports SMTP as unconfigured when SMTP_HOST is unset or blank', () => {
    expect(readMailConfig().smtp).toBeUndefined();

    process.env.SMTP_HOST = '   ';
    expect(readMailConfig().smtp).toBeUndefined();
  });

  it('reads a full SMTP configuration', () => {
    process.env.SMTP_HOST = 'smtp.example.test';
    process.env.SMTP_PORT = '2525';
    process.env.SMTP_USER = 'postmaster';
    process.env.SMTP_PASSWORD = 'hunter2';
    process.env.SMTP_SECURE = 'true';
    process.env.MAIL_FROM = 'Kurultay <noreply@example.test>';

    expect(readMailConfig()).toEqual({
      from: 'Kurultay <noreply@example.test>',
      smtp: {
        host: 'smtp.example.test',
        port: 2525,
        secure: true,
        auth: { user: 'postmaster', password: 'hunter2' },
      },
    });
  });

  it('omits auth entirely for an anonymous relay', () => {
    process.env.SMTP_HOST = 'mailpit';
    process.env.SMTP_PORT = '1025';

    expect(readMailConfig().smtp).toEqual({ host: 'mailpit', port: 1025, secure: false });
  });

  it('defaults `secure` from the port so 465 gets implicit TLS and 587 does not', () => {
    process.env.SMTP_HOST = 'smtp.example.test';

    process.env.SMTP_PORT = '465';
    expect(readMailConfig().smtp?.secure).toBe(true);

    process.env.SMTP_PORT = '587';
    expect(readMailConfig().smtp?.secure).toBe(false);

    // Unset port falls back to 587.
    delete process.env.SMTP_PORT;
    expect(readMailConfig().smtp).toMatchObject({ port: 587, secure: false });
  });

  it('lets SMTP_SECURE override the port-derived default', () => {
    process.env.SMTP_HOST = 'smtp.example.test';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_SECURE = 'false';

    expect(readMailConfig().smtp?.secure).toBe(false);
  });

  it('rejects a malformed port instead of binding to something arbitrary', () => {
    process.env.SMTP_HOST = 'smtp.example.test';
    process.env.SMTP_PORT = 'not-a-port';

    expect(() => readMailConfig()).toThrow('Invalid SMTP_PORT');
  });
});
