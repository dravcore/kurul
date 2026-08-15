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
against it and **the export wins, not this repository**.

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
| `edge-unknown-shape.json`   | 2026-08-15 | Right root, wrong everything else: a number inside `lists`, `labels` as an object, a card that is a string, `pos: "bottom"`, `idLabels` as a string, an attachment with no `url`, `checkItems` as a string, `members` as a string, `actions` as an object           | no    |
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

`edge-truncated.json` is listed in the repository's `.prettierignore`, because it is invalid JSON
on purpose and `prettier --check` would otherwise fail on it. That entry is load-bearing: if
someone "fixes" the file so the formatter is happy, the test that proves a half-downloaded export
answers 400 instead of crashing starts passing for the wrong reason.
