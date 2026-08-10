import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import {
  inviteCallbackPath,
  isEmailVerificationRequired,
  verificationLinkError,
} from './email-verification';

function forbidden(error: string): ApiError {
  return new ApiError({ statusCode: 403, error, message: 'Forbidden' });
}

describe('verificationLinkError', () => {
  it('reads an absent parameter as a confirmed address', () => {
    // Better Auth adds nothing on success, so "no error" is the only success signal there is.
    expect(verificationLinkError(null)).toBeNull();
    expect(verificationLinkError('')).toBeNull();
  });

  it('passes each documented failure through unchanged', () => {
    expect(verificationLinkError('TOKEN_EXPIRED')).toBe('TOKEN_EXPIRED');
    expect(verificationLinkError('INVALID_TOKEN')).toBe('INVALID_TOKEN');
    expect(verificationLinkError('USER_NOT_FOUND')).toBe('USER_NOT_FOUND');
  });

  it('reports an unrecognised code as a failure rather than a success', () => {
    expect(verificationLinkError('SOMETHING_NEW')).toBe('unknown');
  });
});

describe('isEmailVerificationRequired', () => {
  it('ignores failures that are not a 403', () => {
    expect(
      isEmailVerificationRequired(
        new ApiError({ statusCode: 404, error: 'Not Found', message: 'gone' }),
        false,
      ),
    ).toBe(false);
    expect(isEmailVerificationRequired(new Error('network down'), false)).toBe(false);
  });

  it("trusts Better Auth's own code over what the session says", () => {
    // The session can be stale — a user who just confirmed still carries `false` in the
    // cookie cache — so a code that names the reason outranks it in both directions.
    expect(
      isEmailVerificationRequired(forbidden('EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION'), true),
    ).toBe(true);
    expect(
      isEmailVerificationRequired(forbidden('YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION'), false),
    ).toBe(false);
  });

  it('falls back to the session when the API sends no machine-readable code', () => {
    // Our own accept endpoint answers with Nest's reason phrase and an English sentence, and
    // the sentence is not something the UI is allowed to read.
    expect(isEmailVerificationRequired(forbidden('Forbidden'), false)).toBe(true);
    expect(isEmailVerificationRequired(forbidden('Forbidden'), true)).toBe(false);
    expect(isEmailVerificationRequired(forbidden('Forbidden'), undefined)).toBe(false);
  });
});

describe('inviteCallbackPath', () => {
  it('points back at the invitation that asked for the confirmation', () => {
    expect(inviteCallbackPath('0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d51')).toBe(
      '/invite/0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d51',
    );
  });
});
