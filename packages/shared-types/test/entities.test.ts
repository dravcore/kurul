import { describe, expect, it } from 'vitest';
import { TrelloImportScope, TrelloImportSkipReason } from '../src/entities.js';

/**
 * These two vocabularies are a wire format twice over: they are serialised into the import
 * response body, and the web turns each value into a translation key (`app.board.import.skip.*`).
 * Renaming a value therefore does not fail anything at compile time on either side — the API
 * sends a new string, the web looks up a key that does not exist, and the user sees a raw
 * identifier where a sentence should be.
 */
describe('TrelloImportScope', () => {
  it('has no duplicate values', () => {
    const values = Object.values(TrelloImportScope);
    expect(new Set(values).size).toBe(values.length);
  });

  it('names every scope in lowerCamelCase, because each one becomes a translation key', () => {
    for (const value of Object.values(TrelloImportScope)) {
      expect(value).toMatch(/^[a-z]+([A-Z][a-z]+)*$/);
    }
  });

  it('keeps `list` and `column` apart', () => {
    // Not a tautology dressed up as a test: the two words describe opposite outcomes and the
    // temptation to collapse them is real. `list` is something the reader found in the export
    // and did not carry across; `column` is something that *was* carried across and arrived
    // changed — the default category every imported column takes (ADR 0025). Merging them would
    // leave the user unable to tell "you lost three lists" from "three columns need a category".
    expect(TrelloImportScope.List).not.toBe(TrelloImportScope.Column);
  });
});

describe('TrelloImportSkipReason', () => {
  it('has no duplicate values', () => {
    const values = Object.values(TrelloImportSkipReason);
    expect(new Set(values).size).toBe(values.length);
  });

  /**
   * The closed-vocabulary claim, pinned by name.
   *
   * ADR 0025 says the reason list is closed and that adding a reason costs a translation key.
   * Nothing in the type system enforces that cost — a seventh entry compiles, ships, and reaches
   * the browser as an untranslated string. This test is where that cost is collected: adding a
   * reason means editing this list, and the comment above it says what else to edit.
   */
  it('is exactly the six reasons the web can render', () => {
    expect(new Set(Object.values(TrelloImportSkipReason))).toEqual(
      new Set([
        'outOfScope',
        'archived',
        'unmappable',
        'unsupportedScheme',
        'malformed',
        'defaulted',
      ]),
    );
  });

  it('carries `defaulted`, which is a substitution rather than a loss', () => {
    // The one entry a later reader is most likely to "clean up" into its own array. ADR 0025
    // rejected that split: a user asking why their board looks different needs the defaulted
    // colours and the defaulted categories in the same list as the losses, not in a second one.
    expect(Object.values(TrelloImportSkipReason)).toContain('defaulted');
  });
});
