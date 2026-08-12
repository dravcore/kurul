import { describe, expect, it } from 'vitest';
import { InvitationStatus, LabelColorSlot, MemberRole, Priority } from '../src/enums.js';

/**
 * `enums.ts` hand-mirrors the Prisma schema, so the values here are the strings that reach
 * Postgres. A typo in one of them types fine — the literal type simply becomes the typo — and
 * only shows up as a rejected write at runtime.
 */
describe('enum constants mirror their keys', () => {
  it.each([
    ['Priority', Priority],
    ['MemberRole', MemberRole],
    ['InvitationStatus', InvitationStatus],
    ['LabelColorSlot', LabelColorSlot],
  ])('%s uses each key as its own value', (_name, constant: Record<string, string>) => {
    for (const [key, value] of Object.entries(constant)) {
      expect(value).toBe(key);
    }
  });
});

describe('LabelColorSlot', () => {
  it('only ever holds design-token slots, never a raw colour', () => {
    // `Label.color` stores a theme-resolved slot name; a hex value committed here would be
    // written straight to the database and break theming for every board that used it.
    for (const value of Object.values(LabelColorSlot)) {
      expect(value).toMatch(/^slot-[1-8]$/);
    }
  });
});
