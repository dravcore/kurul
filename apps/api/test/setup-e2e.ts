import { loadRootEnv } from '../src/common/env';

loadRootEnv();

// Integration tests always target the dedicated test database.
process.env.DATABASE_URL =
  process.env.DATABASE_URL?.includes('kurultay_test') === true
    ? process.env.DATABASE_URL
    : 'postgresql://kurultay:kurultay@localhost:5432/kurultay_test';

process.env.BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET?.trim() || 'test-secret-not-for-production';
process.env.BETTER_AUTH_URL =
  process.env.BETTER_AUTH_URL?.trim() || 'http://localhost:4000';
process.env.WEB_URL = process.env.WEB_URL?.trim() || 'http://localhost:3000';
