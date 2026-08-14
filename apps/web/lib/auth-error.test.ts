import { describe, it, expect } from 'vitest';
import { resolveRegisterErrorMapping } from './auth-error';

describe('resolveRegisterErrorMapping', () => {
  describe('email field errors', () => {
    it('maps INVALID_EMAIL to email field with invalidEmail message key', () => {
      const result = resolveRegisterErrorMapping('INVALID_EMAIL');
      expect(result).toEqual({
        field: 'email',
        messageKey: 'fieldErrors.email.invalidEmail',
      });
    });

    it('maps USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL to email field with alreadyExists message key', () => {
      const result = resolveRegisterErrorMapping('USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL');
      expect(result).toEqual({
        field: 'email',
        messageKey: 'fieldErrors.email.alreadyExists',
      });
    });
  });

  describe('password field errors', () => {
    it('maps INVALID_PASSWORD to password field with invalidPassword message key', () => {
      const result = resolveRegisterErrorMapping('INVALID_PASSWORD');
      expect(result).toEqual({
        field: 'password',
        messageKey: 'fieldErrors.password.invalidPassword',
      });
    });

    it('maps PASSWORD_TOO_SHORT to password field with tooShort message key', () => {
      const result = resolveRegisterErrorMapping('PASSWORD_TOO_SHORT');
      expect(result).toEqual({
        field: 'password',
        messageKey: 'fieldErrors.password.tooShort',
      });
    });

    it('maps PASSWORD_TOO_LONG to password field with tooLong message key', () => {
      const result = resolveRegisterErrorMapping('PASSWORD_TOO_LONG');
      expect(result).toEqual({
        field: 'password',
        messageKey: 'fieldErrors.password.tooLong',
      });
    });
  });

  describe('unknown codes', () => {
    it('returns null for unknown error codes', () => {
      const result = resolveRegisterErrorMapping('UNKNOWN_ERROR_CODE');
      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      const result = resolveRegisterErrorMapping('');
      expect(result).toBeNull();
    });

    it('returns null for undefined', () => {
      const result = resolveRegisterErrorMapping(undefined);
      expect(result).toBeNull();
    });
  });
});
