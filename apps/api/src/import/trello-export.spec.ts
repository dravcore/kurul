import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { TrelloImportScope, TrelloImportSkipReason } from '@kurultay/shared-types';
import { parseTrelloExport, type TrelloReadIssue } from './trello-export';

const FIXTURE_DIR = join(__dirname, '..', '..', 'test', 'fixtures', 'trello');

function readFixture(name: string): Buffer {
  return readFileSync(join(FIXTURE_DIR, `${name}.json`));
}

function countIssues(
  issues: TrelloReadIssue[],
  scope: TrelloImportScope,
  reason: TrelloImportSkipReason = TrelloImportSkipReason.Malformed,
): number {
  return issues.filter((issue) => issue.scope === scope && issue.reason === reason).length;
}

describe('parseTrelloExport', () => {
  describe('recognising the file', () => {
    it('rejects a truncated export with a 400, not a crash', () => {
      const parse = (): unknown => parseTrelloExport(readFixture('edge-truncated'));

      expect(parse).toThrow(BadRequestException);
      // Asserting the message, not just the type. Measured: deleting the `try/catch` around
      // `JSON.parse` leaves `raw` undefined, the root check rejects it anyway, and a test that
      // only asked for `BadRequestException` stayed green while the guard it was written for was
      // gone. The user-visible difference is real too — one says re-download, the other says
      // pick a different file.
      expect(parse).toThrow(/not valid JSON/);
    });

    it('rejects valid JSON that is not a board export', () => {
      expect(() => parseTrelloExport(Buffer.from('{"hello":"world"}'))).toThrow(
        BadRequestException,
      );
    });

    it('rejects a Trello card export, which has a name but no lists', () => {
      // The near miss, and the reason the root check looks at two fields rather than one. A card
      // export is valid JSON with a plausible `name`; a check that only asked for `name` would
      // accept it and hand the user an empty board named after their card.
      expect(() => parseTrelloExport(readFixture('edge-card-export'))).toThrow(BadRequestException);
    });

    it('names the two failures differently', () => {
      // "Invalid Trello export" is the message that makes a user re-export the same broken file.
      // These two need different fixes — re-download versus pick a different file — so they need
      // different sentences.
      const notJson = (): unknown => parseTrelloExport(Buffer.from('not json at all'));
      const notABoard = (): unknown => parseTrelloExport(Buffer.from('{"hello":"world"}'));

      expect(notJson).toThrow(/not valid JSON/);
      expect(notABoard).toThrow(/Trello board export/);
    });

    // The control test for the three rejections above. Without it, `parseTrelloExport` could
    // throw on *everything* and all of them would still pass.
    it('does not reject a minimal but valid export', () => {
      const minimal = Buffer.from(JSON.stringify({ name: 'B', lists: [], cards: [] }));
      expect(parseTrelloExport(minimal).source.name).toBe('B');
    });

    it('accepts a board with no lists and no cards', () => {
      const { source, issues } = parseTrelloExport(readFixture('edge-empty-board'));

      expect(source.lists).toEqual([]);
      expect(source.cards).toEqual([]);
      // An empty board is empty, not broken. If this ever reports something, the reader has
      // started treating "nothing to import" as "something went wrong".
      expect(issues).toEqual([]);
    });
  });

  describe('reading an ordinary board', () => {
    it('narrows every section of the synthetic board and reports nothing', () => {
      const { source, issues } = parseTrelloExport(readFixture('synthetic-full-board'));

      expect(issues).toEqual([]);
      expect(source.name).toBe('Product Roadmap');
      expect(source.lists).toHaveLength(4);
      expect(source.cards).toHaveLength(6);
      expect(source.labels).toHaveLength(5);
      expect(source.checklists).toHaveLength(3);
    });

    it('keeps the archive flags rather than dropping archived rows itself', () => {
      // The reader narrows; deciding that an archived list must not be imported is the planner's
      // call (ADR 0025). If the reader started filtering, the report would lose the count.
      const { source } = parseTrelloExport(readFixture('synthetic-full-board'));

      expect(source.lists.filter((list) => list.closed)).toHaveLength(1);
      expect(source.cards.filter((card) => card.closed)).toHaveLength(1);
    });

    it('leaves the Trello order alone, values and all', () => {
      // Sorting and re-issuing positions is the planner's job, so this asserts the *absence* of
      // both: the array comes back in file order, carrying Trello's own `pos` values.
      const { source } = parseTrelloExport(readFixture('synthetic-full-board'));

      expect(source.lists.map((list) => list.name)).toEqual([
        'In Progress',
        'Backlog',
        'Old Sprint',
        'Shipped',
      ]);
      expect(source.lists.map((list) => list.pos)).toEqual([32768, 16384, 49152, 65535]);
    });

    it('counts only comment actions, and counts members without keeping them', () => {
      const { source } = parseTrelloExport(readFixture('synthetic-full-board'));

      // Three actions in the fixture, two of them comments. A count of `actions` rather than of
      // comments would say 3 here and the user would be told about a comment that never existed.
      expect(source.commentCount).toBe(2);
      expect(source.memberCount).toBe(2);
    });

    it('carries a card its attachments, including the one the planner has to refuse', () => {
      // `file:` is not this reader's problem — refusing non-http schemes is a write-side rule and
      // belongs to the planner (ADR 0024, ADR 0025). If the reader dropped it here, the report
      // would say nothing and the user would never learn the link existed.
      const { source } = parseTrelloExport(readFixture('synthetic-full-board'));
      const card = source.cards.find((entry) => entry.name === 'Import boards from Trello');

      expect(card?.attachments.map((attachment) => attachment.url)).toEqual([
        'https://example.invalid/notes/trello-export-format',
        'https://trello.com/1/cards/6512a1b3c3d4e5f601020330/attachments/6512a1b7c3d4e5f601020371/download/wireframe.png',
        'file:///Users/someone/specs/import.md',
      ]);
    });

    it('needs only a url from an attachment, and names it after the url when it has to', () => {
      // The one entity whose identity is not its `id`. An attachment row is a URL plus a label
      // for it, so an entry with a URL and nothing else still carries everything that matters —
      // and requiring `id` here would drop every attachment on the board the day Trello renames
      // that field, which is precisely the failure this reader is built to avoid.
      const { source, issues } = parseTrelloExport(
        Buffer.from(
          JSON.stringify({
            name: 'Bare attachment',
            lists: [{ id: 'l1', name: 'L', pos: 1, closed: false }],
            cards: [
              {
                id: 'c1',
                name: 'C',
                idList: 'l1',
                pos: 1,
                attachments: [{ url: 'https://example.invalid/a' }],
              },
            ],
            labels: [],
            checklists: [],
            members: [],
            actions: [],
          }),
        ),
      );

      expect(issues).toEqual([]);
      expect(source.cards[0]?.attachments).toEqual([
        { id: '', name: 'https://example.invalid/a', url: 'https://example.invalid/a' },
      ]);
    });

    it('keeps each checklist separate, with its own items', () => {
      const { source } = parseTrelloExport(readFixture('synthetic-full-board'));

      expect(source.checklists.map((checklist) => checklist.name)).toEqual([
        'Reader',
        'Mapping',
        'Acceptance',
      ]);
      expect(source.checklists.map((checklist) => checklist.checkItems.length)).toEqual([2, 2, 1]);
      expect(source.checklists[0]?.checkItems[0]?.state).toBe('complete');
    });

    it('preserves the label gaps ADR 0025 has to fill, instead of filling them here', () => {
      // An unnamed label, an uncoloured one and an unknown colour all survive the reader intact.
      // The reader inventing `"Label"` or `slot-1` here would move a decision out of the place
      // that reports it, and the user would stop being told the substitution happened.
      const { source } = parseTrelloExport(readFixture('synthetic-full-board'));

      expect(source.labels.filter((label) => label.name === '')).toHaveLength(2);
      expect(source.labels.filter((label) => label.color === null)).toHaveLength(1);
      expect(source.labels.map((label) => label.color)).toContain('tangerine');
    });
  });

  /**
   * The reader's actual contract.
   *
   * No field name in `trello-export.ts` was ever checked against a real Trello export, so the
   * promise is not "I know Trello's schema" — it is "I report what I do not know". These tests
   * are that promise, and each of them asserts both halves, because either half alone is
   * satisfiable by a reader that does nothing: one that returned `{ lists: [], cards: [] }` and a
   * pile of issues would pass every "it reported it" assertion on its own.
   */
  describe('when the export does not look the way this repo guessed', () => {
    it('does not throw', () => {
      expect(() => parseTrelloExport(readFixture('edge-unknown-shape'))).not.toThrow();
    });

    it('still returns every row it could read', () => {
      const { source } = parseTrelloExport(readFixture('edge-unknown-shape'));

      expect(source.lists.map((list) => list.name)).toEqual(['Readable list']);
      expect(source.cards.map((card) => card.name)).toEqual(['Readable card']);
      expect(source.checklists.map((checklist) => checklist.name)).toEqual(['Readable checklist']);
      expect(source.checklists[0]?.checkItems.map((item) => item.name)).toEqual(['Readable item']);
    });

    it('reports one row per entry it could not read, not one per bad field', () => {
      const { issues } = parseTrelloExport(readFixture('edge-unknown-shape'));

      // Four unreadable lists: a bare number, one with no `id`, one whose `name` is an array
      // *and* whose `closed` is a string, and one whose only problem is `closed: "true"`. The
      // third is why this counts entries and not fields — per-field reporting would call one list
      // two skipped lists. The fourth is there because `closed` needs to be able to fail on its
      // own: measured, a `closed` guard that silently coerced left this suite green, and the
      // damage is an archived list arriving as a live column with nothing said about it.
      expect(countIssues(issues, TrelloImportScope.List)).toBe(4);
      // Four unreadable cards: `idLabels` as a string, an attachment with no usable `url`, a
      // `due` that is an epoch number rather than an ISO string, and an entry that is a bare
      // string. The epoch one is in the fixture because a nullable field that silently swallows a
      // wrong type is the quietest failure in this file — measured, it left the whole suite green
      // while the user lost a due date and was told nothing.
      expect(countIssues(issues, TrelloImportScope.Card)).toBe(4);
      expect(countIssues(issues, TrelloImportScope.Checklist)).toBe(1);
      expect(countIssues(issues, TrelloImportScope.ChecklistItem)).toBe(1);
    });

    it('reports a whole section that is not an array', () => {
      const { source, issues } = parseTrelloExport(readFixture('edge-unknown-shape'));

      // `labels` is an object, `members` is a string, `actions` is an object. Each is one class of
      // row vanishing, so each is one report row — and the counts they would have produced are
      // zero rather than a guess.
      expect(source.labels).toEqual([]);
      expect(source.memberCount).toBe(0);
      expect(source.commentCount).toBe(0);
      expect(countIssues(issues, TrelloImportScope.Label)).toBe(1);
      expect(countIssues(issues, TrelloImportScope.Member)).toBe(1);
      expect(countIssues(issues, TrelloImportScope.Comment)).toBe(1);
    });

    it('reports a section that is missing entirely, rather than calling it an empty board', () => {
      // The failure this reader exists to avoid. If Trello renames `cards`, the honest answer is
      // "I could not find your cards", and the tempting one — "this board has no cards" — is an
      // import that reports success and brings nothing across.
      const { source, issues } = parseTrelloExport(
        Buffer.from(JSON.stringify({ name: 'Only a name and lists', lists: [] })),
      );

      expect(source.cards).toEqual([]);
      expect(countIssues(issues, TrelloImportScope.Card)).toBe(1);
      expect(countIssues(issues, TrelloImportScope.Checklist)).toBe(1);
      expect(countIssues(issues, TrelloImportScope.Label)).toBe(1);
      expect(countIssues(issues, TrelloImportScope.Member)).toBe(1);
      expect(countIssues(issues, TrelloImportScope.Comment)).toBe(1);
    });

    it('does not report a card that simply has no attachments', () => {
      // The control for the rule above, and the line it draws. A *section* that is absent means a
      // class of row disappeared; a card without attachments is the ordinary case, and reporting
      // it would put one row in the report for every card on the board.
      const { issues } = parseTrelloExport(readFixture('synthetic-full-board'));

      expect(countIssues(issues, TrelloImportScope.Attachment)).toBe(0);
      expect(issues).toEqual([]);
    });

    it('quotes a name in the report when there was one to quote', () => {
      // `count` tells a user how much is missing; `sample` is how they recognise *what*. A reader
      // that reported only counts would leave them staring at "3 lists skipped".
      const { issues } = parseTrelloExport(readFixture('edge-unknown-shape'));
      const samples = issues
        .filter((issue) => issue.scope === TrelloImportScope.List)
        .map((issue) => issue.sample);

      expect(samples).toContain('List with no id at all');
      // And `null` where there was nothing readable — a bare `17` has no name to offer, and
      // inventing one would be worse than admitting it.
      expect(samples).toContain(null);
    });

    it('notices a non-string inside an id array instead of passing it through', () => {
      // Measured: letting `stringArray` return the raw array left this suite green. The damage a
      // passing test would have missed is quiet — a number in `idLabels` becomes a lookup key
      // that matches no label, so the card arrives with one label fewer and the report says
      // nothing. Silently losing a label is worse than losing the card loudly.
      const { source, issues } = parseTrelloExport(
        Buffer.from(
          JSON.stringify({
            name: 'Mixed id array',
            lists: [{ id: 'l1', name: 'L', pos: 1, closed: false }],
            cards: [
              { id: 'c1', name: 'Clean', idList: 'l1', pos: 1, idLabels: ['la1'] },
              { id: 'c2', name: 'Has a number in idLabels', idList: 'l1', pos: 2, idLabels: [7] },
            ],
            labels: [{ id: 'la1', name: 'Bug', color: 'red' }],
            checklists: [],
            members: [],
            actions: [],
          }),
        ),
      );

      expect(source.cards.map((card) => card.name)).toEqual(['Clean']);
      expect(countIssues(issues, TrelloImportScope.Card)).toBe(1);
      expect(issues[0]?.sample).toBe('Has a number in idLabels');
    });

    it('does not accept an empty string as an identity', () => {
      // Measured: relaxing `readId` to any string left this whole suite green, so the guard was
      // load-bearing and untested at the same time. It is load-bearing because the ids are join
      // keys — the planner maps a card onto its list and a check item onto its checklist by them.
      // Two entries both carrying `''` would collide in that map and silently become one row,
      // which is a wrong import rather than an incomplete one.
      const { source, issues } = parseTrelloExport(
        Buffer.from(
          JSON.stringify({
            name: 'Empty identities',
            lists: [
              { id: '', name: 'First nameless-id list', pos: 1, closed: false },
              { id: '', name: 'Second nameless-id list', pos: 2, closed: false },
              { id: 'l3', name: 'Has an id', pos: 3, closed: false },
            ],
            cards: [],
            labels: [],
            checklists: [],
            members: [],
            actions: [],
          }),
        ),
      );

      expect(source.lists.map((list) => list.name)).toEqual(['Has an id']);
      expect(countIssues(issues, TrelloImportScope.List)).toBe(2);
      expect(issues.map((issue) => issue.sample)).toEqual([
        'First nameless-id list',
        'Second nameless-id list',
      ]);
    });

    it('does not treat a null or an absent value as a surprise', () => {
      // Trello writes `null` for an empty description, an unset due date and an uncoloured label,
      // and omits arrays it has nothing to put in. Reporting those would bury the real surprises
      // under a report row for every ordinary card on the board.
      const { source, issues } = parseTrelloExport(
        Buffer.from(
          JSON.stringify({
            name: 'Nulls everywhere',
            desc: null,
            lists: [{ id: 'l1', name: 'Only list', pos: 16384, closed: false }],
            cards: [
              { id: 'c1', name: 'Only card', desc: null, due: null, idList: 'l1', pos: 16384 },
              // A card with no `name` key at all. Measured: without this entry, making
              // `EntryFields.string` treat absence as unusable changed nothing in this suite —
              // the branch had no test. It has to stay absence rather than a surprise, because
              // an empty title is a case the planner already reports as `(card, malformed)`, and
              // reporting it here as well would describe one card as two missing cards.
              { id: 'c2', desc: null, due: null, idList: 'l1', pos: 32768 },
            ],
            labels: [{ id: 'la1', name: '', color: null }],
            checklists: [],
            members: [],
            actions: [],
          }),
        ),
      );

      expect(issues).toEqual([]);
      expect(source.cards[0]?.idLabels).toEqual([]);
      expect(source.cards[0]?.attachments).toEqual([]);
      expect(source.cards[0]?.closed).toBe(false);
      // The nameless card came across with an empty title rather than being dropped here.
      expect(source.cards).toHaveLength(2);
      expect(source.cards[1]?.name).toBe('');
    });

    it('falls back to id ordering material when `pos` is a string, without reporting it', () => {
      // ADR 0025 already decided what happens to a non-numeric `pos`: the order falls back to the
      // Trello id. A decision that is written down is not a surprise, so it does not reach the
      // user's report — but the value still must not survive as a number.
      const { source, issues } = parseTrelloExport(readFixture('edge-unknown-shape'));

      expect(source.lists[0]?.pos).toBeNull();
      // Still four, not five: the list that carried `pos: "bottom"` is the one that came across.
      // If `pos` ever started reporting, this number would go up and the readable list would be
      // described to the user as a problem.
      expect(countIssues(issues, TrelloImportScope.List)).toBe(4);
    });
  });
});
