import { TrelloImportScope, TrelloImportSkipReason } from '@kurultay/shared-types';
import { SKIP_SAMPLE_LIMIT, SkipCollector } from './import-skip';

describe('SkipCollector', () => {
  it('groups by (scope, reason) and counts', () => {
    const skips = new SkipCollector();
    skips.add(TrelloImportScope.Card, TrelloImportSkipReason.Archived, 'Old card');
    skips.add(TrelloImportScope.Card, TrelloImportSkipReason.Archived, 'Older card');
    skips.add(TrelloImportScope.Card, TrelloImportSkipReason.Malformed, 'Odd card');

    expect(skips.toReport()).toEqual([
      {
        scope: 'card',
        reason: 'archived',
        count: 2,
        samples: ['Old card', 'Older card'],
      },
      { scope: 'card', reason: 'malformed', count: 1, samples: ['Odd card'] },
    ]);
  });

  it('caps samples at the limit and never caps the count', () => {
    const skips = new SkipCollector();
    for (let index = 0; index < SKIP_SAMPLE_LIMIT + 37; index += 1) {
      skips.add(TrelloImportScope.Card, TrelloImportSkipReason.Archived, `Card ${index}`);
    }

    const [group] = skips.toReport();
    expect(group?.count).toBe(SKIP_SAMPLE_LIMIT + 37);
    expect(group?.samples).toHaveLength(SKIP_SAMPLE_LIMIT);
    // The samples are the *first* ones seen, not a random window: a user scanning them has to be
    // able to find those names in their board.
    expect(group?.samples[0]).toBe('Card 0');
  });

  it('keeps counting past the sample cap when the items arrive in bulk', () => {
    // `addMany` takes its own path through the cap. Without this, a bulk group could cap `count`
    // as well as `samples` and only the one-at-a-time path would notice.
    const skips = new SkipCollector();
    skips.addMany(TrelloImportScope.Comment, TrelloImportSkipReason.OutOfScope, 4212);

    expect(skips.toReport()[0]?.count).toBe(4212);
    expect(skips.toReport()[0]?.samples).toEqual([]);
  });

  it('adds nothing for a count of zero', () => {
    const skips = new SkipCollector();
    skips.addMany(TrelloImportScope.Member, TrelloImportSkipReason.Unmappable, 0);

    // A group reading "0 members were dropped" is a line that says nothing happened, and a report
    // made mostly of those is one nobody reads.
    expect(skips.toReport()).toEqual([]);
  });

  it('does not quote an empty name as a sample', () => {
    const skips = new SkipCollector();
    skips.add(TrelloImportScope.Card, TrelloImportSkipReason.Malformed, '');
    skips.add(TrelloImportScope.Card, TrelloImportSkipReason.Malformed, '   ');
    skips.add(TrelloImportScope.Card, TrelloImportSkipReason.Malformed, null);
    skips.add(TrelloImportScope.Card, TrelloImportSkipReason.Malformed, 'Real name');

    expect(skips.toReport()).toEqual([
      { scope: 'card', reason: 'malformed', count: 4, samples: ['Real name'] },
    ]);
  });

  it('orders groups the same way whatever order they arrived in', () => {
    const forwards = new SkipCollector();
    forwards.add(TrelloImportScope.List, TrelloImportSkipReason.Archived);
    forwards.add(TrelloImportScope.Card, TrelloImportSkipReason.Archived);
    forwards.add(TrelloImportScope.Comment, TrelloImportSkipReason.OutOfScope);
    forwards.add(TrelloImportScope.Label, TrelloImportSkipReason.Defaulted);

    const backwards = new SkipCollector();
    backwards.add(TrelloImportScope.Label, TrelloImportSkipReason.Defaulted);
    backwards.add(TrelloImportScope.Comment, TrelloImportSkipReason.OutOfScope);
    backwards.add(TrelloImportScope.Card, TrelloImportSkipReason.Archived);
    backwards.add(TrelloImportScope.List, TrelloImportSkipReason.Archived);

    // The report is shown to a person who may run the same import twice. Two orders for the same
    // facts would leave them working out whether something changed.
    expect(backwards.toReport()).toEqual(forwards.toReport());
    // The control half: the assertion above would also pass if `toReport` returned nothing at all.
    expect(forwards.toReport().map((group) => `${group.scope}/${group.reason}`)).toEqual([
      'list/archived',
      'card/archived',
      'label/defaulted',
      'comment/outOfScope',
    ]);
  });

  it('sorts by reason within one scope, not by arrival', () => {
    const skips = new SkipCollector();
    skips.add(TrelloImportScope.Card, TrelloImportSkipReason.Malformed);
    skips.add(TrelloImportScope.Card, TrelloImportSkipReason.Archived);

    expect(skips.toReport().map((group) => group.reason)).toEqual(['archived', 'malformed']);
  });

  it('hands back copies, so a caller cannot edit the collector through the report', () => {
    const skips = new SkipCollector();
    skips.add(TrelloImportScope.Card, TrelloImportSkipReason.Archived, 'One');

    const first = skips.toReport();
    first[0]?.samples.push('injected');

    expect(skips.toReport()[0]?.samples).toEqual(['One']);
  });
});
