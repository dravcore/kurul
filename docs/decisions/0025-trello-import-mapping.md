# 0025. Trello Import Mapping: Nothing Is Guessed, Everything Missing Is Counted

**Status:** Accepted
**Date:** 2026-08-15

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0025-trello-import-mapping.md)

## Context

The roadmap item this record serves is a one-way Trello JSON import: board, list, card, label
and checklist, with attachments carried as URLs. The scope is deliberately small; what is not
small is the number of places where Trello's model and Kurul's model do not line up, and
where an importer therefore has to either guess or admit it cannot.

Three properties of the input shape every decision below.

**Trello's export schema has no version field and no changelog.** A board exported today and a
board exported next year can differ in field names, in nesting and in which of the optional
arrays are present at all. "The Trello importer works" is therefore a claim about a date and
about the files that were on hand on that date, never a claim about Trello.

**On the date this record was written, no real export was on hand.** The fixtures under
`apps/api/test/fixtures/trello/` are hand-written, and their README says so in its first
paragraph. That is a limitation with a consequence, not a footnote: every field name the
importer reads was written from memory and verified against nothing. The roadmap metric that
asks for validation against three real exports closes as **partial** for exactly this reason,
and reopens when a real export arrives.

**Trello's vocabulary is larger than Kurul's in some places and absent in others.** Trello
has ten label colours; this repository has eight design-token slots. Trello has archived lists
and cards; Kurul has no archive. Trello has members on cards; Kurul's members are rows in
a different tenant's user table. Trello has comments; this import does not carry them.

A mapping under those three conditions can fail in two very different ways. It can be wrong —
it can decide that a column named "Bitti" is a completed column, and be wrong for every board
whose author did not think in the importer's language. Or it can be incomplete — it can drop an
archived card, and be right to. The first kind must not happen. The second kind must happen
loudly.

## Decision

**Nothing about a board's meaning is inferred. Everything that does not come across is counted
and shown to the user in the response body.**

Concretely:

### Structure

| Trello                | Kurul                          | Notes                                                     |
| --------------------- | ------------------------------ | --------------------------------------------------------- |
| board                 | `Board`                        | `name`, `desc` → `description`                            |
| list                  | `Column`                       | always `category: UNSTARTED` — see below                  |
| card                  | `Task`                         | `name` → `title`, `desc` → `description`                  |
| label                 | `Label`                        | colour mapped to a slot, name defaulted if empty          |
| card ↔ label          | `TaskLabel`                    | via `idLabels`                                            |
| checklist             | `Checklist`                    | one row per Trello checklist, never flattened             |
| `checkItem`           | `ChecklistItem`                | `state === 'complete'` → `isDone: true`                   |
| card attachment       | `Attachment` with `kind: LINK` | URL only; the server never fetches it                     |
| card `due`            | `Task.dueDate`                 | `estimatedMinutes` stays `null`, it is not the same field |
| member                | —                              | dropped, counted                                          |
| comment (`actions[]`) | —                              | dropped, counted                                          |
| `closed: true`        | —                              | dropped, counted                                          |

### Column category is never guessed

Every imported column takes the schema default, `UNSTARTED`, without exception, and the report
carries one `(column, defaulted)` row saying how many columns that was.

### Position is read for order and then thrown away

Trello's `pos` decides the order of siblings; the values written into `Column.position` and
`Task.position` come from `rebalancePositions`. Ties, missing values and non-numeric values
(Trello sometimes writes the string `"bottom"`) fall back to the Trello id, whose leading eight
hex digits are a creation timestamp — so the fallback is "the order they were made", not a coin
flip.

### Label colours fold onto eight slots

| Trello colour | Slot     | Light-theme hex of that slot |
| ------------- | -------- | ---------------------------- |
| `blue`        | `slot-1` | `#2a78d6`                    |
| `orange`      | `slot-2` | `#eb6834`                    |
| `green`       | `slot-3` | `#1baf7a`                    |
| `yellow`      | `slot-4` | `#eda100`                    |
| `pink`        | `slot-5` | `#e87ba4`                    |
| `lime`        | `slot-6` | `#008300`                    |
| `purple`      | `slot-7` | `#4a3aa7`                    |
| `red`         | `slot-8` | `#e34948`                    |
| `sky`         | `slot-1` | shares with `blue`           |
| `black`       | `slot-7` | shares with `purple`         |

The `_dark` / `_light` suffixes newer exports write (`purple_dark`, `sky_light`) are stripped
before lookup — they are shade variants of one colour, and this repository has one slot per
colour, not one slot per shade.

An unknown colour name and a `null` colour both land on `slot-1` and both add a
`(label, defaulted)` row to the report. A label with an empty name is given its Trello colour
name as a name (`"green"`), or `"Label"` when it has no colour either, because `Label.name` is
not nullable and something has to be written.

The hex column above is documentation of where the slot numbers came from
(`apps/web/app/globals.css:40-47`), not a value anything stores. `Label.color` stores the slot
name. The same file's dark-theme block at `:95-102` defines the same eight slot names with
different hex values, which is the whole reason the column stores a slot and not a colour.

### The write is atomic; the scope is partial

Board, columns, labels, cards, checklists, items and links are written in one transaction.
There is no half-imported board. What is _in_ that transaction is decided beforehand, in pure
code with no database access: by the time a row reaches the transaction it is known to be
writable, and there is no "this one failed, carry on" inside it.

### The report is the response

`201 Created` returns a `TrelloImportReportDto`: the created board's id and name, one count per
written row type, and a list of skip groups. A group is a `(scope, reason)` pair with a real
count and up to twenty sample names. The count is never capped; only the samples are. The
report is not stored anywhere.

The skip vocabulary is closed: `outOfScope`, `archived`, `unmappable`, `unsupportedScheme`,
`malformed`, `defaulted`. `defaulted` is in that list even though it describes a substitution
rather than a loss, because the question a user asks after an import is not "what did I lose",
it is "why does my board look different", and a defaulted colour is part of that answer.

### The reader reports what it does not understand instead of failing

Because no field name in this import was verified against a real export, the reader's contract
is not "I know Trello's schema" — it is **"I report what I do not know"**. A missing field, a
field of an unexpected type, or an entry the reader cannot represent is dropped into the same
`(scope, reason)` report and reading continues. Only two things are errors: a body that is not
JSON at all, and a root object that does not look like a board export.

### Importing the same export twice produces two boards

There is no deduplication and no update-in-place. The behaviour is nailed by a test and stated
to the user in the import dialog before they choose a file.

### One activity row per import

`board.imported`, once, carrying the counts in its payload — not one `task.created` per card.
It joins the audit subset alongside `board.created`.

## Rationale

### Why the column category is not inferred, at all

[ADR 0019](0019-column-category.md) exists because Kurul used to infer completion from a
column's name, and it names three ways of inferring it and rejects all three:

- **Name matching was removed**, not softened (`0019-column-category.md:51-52`). A user who
  renames "Done" to "Shipped" silently zeroes their completion metrics, and nothing errors.
- **Deriving from position was rejected by name** — "last column is done" (`:113`) — because
  boards legitimately end with "Blocked", "Archive" or "Won't Do".
- **A localized name is not a signal in the first place** (`:25-30`): ADR 0018 seeds default
  column names in the creator's locale, so a Turkish board starts with `Bitti` and never
  matches `'done'` at all.

A Trello export contains no category. The only two signals available are the name and the
position, and both are on that list. So there is nothing left to infer from, and inferring
anyway would be re-adding the defect ADR 0019 removed, in a place where it is _more_ likely to
misfire: a Trello board's column names can be in any language and any wording, whereas ADR
0019's own migration only ever recognized Kurul's own seeded English `Done`. That migration
(`:55-56`) looks like a precedent for name matching and is not one — it matched a known writer's
known output.

The cost of not inferring is real and is paid by the user: after an import, every column is
`UNSTARTED`, so dashboards report no completed work until the user opens column settings. That
surface already exists — ADR 0019 required it (`:95-96`, `column-settings-dialog.tsx`) — and the
report tells the user how many columns are waiting there. A narrowed scope that is reported is
a different thing from a narrowed scope that is not.

### Why there is no idempotency

Deduplication needs a stored external identifier, and the unique scope of that identifier is
genuinely undecidable here. Importing the same Trello board into two different workspaces is
legitimate. Importing it twice into one workspace is also legitimate — that is how someone takes
a copy. A `Board.externalId` column would have to pick one of those to forbid, and neither is
wrong.

"Update the existing board instead" is not a stricter import; it is synchronization. It needs a
conflict policy, a deletion-propagation policy and a direction, and the roadmap line asks for
one-way import.

The lightweight-looking alternative — reject an import whose board name already exists — is
worse than doing nothing, because two boards sharing a name is legal today and this would make
an unrelated existing board block an import.

So the behaviour is: two imports, two boards, disjoint ids, twice the cards. It is nailed by a
test so it cannot drift into an accident, and it is stated in the dialog so it cannot surprise.

### Why archived lists and cards are dropped rather than imported

`closed: true` is Trello's archive. Kurul has no archive, so an archived card can only arrive
as a normal card — that is, as something the user deliberately removed from view, put back in
front of them. A long-lived 500-card board commonly carries several times that many archived
cards behind it, so this is not a rounding error either.

### Why comments are counted rather than silently ignored

Comments live in `actions[]` and are usually the largest part of an export. They are out of the
roadmap line's scope. A user who imports a board and finds no comments would otherwise have to
guess whether the importer failed or never tried; a `(comment, outOfScope)` row with a real
count answers that in the response.

### Why members are dropped

A Trello member is not a Kurul user. The export does not reliably carry an email, and even
when it does, matching on it would mean assigning work to whoever holds that address in this
workspace today. Every row this importer writes records the person who ran the import in
`createdById` / `uploadedById`. That is not a mapping — it is an accountability record, and it
is the honest one.

### Why attachments become links and the server never fetches them

Trello's export gives a URL, often one that needs Trello authentication, not a file. Writing an
`AttachmentKind.LINK` row is the whole of what can honestly be done with it —
[ADR 0024](0024-attachment-kinds-and-serving-policy.md) added that kind for this import
specifically.

The server does not request those URLs, and that is a security decision rather than a
performance one: a "fetch a preview" step is the capability to make the server issue requests to
any address a user names, and a capability like that does not stay confined to one importer once
it exists. Attachment URLs are held to the same rule the rest of the API uses — `http:` and
`https:` only — and anything else is counted as `(attachment, unsupportedScheme)`.

### Why checklists are not flattened

[ADR 0023](0023-checklist-data-model.md) chose a multi-list model per card, and
`0023-checklist-data-model.md:122-127` names this import as a reason. Trello cards routinely
carry several checklists; a single-list model would have forced this importer to concatenate
them and lose the grouping the user made. One Trello checklist is one `Checklist` row.

## Consequences

- **After an import, column categories are wrong until a human fixes them.** Every column is
  `UNSTARTED`, so completion metrics read zero. The report says how many columns and the column
  settings dialog is where they are fixed. This is the deliberate cost of not guessing.
- **A user can import the same file twice and get two boards.** Recovering means deleting one.
- **The report is not stored.** A user who closes the panel without reading it has lost the
  list of what did not come across; the board itself is unaffected. The web shows it as a panel
  that stays until dismissed rather than as a dialog that can be clicked away.
- **Two Trello colours share a slot with two others.** Two labels that were visually distinct in
  Trello can arrive the same colour. The alternative was growing the palette for one importer or
  storing a hex the theme cannot resolve.
- **"The Trello importer works" is a claim about a date.** The fixtures record when they were
  written, and on this date none of them is a real export. The first real export is likely to
  find field names this repository has wrong; the reader is built so that finding them produces
  report rows rather than a failed import, but it will still produce an import that is missing
  things.

## Alternatives considered

| Alternative                                                   | Why not                                                                                                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Infer `COMPLETED` from a column named "done"                  | Exactly the defect ADR 0019 removed (`:51-52`); a Trello column can be named anything in any language, which is worse than the case ADR 0019 was written for              |
| Derive the category from position ("the last column is done") | Rejected by name in ADR 0019 (`:113`); boards legitimately end with "Blocked" or "Won't Do"                                                                               |
| A `Board.externalId` column for idempotency                   | Its unique scope is undecidable — same board into two workspaces is legitimate, and so is twice into one; and dedupe-by-name would let an unrelated board block an import |
| A queue plus an `ImportRun` table                             | Storing the report means a status endpoint, a polling loop and a retention rule — four new surfaces for a one-shot action whose reader is already waiting on the response |
| Write Trello's `pos` values into `position` unchanged         | Seeds a brand-new board with whatever gap pattern the old one drifted into, including gaps already narrowed toward `MIN_GAP`; re-issuing costs nothing                    |
| Import archived lists and cards as normal ones                | Puts back what the user deliberately removed, at several times the volume of the live board                                                                               |
| Map Trello members to users by email                          | The export does not reliably carry one, and matching would assign work to whoever holds that address today                                                                |
| Fetch attachment URLs and store the bytes                     | Gives the server the ability to request any address a user names — an SSRF capability that does not stay confined to the importer (ADR 0024)                              |
| Flatten a card's checklists into one list                     | Discards the grouping the user made, and contradicts the reason ADR 0023 chose a multi-list model (`:122-127`)                                                            |
| Store a raw hex for an unmapped Trello colour                 | `Label.color` stores a theme-resolved slot; a hex cannot be resolved by the dark theme, which defines the same slots at different values                                  |
| Reject the whole file when a field is missing or oddly typed  | No field name here was verified against a real export, so this would turn every schema drift into a total failure instead of a report row                                 |

## Amendment (2026-08-26): field length ceilings and a row cap (SEC-04)

An audit finding (SEC-04) noted that this importer skipped the length checks every other write path
applies. `Task.title`, `Task.description`, `Board.name`, `Board.description`, `Checklist.title`,
`Column.name`, `Label.name`, `ChecklistItem.content` and `Attachment.url` all reach the database
through `CreateTaskDto`, `CreateBoardDto`, `CreateChecklistDto`, `CreateColumnDto`,
`CreateLabelDto`, `CreateChecklistItemDto` and `CreateAttachmentDto` on every other route, and each
of those decorates its field with `@MaxLength`. The planner wrote `card.name`, `card.desc`, the
export's own board name and description, `checklist.name`, `list.name`, `label.name`, a check item's
`name` and an attachment's `url` straight through with no such ceiling, so a Trello export was the
one door into this database those decorators did not guard. Nothing in the export was malicious to
write this way; the risk was a board nobody could scroll and a database column holding more than the
product ever intended one to hold.

`trello-import-planner.ts` now clamps every one of those fields to the same constant the DTO uses.
Each pair of DTOs (create and update) imports its ceiling from one file next to it, six files in all
(`task/dto/task-limits.ts`, `board/dto/board-limits.ts`, `board/dto/column-limits.ts`,
`label/dto/label-limits.ts`, `task/dto/checklist-item-limits.ts` and
`attachment/dto/attachment-limits.ts`), and the planner imports the same six, so each number exists
once. A task title or description that was cut is reported as one `(card, defaulted)` row, the same
reason a substitution already uses elsewhere in this report (an unknown label colour, a defaulted
column category): the card still imports, and the question the report answers is "why does my board
look different", which a clamp answers as well as a colour substitution does. A checklist title or a
checklist item's content that was cut is reported the same way, under `(checklist, defaulted)` and
`(checklistItem, defaulted)`. A label name that was cut folds into the same `(label, defaulted)` row
an unknown colour already produces, for the reason the Decision table gives for combining them: a
label the user does not recognise is one problem, however many of its fields changed. An attachment
URL that was cut is reported under `(attachment, defaulted)`. A column's name shares its report row
with the category default every imported column already gets (`(column, defaulted)`, count equal to
the number of columns): a second, separate row for the same column would double-count it, so the
clamp changes what that row's sample text can say rather than adding a row of its own. The board's
own name and description are clamped silently: there is no `board` scope in the closed vocabulary
above, a board is one row rather than a class of rows, and a `(board, defaulted)` line that could
only ever say "1" would answer nothing a user could act on, the same reasoning `trello-export.ts`
already applies to the board's own description when it is unusable.

The same ceiling also bounds the _report_, not only the write. A row the planner drops rather than
writes (an archived list or card, a card pointing at a label id the export does not contain, a
rejected attachment, a checklist left off because its card was dropped) still quotes a name as a
sample in the response body, and that name comes from the export, unclamped, just like the fields
above. Every one of those sample sites now clamps or cleans its text the same way the row it
describes would have (the accepted card's own already-clamped title, in the label-id case;
`safeDisplayName` for a rejected attachment; the column/checklist ceilings for a dropped list or
checklist), so a report about an oversized field cannot itself carry an unbounded string back to the
caller, on any path.

A second gap the same finding named: nothing bounded how many rows an export could ask this API
to plan. `TRELLO_IMPORT_MAX_BYTES` bounds the parsed object graph's size, not the row count, and
a small card can be a few dozen bytes, so a 20 MiB export can still be several hundred thousand
tiny cards. `TrelloImportService` now checks the export's raw `lists.length` and `cards.length`
against `TRELLO_IMPORT_MAX_CARDS` (default 50000) and `TRELLO_IMPORT_MAX_LISTS` (default 5000)
before the planner runs and before the transaction opens; an export over either cap answers `400`
and writes nothing. The counts are taken before archived or malformed entries are filtered out,
because the cost these ceilings exist for (heap held by the parsed graph, and the length of the
writer's `createMany` sequence) is paid for every row Trello wrote, not only the ones that end up
importable.

`readTrelloImportMaxCards` and `readTrelloImportMaxLists` throw a plain `Error` on a
misconfigured value, the same convention `readTrelloImportMaxBytes` already used: a bad value is
a `500` on the next import, not a refusal to boot. That is a deliberate departure from ADR 0032's
plan-limit ceilings, which refuse at startup instead, because those are read once by
`readInstancePlanLimits()` at boot and never again, while every import limit here is already
read per request for the reason given in `import-config.ts` (a test, or an operator restart, must
see the value that is actually set). Boot-time validation was not added for these two alongside
it, so a misconfigured `TRELLO_IMPORT_MAX_CARDS` fails the same way its byte-ceiling sibling
already did rather than gaining a new failure mode of its own.

Neither change touches the Decision section above: the skip vocabulary is unchanged, the
structure table is unchanged, and the write is still one atomic transaction over a plan built
with no database access.
