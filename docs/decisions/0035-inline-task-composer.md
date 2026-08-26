# 0035. Inline Task Composer: One Creation Path at the Foot of the Column, and No Dialog for a Title

**Status:** Accepted
**Date:** 2026-08-26

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0035-inline-task-composer.md)

## Context

[design.md](../design.md) §5 states which interactions are allowed to block the board:
"Confirmations, board creation, and destructive actions stay **dialogs**; those genuinely need to
block." Creating a task is not on that list, and it never was. It has a dialog anyway.

`apps/web/components/task/create-task-dialog.tsx` is 68 lines. It renders a `FormDialog` with one
`Input` bound to `title`, posts `{ title, columnId }` to
`/workspaces/{workspaceId}/boards/{boardId}/tasks`, hands the created `TaskDto` back through
`onCreated` and clears itself. Nothing else is collected. It is mounted from
`apps/web/components/board/board-dialogs.tsx` and driven by `useBoardDialogs`, whose
`createTaskColumnId` is set by the ghost `Add task` button at the foot of every column
(`apps/web/components/board/board-column.tsx`, lines 264 to 275, rendered only when
`canMutateTasks`).

So the board is covered by a scrim, focus is trapped and the surrounding cards are hidden, in
order to read one string that the task panel can already edit. Everything else a task has,
description, priority, due date, estimate, assignees, labels, checklists, attachments, is filled
in the right-side panel afterwards, because the panel is where those fields live
(`task-panel.tsx`, `task-detail-fields.tsx`, `task-metadata-panel.tsx`).

The cost is paid per card, and cards are not created one at a time. Filling a column during
planning means open, type, submit, wait for the dialog to close, click the button again. The
context that makes the next title obvious, the cards already in the column, is exactly what the
modal covers while the title is being typed.

design.md §5 also reserves a set of bare-letter shortcuts for "Phase 4+": `⌘K` command palette,
`C` create task, `/` filter, `?` help. Only `/` is implemented today
(`apps/web/components/board/board-filter-search.tsx`, lines 35 to 51). Deciding how a task is
created therefore also decides what the create shortcut focuses and what a future command palette
is allowed to open, which is why this is a decision record and not an implementation detail.

## Decision

### 1. The `Add task` button becomes the field it opens

Clicking `Add task` replaces the button in place with a single-line text field of the same width,
at the same foot-of-column position. There is no surface, no scrim, no header and no title: the
column keeps its ground, and every card above the field stays visible and clickable.

The field is a form field like any other in this tree, so it takes the field rules unchanged:
`text-base md:text-body` (16px below 768px, 13/18 above it) and a 44px touch target below 768px.
It draws the one `:focus-visible` outline from `@layer base` and adds no ring of its own.

### 2. `Enter` creates and stays, `Escape` and an empty blur return the button

`Enter` creates the task from the trimmed title, appends the card to the column, empties the field
and leaves focus in it. The next title is typed immediately, with no pointer and no second click.

`Escape` closes the composer and returns focus to the `Add task` button. Blurring an **empty**
field does the same. Blurring a field that still has text leaves the composer open: a typed title
is never discarded by a stray click, and the only way to lose one is to clear it.

While the create request is in flight the composer keeps its shape. It does not swap its label for
a pending string; it uses the existing `Button` `loading` state (`aria-busy` plus `disabled`, the
label kept underneath) for any control that has to wait, and the pending state never moves focus
out of the field.

### 3. One extra control, `Open details`, and it opens the panel

Beside the field the composer carries exactly one control: `Open details`. It creates the task
from what is typed and opens the new card's task panel. It is disabled while the field is empty,
because there is no card to open yet. It does not open a dialog, and it is not a second form.

That is the whole answer to "what about the other fields": they are filled where they already live.
The composer collects a title because a title is the only thing a card needs to exist.

### 4. `CreateTaskDialog` is deleted, and nothing replaces it

`apps/web/components/task/create-task-dialog.tsx` is removed, along with its mount in
`board-dialogs.tsx` and the `createTaskColumnId` state in `useBoardDialogs`. No other surface in
the product creates a task. This is the binding half of the decision: not "the board prefers the
composer" but "the composer is the only way", so that there is one set of behaviours to get right,
one place to fix a bug, and no drift between two forms that collect the same field.

### 5. `c` opens and focuses the first column's composer

A bare `c`, with no modifier, opens the composer of the board's first column and puts the caret in
it. The guard is the one the `/` shortcut already uses: the handler returns when `metaKey`,
`ctrlKey` or `altKey` is held, and returns when the event target is an `INPUT`, a `TEXTAREA` or a
`contentEditable` element, so a `c` typed into a field is a letter and not a shortcut. Only then
does it call `preventDefault` and move focus.

This is the letter design.md §5 already reserves for create task. The ADR does not claim a new
key; it maps the reserved one, and what it decides is what that key does, which is to focus the
composer rather than to open anything. design.md writes the letter as `C` in its reserved list;
the key the handler matches is the unshifted `c`, since Shift would make it a modified key. The
rest of the reserved list is untouched.

### 6. A future command palette gets no create-task dialog

When `⌘K` lands, its create-task action focuses the composer, exactly as `c` does. The palette is
a way to reach the one creation path, never a second one. This is stated now, before the palette
exists, because "the palette needs its own quick-add dialog" is the obvious way for the second
path to come back.

## Rationale

- **The dialog was already outside the written rule.** design.md §5 draws the blocking line at
  confirmations, board creation and destructive actions. A create-task modal was never inside it;
  it survived because it was the first thing built, not because a decision put it there. Removing
  it makes the code match the document instead of the document match the code.

- **Creation on a board is repetitive, and modality taxes repetition.** Each card costs an open
  and a close on top of the typing. The composer's `Enter` loop removes both and keeps the cursor
  where the next title goes, so filling a column is one continuous act.

- **The surrounding cards are the input.** What belongs in a column is decided by what is already
  in it. A modal hides precisely that, and hides the card that just appeared, so the user cannot
  see the result of the last create while typing the next.

- **One path is a behaviour budget, not a preference.** Two creation surfaces means two focus
  stories, two pending states, two error states, two sets of message keys and two chances to
  disagree. The keyboard shortcut and the future palette pointing at the same field is what keeps
  that budget at one.

- **The panel is the form.** Every field the composer does not collect is already implemented,
  laid out and permission-checked in the task panel. A second form that collects a subset of them
  would duplicate that work in a place with less room and no room to grow.

- **A reserved letter is only real once something answers it.** design.md §5 has reserved `C` for
  create task since before there was anything for it to open. The composer is what it opens, so
  the ADR that creates the composer is where that reservation stops being a note and starts
  binding.

## Consequences

- **A regression in the composer makes task creation impossible.** There is no dialog left to fall
  back to, and the failure is total rather than degraded. Both paths are therefore covered by
  `e2e/tests/board-composer.spec.ts` (`pnpm test:browser`): the keyboard path (reach `Add task`,
  `Enter`, type, `Enter`, twice over, with focus still in the emptied field and `Escape` handing
  it back to the button) and the pointer path (click `Add task`, type, `Open details`, the panel
  opens on the new task). Both end on a reload, so what is asserted is what the server stored.
  Component tests cannot stand in for this, because what breaks is focus and key handling in a
  real browser.

- **Touch and small screens are inside the decision, not after it.** The field is 16px below 768px
  (which the 360px e2e sweep enforces, and which is what stops iOS from zooming the board on
  focus) and the composer row keeps the 44px touch target. A field that fails either of those is a
  board that cannot be used on a phone, since it is now the only way in.

- **Arrow keys belong to the caret while the composer has focus.** The board is a composite
  widget where `Tab` reaches a column and arrows move within it. A focused text field takes the
  arrow keys for caret movement; the board's roving focus resumes when the composer closes.

- **The message catalogue moves.** The dialog's keys go and the composer's placeholder and
  `Open details` label arrive, in `apps/web/messages/en.json` and `apps/web/messages/tr.json` in
  the same commit. `apps/web/messages/turkish-screens.test.tsx` pins the fifty longest Turkish
  strings with a literal length assertion, so any catalogue change refreshes that list too.

- **Discoverability trades down slightly.** A titled modal announces itself more loudly than a
  text row does. What carries it is that the entry point does not change: the user still clicks
  the same `Add task` button in the same place, and the field appears where the card will.

- **Dialogs keep their remaining scope.** Confirmations, board creation and destructive actions
  still block, per design.md §5. The column and task delete dialogs and the column create and
  settings dialogs are outside this decision and are not touched by it.

## Alternatives considered

| Alternative                                                 | Why not                                                                                                                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep `CreateTaskDialog` as it is                            | Blocks the board and hides the cards that decide what to type, to collect one string the panel can already edit; it also sits outside design.md §5's own list of what may block                   |
| Keep both, dialog and composer                              | Two focus stories, two pending and error states and two sets of message keys for one action, free to drift; the single path is the point of the decision, not a side effect of it                 |
| A lightweight quick-view popover on create                  | Still a layer over the board with its own dismissal and focus-return rules, and it competes with the task panel, which is where every field it could show already lives                           |
| A composer that also collects priority, due date and labels | Rebuilds the panel's fields in a column-width row, doubling the surface that has to stay permission-checked and localised, and slows the case the composer exists for, typing six titles in a row |
| Give the command palette its own quick-add dialog later     | Reintroduces the second path under a new name once the palette ships; deciding it now, while nothing depends on it, costs nothing and closes the door                                             |
