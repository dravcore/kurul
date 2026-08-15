#!/usr/bin/env node
/**
 * Generates a large synthetic Trello board export, for measuring the importer's write path.
 *
 * ## What this fixture measures, and what it does not
 *
 * It measures the **write path** — parse, plan, one transaction, thousands of rows. It says
 * nothing about schema fidelity: every field in it was written by this script, from this
 * repository's own idea of what Trello writes. Reporting "verified against real Trello exports"
 * on the strength of this file would be the measurement grading its own homework.
 *
 * There is no real-export fixture to fall back on either — see
 * `apps/api/test/fixtures/trello/README.md`, which records that no real Trello export was
 * available and that the roadmap's fidelity metric closes `partial` because of it. So this file's
 * limitation is not "the good fixtures are elsewhere"; it is that nothing anywhere in this
 * repository has been checked against Trello's actual output.
 *
 * ## Why the output is not committed
 *
 * Not a `.gitignore` accident — a decision. A 500-card export is a megabyte of JSON that only one
 * measurement ever reads, and putting it in version control would make every clone of this
 * repository carry a measurement input forever. The generator is the artefact worth keeping; the
 * bytes are reproducible from it, which is what `--seed` is for.
 *
 * ## Determinism
 *
 * The same `--seed` produces the same bytes, so two measurements taken a week apart are
 * measurements of the same input. `Math.random()` would have made every run a slightly different
 * board, and a duration is only comparable to another duration over the same work. The generator
 * is a 32-bit xorshift — small, seedable, and entirely adequate for choosing which of eight label
 * ids goes on a card. It is not, and must not be used as, a source of randomness for anything
 * that matters.
 *
 * ## Usage
 *
 *     node scripts/generate-trello-fixture.mjs --cards 500 --lists 8 --labels 12 \
 *       --checklists-per-card 2 --items-per-checklist 5 --attachments-per-card 1 \
 *       --seed 20260815 --out /tmp/trello-500.json
 */
import { writeFileSync } from 'node:fs';
import process from 'node:process';

const DEFAULTS = {
  cards: 500,
  lists: 8,
  labels: 12,
  'checklists-per-card': 2,
  'items-per-checklist': 5,
  'attachments-per-card': 1,
  comments: 200,
  members: 12,
  /** Archived cards *on top of* `--cards`, so `--cards` is the number that gets imported. */
  'archived-cards': 50,
  seed: 20260815,
  out: '',
};

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (!(key in DEFAULTS)) throw new Error(`Unknown option: --${key}`);
    const raw = argv[index + 1];
    if (raw === undefined) throw new Error(`--${key} needs a value`);
    index += 1;
    options[key] = key === 'out' ? raw : Number(raw);
    if (key !== 'out' && !Number.isInteger(options[key])) {
      throw new Error(`--${key} must be a whole number, got "${raw}"`);
    }
  }
  if (options.out === '') throw new Error('--out is required');
  return options;
}

/** xorshift32. Seeded, deterministic, and deliberately not cryptographic — see the header. */
function makeRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/**
 * A Trello-shaped object id: 24 lowercase hex characters, the first eight a creation timestamp.
 *
 * The shape matters to the thing being measured. The planner's tie-breaking sort falls back to
 * the Trello id when two siblings share a `pos`, and it does so *because* the leading digits are
 * a timestamp. An id of `card-17` would have been readable and would have quietly changed the
 * ordering work the measurement is timing.
 */
function idFactory(seedMillis) {
  let counter = 0;
  return () => {
    counter += 1;
    const timestamp = Math.floor(seedMillis / 1000 + counter / 64)
      .toString(16)
      .padStart(8, '0')
      .slice(-8);
    return `${timestamp}${counter.toString(16).padStart(16, '0')}`;
  };
}

/** The colour names ADR 0025's table knows about, plus one it does not (`tangerine`). */
const COLORS = [
  'green',
  'yellow',
  'orange',
  'red',
  'purple',
  'blue',
  'sky',
  'lime',
  'pink',
  'black',
  'purple_dark',
  'tangerine',
];

const WORDS = [
  'board',
  'column',
  'card',
  'label',
  'checklist',
  'import',
  'export',
  'position',
  'workspace',
  'attachment',
  'retention',
  'activity',
];

function phrase(random, count) {
  const parts = [];
  for (let index = 0; index < count; index += 1) {
    parts.push(WORDS[Math.floor(random() * WORDS.length)]);
  }
  return parts.join(' ');
}

function build(options) {
  const random = makeRandom(options.seed);
  const nextId = idFactory(Date.UTC(2026, 0, 1));

  const lists = Array.from({ length: options.lists }, (_, index) => ({
    id: nextId(),
    name: `List ${index + 1} — ${phrase(random, 2)}`,
    closed: false,
    color: null,
    // Trello-sized and deliberately out of file order: the importer sorts by `pos` and re-issues
    // its own positions, and a file already in order could not tell a sorted reader from a lazy
    // one.
    pos: (options.lists - index) * 16384,
    subscribed: false,
  }));

  const labels = Array.from({ length: options.labels }, (_, index) => ({
    id: nextId(),
    idBoard: 'board',
    name: index % 5 === 0 ? '' : `Label ${index + 1}`,
    color: COLORS[index % COLORS.length],
    uses: index,
  }));

  const cards = [];
  const checklists = [];

  const makeCard = (index, closed) => {
    const cardId = nextId();
    const list = lists[index % lists.length];
    const attachments = Array.from({ length: options['attachments-per-card'] }, (_, slot) => ({
      id: nextId(),
      bytes: null,
      date: '2026-08-01T00:00:00.000Z',
      idMember: null,
      isUpload: false,
      mimeType: null,
      name: `Attachment ${slot + 1}`,
      pos: (slot + 1) * 16384,
      // `example.invalid` by RFC 2606: a host that cannot resolve, so a server that started
      // fetching these would be measurably slower rather than quietly successful.
      url: `https://example.invalid/files/${cardId}/${slot}`,
    }));

    const cardLabels = [];
    const labelCount = Math.floor(random() * 3);
    for (let slot = 0; slot < labelCount; slot += 1) {
      const label = labels[Math.floor(random() * labels.length)];
      if (!cardLabels.includes(label.id)) cardLabels.push(label.id);
    }

    cards.push({
      id: cardId,
      name: `Card ${index + 1} — ${phrase(random, 4)}`,
      desc: phrase(random, 20),
      closed,
      due: index % 3 === 0 ? '2026-10-01T12:00:00.000Z' : null,
      dueComplete: false,
      idBoard: 'board',
      idList: list.id,
      idLabels: cardLabels,
      idMembers: [],
      idShort: index + 1,
      pos: (index + 1) * 1024,
      shortLink: cardId.slice(0, 8),
      url: `https://trello.com/c/${cardId.slice(0, 8)}`,
      attachments,
    });

    if (closed) return;

    for (let slot = 0; slot < options['checklists-per-card']; slot += 1) {
      checklists.push({
        id: nextId(),
        name: `Checklist ${slot + 1}`,
        idBoard: 'board',
        idCard: cardId,
        pos: (slot + 1) * 16384,
        checkItems: Array.from({ length: options['items-per-checklist'] }, (_, item) => ({
          id: nextId(),
          name: `Item ${item + 1} — ${phrase(random, 3)}`,
          nameData: null,
          pos: (item + 1) * 16384,
          state: item % 2 === 0 ? 'complete' : 'incomplete',
          due: null,
          idMember: null,
        })),
      });
    }
  };

  for (let index = 0; index < options.cards; index += 1) makeCard(index, false);
  for (let index = 0; index < options['archived-cards']; index += 1) {
    makeCard(options.cards + index, true);
  }

  return {
    id: nextId(),
    name: `Measurement board (${options.cards} cards, seed ${options.seed})`,
    desc: 'Generated by scripts/generate-trello-fixture.mjs. Not a real Trello export.',
    closed: false,
    url: 'https://trello.com/b/measurement',
    lists,
    labels,
    cards,
    checklists,
    members: Array.from({ length: options.members }, (_, index) => ({
      id: nextId(),
      fullName: `Member ${index + 1}`,
      initials: `M${index + 1}`,
      username: `member${index + 1}`,
    })),
    actions: Array.from({ length: options.comments }, (_, index) => ({
      id: nextId(),
      idMemberCreator: null,
      type: index % 4 === 3 ? 'updateCard' : 'commentCard',
      date: '2026-08-01T00:00:00.000Z',
      data: { text: phrase(random, 12) },
    })),
  };
}

const options = parseArgs(process.argv.slice(2));
const board = build(options);
const json = JSON.stringify(board);
writeFileSync(options.out, json, 'utf8');
process.stdout.write(
  `wrote ${options.out} — ${board.cards.length} cards ` +
    `(${options.cards} live, ${options['archived-cards']} archived), ` +
    `${board.lists.length} lists, ${board.checklists.length} checklists, ` +
    `${Buffer.byteLength(json, 'utf8')} bytes, seed ${options.seed}\n`,
);
