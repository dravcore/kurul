# Trello export fixtures

**None of these files is a real Trello export.** Every one of them was hand-written in this
repository on 2026-08-15, from memory of Trello's export format, and checked against nothing. Do
not read a passing test in this directory as evidence that the importer handles Trello's actual
output — it is evidence that the importer handles what we believed Trello's output looks like.

That distinction is the whole reason this file opens with it. Trello's export schema carries no
version field and no changelog, so "the Trello importer works" is a claim about a date and about
the files that were on hand on that date. On this date, no real export was on hand: the person
running this project had no Trello data to export, and an agent cannot open a Trello account.
Calling an invented JSON file `real-1.json` would have made the fixtures measure our own
imagination and then labelled the result "validated".

The roadmap metric that asks for validation against three real Trello exports therefore closes
as **partial**, with that reason stated. It reopens the first time a real export arrives — from
the maintainer or from a community bug report — at which point every field name below is checked
against it and **the export wins, not this repository**. The place for that export, once
anonymised, is [`real/`](real/README.md); see [Real exports](#real-exports) below.

## What the importer does about that

Because no field name was verified, the reader's contract is not "I know Trello's schema" — it is
**"I report what I do not know"** (`apps/api/src/import/trello-export.ts`,
[ADR 0025](../../../../../docs/decisions/0025-trello-import-mapping.md)). A missing field, a field
of an unexpected type, or an entry the reader cannot represent is dropped into the import's
`(scope, reason)` report and reading continues. Only two things are errors: a body that is not
JSON at all, and a root object that does not look like a board export.

`edge-unknown-shape.json` exists to hold that contract still. It is the fixture a schema drift
would look like, and the tests that read it assert both halves: the readable rows come across,
_and_ the unreadable ones are reported rather than thrown.

## The fixtures

| Fixture                     | Written    | What it is                                                                                                                                                                                                                                                          | Real? |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `synthetic-full-board.json` | 2026-08-15 | Four lists (one archived), six cards (one archived, one unnamed), five labels (one unnamed, one uncoloured, one unknown colour), three checklists across two cards, three attachments (http, https, `file:`), two comments plus one non-comment action, two members | no    |
| `edge-empty-board.json`     | 2026-08-15 | A board with no lists and no cards                                                                                                                                                                                                                                  | no    |
| `edge-empty-list.json`      | 2026-08-15 | One list, no cards in it                                                                                                                                                                                                                                            | no    |
| `edge-unknown-color.json`   | 2026-08-15 | Labels coloured `tangerine`, `null` and `sky_light`                                                                                                                                                                                                                 | no    |
| `edge-unknown-shape.json`   | 2026-08-15 | Right root, wrong everything else — see the list below                                                                                                                                                                                                              | no    |
| `edge-card-export.json`     | 2026-08-15 | Trello's _card_ export — valid JSON, has a `name`, is not a board                                                                                                                                                                                                   | no    |
| `edge-truncated.json`       | 2026-08-15 | A valid export cut off mid-object; **deliberately not valid JSON**                                                                                                                                                                                                  | no    |

`synthetic-full-board.json` is not an edge case and is not named like one. With the `real-*`
fixtures cancelled it is the only fixture describing an ordinary board, so the mapping tests run
against it — which means its shortcomings are the mapping tests' shortcomings, and they are the
shortcomings listed in the first paragraph.

A few things in it are deliberate rather than incidental, because a test depends on each:

- **The lists are not in `pos` order in the file.** `Backlog` (16384) is written after
  `In Progress` (32768). A reader that returned the array untouched and a reader that sorted it
  would otherwise be indistinguishable.
- **`pos` values are Trello-sized** (16384, 32768, 65535) and nowhere near this repository's
  `POSITION_GAP` of 1000, so a test can tell a re-issued position from a carried-over one by
  looking at the number.
- **One attachment URL is `file:`.** It must never become an `Attachment` row.
- **One action is not a `commentCard`.** The comment count has to be a count of comments, not a
  count of actions.
- **One label has an empty name and one has no colour**, which are the two cases ADR 0025 has to
  invent a name and a colour for.

## What is wrong inside `edge-unknown-shape.json`

Every entry in it exists because a mutation of the reader survived without it — that is, because
the reader could be broken in that specific way and every test stayed green. The fixture grew
during that exercise rather than being designed up front, and it is worth keeping in that order:
each row below is a bug the suite could not previously see.

- A bare number where a list should be, and a list with no `id` at all.
- A list whose `name` is an array **and** whose `closed` is a string — the entry that proves the
  reader counts unreadable _entries_ and not unreadable _fields_.
- A list whose only problem is `closed: "true"`. Without it, a `closed` check that silently
  coerced went unnoticed, and an archived list arriving as a live column is a wrong import rather
  than an incomplete one.
- `pos: "bottom"` on a list that is otherwise fine, which must **not** be reported: ADR 0025
  already decided that a non-numeric `pos` falls back to id order.
- `labels` as an object, `members` as a string, `actions` as an object — three whole sections
  disappearing, one report row each.
- A card whose `idLabels` is a string, a card carrying an attachment with no usable `url`, a card
  whose `due` is an epoch number rather than an ISO string, and an entry that is a bare string.
  The `due` one is there because a nullable field that swallows a wrong type is the quietest
  failure in the reader: the user loses a due date and hears nothing.
- A checklist with one unreadable item (reported as an item, so the readable items survive) and a
  checklist whose `checkItems` is a string (reported as a checklist).

`edge-truncated.json` is listed in the repository's `.prettierignore`, because it is invalid JSON
on purpose and `prettier --check` would otherwise fail on it. That entry is load-bearing: if
someone "fixes" the file so the formatter is happy, the test that proves a half-downloaded export
answers 400 instead of crashing starts passing for the wrong reason.

## Real exports

The `v0.3.0` gate asks for at least two anonymised real exports importing end to end
(`ROADMAP.md`, Hardening track). The harness for that is in place; the exports are not.

**Where they go.** [`real/`](real/README.md). `trello-import-real.e2e-spec.ts` reads every `*.json`
in that directory at module load and imports each one through `POST /workspaces/:id/imports/trello`
as an admin, deriving the expected counts from the file by ADR 0025's rules and comparing them with
the report and with the database. While the directory is empty the spec reports exactly one skipped
test, `no anonymised real Trello exports in fixtures/trello/real yet (v0.3.0 gate)`, so CI shows the
gate is open.

**How to produce one.**

1. In Trello, open the board menu: **More**, **Print and export**, **Export as JSON**.
2. `node scripts/anonymise-trello-export.mjs ~/Downloads/board.json apps/api/test/fixtures/trello/real/<name>.json --seed <anything>`.
   The script keeps the export's structure byte for byte (keys, order, lengths, nulls, numbers,
   dates, colours, `closed` flags, id relationships) and replaces every piece of text with a
   deterministic pseudonym of the same length and shape. Trello ids keep their eight-character
   timestamp prefix and their sort order, because the planner ties on them.
3. Read the summary it prints: unrecognised top-level keys and strings replaced under keys the
   script did not know to carry text were anonymised as text, which is safe but may have changed a
   non-text value's shape. Skim the file once before pushing it; it is public from then on.
4. Run `pnpm --filter @kurul/api test:e2e`, read what fails, and record it below.

`real/*.json` is listed in `.prettierignore` on purpose: those files are the script's output, byte
for byte, and reformatting them would make "the file the script wrote" and "the file in the repo"
two different things.

The guard that the anonymiser changes nothing the importer reads runs on every CI run regardless:
the same spec anonymises `synthetic-full-board.json` through the CLI and asserts the two imports
produce the same report and the same board, shape for shape.

### Field-mapping diffs

One row per place where a real export disagreed with what the synthetic fixtures assume. Filled in
as the exports arrive; the first row is the instruction.

| Field                | Synthetic fixture assumption                                                                            | What the real export showed                                                                         | Importer change needed                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| _(replace this row)_ | Quote the assumption: the key name, type or value the synthetic fixtures and `trello-export.ts` rely on | What the anonymised export actually carries, with the file name and the path (`cards[].badges.due`) | `none` when the reader already coped, otherwise the PR that fixed it |
