# Design

The visual and interaction language of the Kurul web app: principles, tokens, layout, motion, states, and copy.

> 🌐 English (canonical) | [Türkçe](tr/design.md)

## Contents

- [1. Design principles](#1-design-principles)
- [2. Identity](#2-identity)
- [3. Design tokens](#3-design-tokens)
- [4. Layout and density](#4-layout-and-density)
- [5. Interaction patterns](#5-interaction-patterns)
- [6. States](#6-states)
- [7. UI writing](#7-ui-writing)
- [8. Charts and dashboard](#8-charts-and-dashboard)
- [9. Accessibility](#9-accessibility)
- [10. Cross-references](#10-cross-references)

> **Status.** Colour, type, and spacing tokens below are **validated in product**
> (`apps/web/app/globals.css`). Interaction patterns that are still aspirational are called
> out inline; do not treat every sentence as shipped behaviour.

## 1. Design principles

1. **Density with breathing room.** A board is a working surface. Rows are compact and the air
   goes _between_ groups, never inside them — 36px rows, 300px columns, four cards on a
   laptop. Not Trello-airy, not Jira-cramped.
2. **Keyboard-first, pointer-equal.** Every interaction has a keyboard path, drag and drop
   included. Focus is always visible and never trapped where it does not belong.
3. **One signature, quiet surroundings.** Exactly one element carries the identity (§2);
   everything else is disciplined neutrals. What does not help someone find, move, or decide
   about work gets cut.
4. **Both themes are first-class.** Dark is _selected_, not derived. Every color goes through
   a token; a raw hex in a component is a defect ([coding-standards.md](coding-standards.md#styling)).
5. **States are direction, not mood.** Empty screens invite an action, errors say what
   happened and what to do next, loading looks like the thing that is loading.
6. **Strings are design material.** Copy is designed like spacing, written from the user's
   side of the screen, and ships through the i18n layer from day one (§7).

## 2. Identity

Kurul is named for the council that convenes, decides, and divides the work — and, until
v0.2.0, for the _kurultay_ that gave the project its first name: the grand assembly where
clans gather, banners are planted, matters are decided. The identity still comes from _that_
world — banner (_sancak_), seal (_damga_), steppe — not from generic productivity-tool
language. The name got shorter; the visual language did not change.

**Signature element — the sancak rail:** a 2px copper rule on the leading edge of whatever is
currently in play (active sidebar item, focused column, selected card, the open panel's
leading edge, the insertion point during a drag). It is the only place the signature color
appears at full strength in the app chrome, and it _moves_, sliding between positions rather
than blinking. Chosen over a colored header or tinted background because it costs no layout,
survives at 36px row height, reads instantly in a dense column — and is literally the banner
planted where the assembly is meeting. On the board, the selected task card is an exception: its
rail is fixed to the card's own left edge instead of sliding between cards, and the sidebar's
moving rail is unchanged.

Copper works at two power levels, and mixing them up is the defect this phase found and fixed.

**Full strength** (`--primary` and `--signature` share one hex per theme) is the app's rarest
color: **at most two uses per screen**, the sancak rail plus, on a view that has one, its single
primary action button. Two things are exempt from that count rather than a third use of it. The
**focus ring** is full strength too, but it is singular and transient by construction: on exactly
one element, only for as long as that element holds focus, so it never stands beside the rail as
a second mark, it replaces whatever mark that element already carried. And a **data mark** (a
meter fill, a progress fill, the chart's one `--signature` **emphasis** series, §8) draws full
strength because it _is_ the value being shown, not chrome describing the screen around it, so a
settings page can carry a copper progress bar next to its one copper Invite button without
spending a third chrome use.

**Tint** (`--signature-subtle`) never reaches full strength and never joins that budget either,
but it is not free decoration: it is bound to exactly one role, **active or selected**, on
whatever row, card, drop-target column or panel currently holds that state. A screen may tint
several elements this way at once, every selected row in a multi-select, without spending the
two-use budget, because tint marks state, not identity.

| Signature copper may appear                                                                                   | Must not appear                                   |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| The sancak rail (active / selected / drop target)                                                             | Page or section backgrounds, headers, hero washes |
| The view's one primary action button                                                                          | Secondary and tertiary buttons                    |
| The focus ring, exempt as above · meter, progress fills and the chart's emphasis series, exempt as data marks | Card borders, dividers, table headers             |
| Links inside body copy                                                                                        | Labels, priority badges, status badges, avatars   |
| Wordmark and empty-state marks                                                                                | Charts, except as the single **emphasis** series  |

Two rules hold at either power level. **No colored text sits on a tinted ground**: a tinted row
or drop-target column carries its meaning in a dot or an icon, never in a colored label laid over
the tint (§8 states the identical rule for chart legends: "text wears text tokens, never the
series hue"). And **copper text never sits on `--accent`**: it measures 4.28:1 there in light
mode (§3), a number that would clear AA on its own, but the rule is written as a ban rather than
a floor, because `--accent` is chrome's own hover step, and copper on it reads as identity
leaking into furniture rather than as a link.

If two full-strength marks are visible at once and they are not the rail and that view's one
primary action, one is wrong.

| Iconography                                    | Rule                                                                                                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wordmark, empty states, auth and marketing art | **Damga-inspired marks** — geometric single-stroke tamga forms on a 24px grid, 1.5px stroke, one per surface, max 96px. Hand-authored SVG; never a product icon. |
| All product UI                                 | **lucide** (ships with shadcn/ui) — 16px in dense rows, 20px in the sidebar, 1.5px stroke, `currentColor` only                                                   |

**Anti-brief.** Deliberately _not_: warm-cream ground with a serif and terracotta accent;
near-black with an acid accent; broadsheet hairlines at zero radius. Kurul's neutrals run
cool green-gray precisely so the warm copper has something to sit against — warm accent on
warm ground is both the current default look and a way to make the accent vanish.

## 3. Design tokens

Proposals for Phase 3, named to the shadcn/ui CSS-variable convention so `components/ui/`
stays unmodified generated output. **Caution:** in shadcn's vocabulary `--primary` is the
brand action color and `--accent` is the subtle hover surface, so Kurul's signature copper
is `--primary` and `--accent` stays a quiet neutral tint. Do not rename shadcn's variables.

### Neutrals and accent

A low-chroma green-gray ("felt") ramp. Light mode's canvas is a step of gray and cards are
white, so elevation reads without shadows.

| Role                                                                 | Token                           | Light                  | Dark                  |
| -------------------------------------------------------------------- | ------------------------------- | ---------------------- | --------------------- |
| Canvas                                                               | `--background`                  | `#F7F8F7`              | `#131715`             |
| Column ground                                                        | `--muted`                       | `#F1F3F1`              | `#1A1E1C`             |
| Card surface                                                         | `--card`                        | `#FFFFFF`              | `#212523`             |
| Popover surface                                                      | `--popover`                     | `#FFFFFF`              | `#272B29`             |
| Hover step (drag preview stays the card surface, `--elevation-drag`) | `--accent`, `--secondary`       | `#EAEDEA`              | `#2F3331`             |
| Border · border-strong (`--input` reads `--border-strong`)           | `--border` · `--border-strong`  | `#D6DAD8` · `#7D8481`  | `#3A403D` · `#767D7A` |
| Text, primary                                                        | `--foreground`                  | `#191C1B`              | `#E8ECEA`             |
| Text, secondary                                                      | `--foreground-secondary`        | `#545A57`              | `#BCC3BF`             |
| Text, muted                                                          | `--muted-foreground`            | `#626965`              | `#98A09C`             |
| Text, disabled / placeholder                                         | `--foreground-disabled`         | `#7F8683`              | `#7B837F`             |
| Primary action surface · hover                                       | `--primary` · `--primary-hover` | `#A85A28` · `#964F23`  | `#D98A4E` · `#E0955B` |
| Text on primary                                                      | `--primary-foreground`          | `#FFFFFF`              | `#131715`             |
| Rail, focus ring, link                                               | `--signature`, `--ring`         | `#A85A28`              | `#D98A4E`             |
| Signature tint (selected row, drop zone)                             | `--signature-subtle`            | `#F2E6DA`              | `#37291D`             |
| Destructive action hover                                             | `--destructive-hover`           | `#B0241C`              | `#B8524A`             |
| Dialog and drawer backdrop                                           | `--overlay-scrim`               | `rgb(25 28 27 / 0.38)` | `rgb(5 7 6 / 0.7)`    |

Text worst-surface ratios, named to the surface each measures worst on
(`app/globals.contrast.test.ts`): light `--foreground` 14.0:1, `--foreground-secondary` 5.8:1 and
`--muted-foreground` 4.6:1, all worst on `--signature-subtle`; dark `--foreground` 10.8:1,
`--foreground-secondary` 7.1:1 and `--muted-foreground` 4.8:1, all worst on `--accent`. Copper as
running text clears every surface but two, both light, both a recorded exemption rather than a
floor moved: 4.28:1 on the hover step, where no call site draws copper text, and 4.11:1 on the
signature tint, forbidden outright (below); dark clears all six, 4.70:1 worst on `--accent`. As a
fill, `--primary-foreground` on `--primary` carries white at 5.05:1 in light and ink at 6.63:1 in
dark, the same number dark reads on the canvas since `--primary-foreground` and `--background`
share one hex there.

`--signature-subtle` never carries copper (`--primary`, `--signature`) text: the exemption above
is the rule, not a design allowance, and `app/globals.contrast.test.ts` rescans every call site on
each run to keep it that way. Neutral `--foreground` text is allowed and is measured against it
like any other surface, 14.0:1 in light and 11.8:1 in dark.

### Semantic scales — status and priority

One reserved severity family serves both, always shipped with an **icon and a word**, never
color alone. Priority is an ordered scalar kept separate from labels; its order is carried by
escalating chroma, so it survives colorblindness, grayscale print, and being described aloud.

| Meaning                        | Priority | Token                                 | Light     | Dark      | Contrast on `--card`, L / D | Icon           |
| ------------------------------ | -------- | ------------------------------------- | --------- | --------- | --------------------------- | -------------- |
| Neutral / inactive             | `LOW`    | `--priority-low`                      | `#6B726E` | `#8A928E` | 4.9 / 4.9                   | `chevron-down` |
| Info                           | `MEDIUM` | `--status-info`, `--priority-medium`  | `#3F6B99` | `#6BA3E8` | 5.6 / 5.9                   | `minus`        |
| Good / done                    | -        | `--status-good`                       | `#1D7349` | `#3FBF85` | 5.8 / 6.7                   | `check`        |
| Warning / due soon             | `HIGH`   | `--status-warning`, `--priority-high` | `#8A5A00` | `#D9A227` | 5.9 / 6.8                   | `chevron-up`   |
| Danger / overdue / destructive | `URGENT` | `--status-danger`, `--destructive`    | `#C0281F` | `#F47A73` | 5.9 / 5.8                   | `chevrons-up`  |

Priority renders as a full-chroma icon plus text; labels render as a tinted chip with a
colored dot — different weights, so a red priority and a red label never read alike.
`Label.color` stores a **slot name** (`slot-1`…`slot-8`), never a hex, so a label's chip and
its bar in a chart are one identity resolved per theme (§8).

### Typography — proposal

Open-source, self-hostable, complete Latin Extended-A: Turkish (`ı İ ğ ş ç ö ü`) must render
correctly since it is the first translation pack — a requirement that eliminated most of the
fashionable display faces. All three are self-hosted at build time via `next/font/google`
(Next downloads and embeds the files — equivalent to `next/font/local` without committing
binary font assets to the repo). The three faces' `next/font` `.variable` classes live on
`<html>`, not `<body>`: the token stacks that reference them (`--font-sans`, `--font-display`,
`--font-mono` in `app/globals.css`) resolve their `var()` calls on `:root`, and a custom
property resolves only against the element that defines it, so a variable placed on `<body>`
falls straight through to the fallback fonts.

| Role      | Face                                                       | Where                                                                     | Why this one                                                                                                                                                                                                                             |
| --------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display   | **Fraunces** (variable, OFL), `WONK 0 SOFT 0`, high `opsz` | Wordmark, auth, marketing, empty-state headlines. Never inside the board. | High-contrast and carved rather than calligraphic — it reads like something stamped into a seal, which is the _damga_ register. Its axes let us dial the quirk to zero and keep only the engraving.                                      |
| Body / UI | **Archivo** (variable, OFL)                                | Everything in the product                                                 | A signage grotesque: tall x-height, economical widths, legible at 12–13px. A board is hundreds of short strings in narrow columns — a signage problem. Chosen over Inter and Geist, which are correct but read as the framework default. |
| Mono      | **JetBrains Mono** (OFL), `0.92em`                         | Ids, shortcuts, code                                                      | Unambiguous `0/O` and `1/l/I` — a UUIDv7 legibility tool, not a style choice                                                                                                                                                             |

| Step                   | Size / line       | Weight    | Use                                                                      |
| ---------------------- | ----------------- | --------- | ------------------------------------------------------------------------ |
| `display`              | 40 / 44           | 600       | One per auth or marketing screen                                         |
| `title-lg` · `title`   | 20 / 28 · 16 / 24 | 600       | Page and panel titles · section and dialog titles                        |
| `read`                 | 14 / 21           | 400       | Long-form prose: task description, comment body, import report sentences |
| `body` · `body-strong` | 13 / 18           | 400 · 550 | **UI baseline** — fields and rows · card titles, active nav              |
| `small` · `micro`      | 12 / 16 · 11 / 14 | 400 · 500 | Metadata, timestamps · chips, counts, axis ticks                         |

This is the whole scale, with no gap left for a Tailwind default to fill unnoticed: `text-sm`,
`text-lg`, `text-xs` and `font-medium` are gone from the component tree, and
`app/theme-classes.test.ts` compiles every `text-`, `bg-`, `border-`, `font-` and `shadow-` class
through Tailwind and fails the build on one that resolves to nothing, so a reintroduced default
cannot land unnoticed again. `text-lg` becomes `title` (16/24) at every call site, `DialogTitle`
included: a dialog's title is a section title, not a size of its own, and there is no `18px`
step for it to have kept. `text-xs` becomes `small` (12/16), never `micro` (11/14): its two call
sites were a button label and a keyboard-shortcut hint, neither one metadata small enough for the
smallest step. `font-medium` becomes `font-strong` (550) throughout. The label and the dialog
title both carry their own step's line-height now, 18px and 24px, with no `leading-none` layered
on top: that was a shadcn default riding along uninvited, not a choice this scale ever asked for.
(Tailwind's own `text-base`, 16px, stays as a deliberate exception on three form fields below
768px, §4, not a gap in this scale.)

`read` (14/21, weight 400) is a closed list on purpose, not a general prose size: task
description, comment body, and import report sentences carry it, nowhere else. Board cards stay
`body` (13/18) even where they show a description snippet. `text-read-utilities.test.ts` scans
`app/`, `components/` and `lib/` for the literal utility class and fails the build the moment a
fourth call site adds itself, the same technique `border-utilities.test.ts` already uses for its
own closed lists.

`tabular-nums` on columns of numbers, axis ticks, and table cells — never on a hero figure or
a stat-tile value.

### Spacing, radius, elevation

| System    | Values                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spacing   | `2 · 4 · 6 · 8 · 12 · 16 · 20 · 24 · 32 · 48`: a 4px base with a 2px half-step; the half-step is what makes a dense row survive                                                                                                                                                                                                                                                                                                                      |
| Radius    | `sm 4` chips · `md 6` buttons, inputs, cards · `lg 10` panels, dialogs · `full` avatars. Tighter than the shadcn default; large radii read soft and cost usable width.                                                                                                                                                                                                                                                                               |
| Border    | 1px hairline `--border`; 2px only for the sancak rail, focus rings, and the task card's own left edge (`--border` at rest, `--signature` when the card is selected)                                                                                                                                                                                                                                                                                  |
| Elevation | **Borders first, shadows last.** The card is always one step above the column ground (`--muted`); the column ground itself steps away from the canvas toward that theme's floor, down in light and up in dark. Real shadows exist in three places only, dialogs, popovers, drag preview, and in dark all three also carry a 1px `--border-strong` ring inside the shadow, since a shadow alone does not read once the surface under it is this dark. |

## 4. Layout and density

App shell per the `(app)` route group in [architecture.md §4](architecture.md#4-appsweb--structure).

| Region             | Spec                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell height       | Exactly `100dvh`, `overflow: hidden` — never `min-height`. Every page owns its own scroller.                                                                                                                                                                                                                                                                                                                                                                                                       |
| Sidebar            | 240px, workspace switcher pinned at top; collapses to a 56px icon rail below 1280px and on demand; off-canvas below 768px                                                                                                                                                                                                                                                                                                                                                                          |
| Topbar             | 48px sticky — board name, filter entry, overflow (presence avatars are not shipped yet); **56px below 768px**, where it also carries the navigation trigger                                                                                                                                                                                                                                                                                                                                        |
| Board canvas       | Full-bleed, horizontal scroll; column headers stick on vertical scroll                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Column             | 300px fixed (280 min / 320 max on wide screens), 12px gap, 40px sticky header with name + count + `⋯` (48px below 768px); below 48rem a column is 85vw and the strip snaps to it (mandatory scroll snap), with 24px edge masks (`--background` fading to transparent) drawn on whichever side still has a column to scroll to                                                                                                                                                                      |
| Card               | 8px 12px padding plus a 32px right gutter for the drag grip (48px below 768px); 6px between the title block and the meta row, 8px between the signals inside it; **36px** title only, **56px** typical (one meta line), **76px** at the clamp: the title clamps at 2 lines, so no card is taller than that. The first three are measured on the seeded board; the clamp figure is measured on a card built for it, a title long enough to wrap onto the second line with a full meta row under it. |
| Card content order | Priority icon + title · meta row (label dots, due date + estimate combined, assignees), one line, never two                                                                                                                                                                                                                                                                                                                                                                                        |
| List / table row   | 36px; 44px below 768px                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Settings and forms | 720px max width — prose is read, not scanned                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Touch target       | **44px minimum below 768px** on every control, with one exception, WCAG 2.5.5's own: a link inside a sentence, sized by the line-height of the text around it (the mail-setup link on `/settings/members`, measured 12/16)                                                                                                                                                                                                                                                                         |

**The shell is exactly one viewport tall, and this is load-bearing.** `min-height: 100dvh`
would say "at least" and bound nothing below it — which is what it did, and why a column's
`overflow-y-auto` never clipped: the document grew instead, reaching 27 425px on a 1 000-task
board. Per-column scrolling, the sticky column header and drag autoscroll all depend on the
column having a bounded box, so all three were inert. `100dvh` and not `100vh`: on a phone
`100vh` is the viewport with the browser chrome retracted, so a `vh`-sized shell is taller than
the screen and pushes the topbar under the address bar on first paint. The consequence to
respect when adding a page: **the document does not scroll anywhere in the app**, so a new
route under `(app)` must declare its own `flex-1 overflow-y-auto`, exactly as the dashboard,
settings and notifications pages do.

**Below 768px the sidebar is off-canvas** — a hamburger in the topbar opening the same
`SidebarBody` in a drawer, not a second navigation with its own list of links. The drawer is
the app's `Dialog` primitive docked to the left edge (`DialogDrawerContent`), which is a
deliberate refusal to hand-roll one: the focus trap, `Escape`, returning focus to the trigger,
inerting the page behind and the scroll lock are the whole substance of an off-canvas panel,
and a parallel implementation is a second place for one of them to be missing. It slides at
220ms on `--ease-drawer`, and cross-fades instead under `prefers-reduced-motion`.

**44px, not 40, and keyed on width rather than on pointer type.** 44px is WCAG 2.5.5 (AAA) and
the figure the roadmap holds this layout to. It is keyed on `max-md` — the same breakpoint the
drawer uses — rather than on `pointer: coarse`, so one condition governs the whole mobile
layout instead of two that can disagree; a 360px window on a desktop getting 44px targets costs
nothing. The floor lives in the `Button` and `Input` variants and in the dropdown item classes,
not at the call sites, so there is one list to read. Sizes above the breakpoint are untouched.
It is **measured, not asserted**: `e2e/tests/mobile-navigation.spec.ts` sweeps every button,
link, input and menu item on the board and in the drawer at 360px and fails on any box under
44px in either axis. jsdom lays nothing out, so a unit test cannot make this claim.

**16px below 768px, `body` above it, on every text field.** The same iOS Safari behavior that
justifies the 44px touch floor also zooms the whole page on focus if the field it lands in
computes under 16px, and Tailwind's own `text-base` is exactly that threshold: `Input`,
`Textarea` and `Select` all carry `text-base md:text-body`, so the rule is keyed to the same
`max-md` breakpoint as everything else in this section rather than judged one primitive at a
time. It is enforced the same two ways the 44px floor is: measured, and structurally hard to
regress past. `e2e/tests/mobile-navigation.spec.ts` reads every field's computed `font-size` on
the board, in the navigation drawer and in the task panel at 360px and fails on anything short of
`16px`, and `lib/utils.ts`'s `cn()` extends `tailwind-merge` with this type scale so a consumer's
own `text-*` override still deduplicates against a primitive's default instead of both classes
reaching the DOM and stylesheet order deciding which one paints.

**Touch drag is by the grip.** The card body belongs to the column's scroller — the wrapper
carrying dnd-kit's listeners has no `touch-action`, so the browser claims a vertical gesture
there — and the grip declares `touch-action: none`, which is what hands that one 44px region to
dnd-kit instead. This is a division, not a limitation: a column that cannot be scrolled with a
thumb is worse than a card that cannot be dragged from its middle. Both halves are asserted.
A touch drag also starts from a **250ms press** on the grip (5px of travel cancels it), so a
swipe that begins on the grip still scrolls; a mouse drag starts from **6px of movement** with no
delay, because a mouse has no gesture to give up.

**Task detail: a right-side panel, not a modal.** ~480px wide (`min` 420px / `max` 640px via
CSS), **non-modal** — the board stays visible and clickable behind it on desktop. Below the
Tailwind `md` breakpoint (768px) it becomes a fullscreen sheet (`fixed inset-0`). Drag-resize
of the panel width is not implemented; the CSS bounds are fixed. Confirmations, board
creation, and destructive actions stay **dialogs**; those genuinely need to block.

| Why a panel |                                                                                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context     | The point of a board is the surrounding cards; a modal deletes them                                                                                                        |
| Flow        | Triage is open → edit → next. A panel keeps the next card one click away instead of a dismiss plus a click.                                                                |
| Realtime    | A card moving under a modal is invisible; behind a panel it is visible                                                                                                     |
| Routing     | Deep-linkable at `board/[boardId]/task/[taskId]` — both soft navigation and a hard load render `BoardView` with the task selected (no Next.js intercepting/`@modal` route) |

**Which surface a situation gets.** Every layer in the app answers to one of these:

| Situation                                                                                                                                              | Surface                                   | Rule                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One or two fields that save where they are, opened from the exact spot they describe                                                                   | Inline composer / inline edit             | No layer, no focus trap; `Enter` saves, `Escape` cancels and restores the old value (`components/common/inline-rename.tsx`, `components/board/task-composer.tsx`, [ADR 0035](decisions/0035-inline-task-composer.md)) |
| A focused multi-field form, or a destructive or hard-to-reverse confirmation that genuinely has to block the screen behind it                          | Dialog                                    | Traps focus, closes on `Esc`, restores focus on close (§5, §9 Focus management); board and column creation, invites, an owner role change, every delete                                                               |
| One entity's full detail, read or edited alongside the list it came from                                                                               | Panel                                     | Non-modal, ~480px, a fullscreen sheet below `md` ("Task detail" above)                                                                                                                                                |
| Several independent settings-style sections on one screen, 2 to 7 of them                                                                              | One page, one `SettingsSection` per topic | `/settings` holds six today: members, language, notifications, tokens, workspace, account                                                                                                                             |
| One of those sections reaches its own data-table scale (a roster with a control per row), or a confirmation flow too tall for a paragraph and a button | Sub-route                                 | `/settings/members`, `/settings/account/delete` (Settings IA below)                                                                                                                                                   |
| A distinct top-level destination                                                                                                                       | Full page                                 | Owns its own `flex-1 overflow-y-auto` ("The shell is exactly one viewport tall" above)                                                                                                                                |
| A list of options that outgrows a flat scan                                                                                                            | Progressive disclosure                    | 7 or fewer renders flat; 8 or more folds behind a searchable popover (below)                                                                                                                                          |
| The result of an action the screen cannot already show for itself                                                                                      | Toast                                     | Per §7's third-beat rule: the effect is off-screen, has no on-screen representation, or reaches further than the view admits                                                                                          |
| A field-level `400` or `422` failure                                                                                                                   | Inline error                              | Under the field, focus moves to the first (§6 Errors)                                                                                                                                                                 |

**How many dialogs there are, and how that is counted.**
`find apps/web/components -iname '*dialog*.tsx' ! -iname '*.test.tsx'` is the whole list; four of
its files are not a dialog anyone meets, and come off the count: the `ui/dialog.tsx` primitive,
the `common/form-dialog.tsx` and `common/confirm-dialog.tsx` wrappers, and
`board/board-dialogs.tsx`, which only mounts the board's own. That leaves **15 concrete dialogs**,
down from 19 when this phase started: renaming a board and renaming a workspace became inline
edits, and changing a role and deleting an account became the two sub-routes above. Every removal
was a surface moving down the rubric, never a dialog deleted for the count's sake.

**Panel order.** `TaskPanel` composes, top to bottom: `TaskPanelFields` (title at `title-lg` and
description at `read` from `md` up, both 16px below it; the title is borderless at rest and
bordered only on focus via `border-transparent focus:border-input`), `TaskPropertiesPanel`
(priority, due date, estimate, assignees, labels), `TaskChecklists`, `TaskAttachments`,
`TaskDiscussionPanel` (comments, activity), then, for whoever can mutate, a delete footer. It is
the same order the card itself reads in: what the
task is, then what is in it, then what was said about it. The footer is `mt-auto` and only
reaches the bottom of the panel while it is the last child of that flex column
(`components/task/task-panel.tsx`, pinned by `task-panel.test.tsx`), so nothing may be appended
after it.

Every titled section below the fields carries the same 1px top rule at 16px of padding. All four
of them, not two: four headings of one weight with a rule above only two of them reads as an
arbitrary line rather than as grouping. And the panel spends **no** full-strength copper of its own. Its
section actions (create label, add checklist, post comment) are outline buttons, because they are
three peers rather than the one primary action §2 budgets, and the board behind the panel is
already spending the screen's other mark on the selected card's rail. `task-panel.test.tsx` fails
on a default-variant button anywhere in the panel.

The assignee and label pickers fold at the same number the panel itself scans without searching:
`INLINE_PICKER_MAX = 7` (`components/task/searchable-picker.tsx`) renders 7 or fewer options as
a flat checkbox list and folds 8 or more behind a searchable, non-portalled popover
(`components/ui/popover.tsx`) instead of letting the list outgrow the panel's own width.
`Escape` closes only that popover, not the panel behind it (`ESCAPE_LAYER_SELECTOR` in
`use-task-panel-focus.ts`).

**Settings IA: further down, harder to undo.** `/settings`'s sections read top to bottom on that
rule. Members first, since it is the only section about other people and what a new workspace
owner opens this screen to find. Language and notifications next, both about the person rather
than the workspace. Tokens before workspace, since revoking one undoes itself the moment it is
minted again, unlike anything below it. Workspace before account, since deleting a workspace
stays inside it while deleting the account reaches past this workspace into every workspace the
person is in on this instance ([ADR 0026](decisions/0026-account-deletion-anonymisation.md));
nothing on the page is further down than that. `/settings/members` and
`/settings/account/delete` are the two sections the sub-route rule above promotes off this page;
every other section stays inline as a `SettingsSection` (`components/settings/settings-section.tsx`).

## 5. Interaction patterns

| Drag and drop | Rule                                                                                                                                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lift          | Card scales to `1.02`, tilts `1deg`, takes the one drag shadow; the source leaves a `--muted` ghost at the same height, so the board never reflows mid-drag                                                                                                               |
| Drop target   | Within a column, dnd-kit's displacement opens the card-height gap and a 2px copper rail marks its leading edge; across columns the rail alone marks the insertion point and nothing shifts. The destination column takes a `--signature-subtle` wash. No dashed outlines. |
| Commit        | Optimistic — the card lands instantly, `PATCH .../tasks/:taskId/position` follows                                                                                                                                                                                         |
| Failure       | The rollback restores the position instantly and the card lands in place with a 220ms `--ease-in-out` settle (`translateY` -6px to 0, opacity 0.5 to 1); a toast says what happened with a **Try again** control. Never leave the optimistic state standing.              |
| Keyboard      | `@dnd-kit` `KeyboardSensor` — `Space` lifts, arrows move within and across columns, `Space` drops, `Esc` cancels. Each transition announced via `aria-live="polite"`: "Moved _Fix login redirect_ to In Progress, position 2 of 5."                                       |
| Autoscroll    | Both axes, 24px edge zone                                                                                                                                                                                                                                                 |

| Realtime change        | Surfacing (never a layout jump)                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Remote create / update | `--signature-subtle` background fading out over 1200ms. No movement, no size change. Color-only, so it survives `prefers-reduced-motion` unchanged.                                                    |
| Remote move            | The card moves on the column's own sortable transition (dnd-kit's 200ms default); during a local drag the update is queued and applied on drop                                                         |
| Remote delete          | **Not shipped yet:** the card goes and the gap closes on that same sortable transition. The two beats it should have, fade to 0 over 160ms then close the gap over 160ms, are still the intended shape |
| Presence · disconnect  | Not shipped yet (topbar/card presence). Disconnect: a quiet inline "Connection lost, changes may not be showing" bar, kept until the socket is back and never dismissible, never a blocking overlay    |

**Keyboard baseline.** Focus is always visible, and it is exactly one indicator: 2px `--ring` at 2px
offset, and `outline: none` without a replacement is a review blocker. That single mark is drawn
once, from `@layer base`, on every keyboard-reachable control: the `focus-visible:ring-[3px]
ring-ring/50` and `focus-visible:border-ring` utilities that used to sit beside it on the primitives
are gone, and so is every `outline-none` / `outline-hidden` that would otherwise outrank the layered
rule. What survives them is a short, named list of programmatic focus containers that take focus by
script rather than by Tab, an arrow key or a link (a dialog's content, the drawer), plus a dropdown
row, the skip link's `main` target and the task panel's heading, all three of which draw the same
base outline as everything else rather than a suppressed one. A field that is both invalid and
focused recolors that one outline to `--destructive` (`[aria-invalid='true']:focus-visible`) instead
of growing a second mark beside the border; keeping a colored ring alongside the border was the
earlier plan, dropped once Tailwind v4 turned out to paint nothing from a ring-color utility with no
ring-width utility beside it. The offset turns inward only where the focused region fills the shell
and an outside offset would be clipped away, which today is the skip link's `main`. That mark is
also never transitioned: Tailwind v4 folds `outline-color` into `transition-colors` (v3 did not),
so a shortcut like `transition-colors` or `transition-all` fades the outline from `currentColor`
to copper over the transition duration while its width and offset appear at once. Every
transition in the tree therefore names its properties, and none of those lists names the
outline. Tab order
follows visual order; the board is a composite widget, so the whole column strip is a single tab
stop, `Home`, `End` and `Ctrl` + arrow move between the column headings inside it, and the bare
arrow keys belong to the keyboard drag within a column. `Esc` closes the topmost layer only and
returns focus to whatever opened it. `c` is mapped: it opens the creation composer at the foot of
a column ([ADR 0035](decisions/0035-inline-task-composer.md)). Reserved now, mapped in Phase 4+:
`⌘K` command palette, `/` filter, `?` help; nothing else claims a bare letter key.

**Dialogs are bounded and scroll their own body.** A dialog surface is at most
`calc(100dvh - 4rem)` tall; its body scrolls, and the header and footer stay pinned outside that
scroll so the submit and cancel controls are on screen at any window height and at the 200% zoom
§9 asks for. The page behind an open dialog is scroll-locked, so a surface with no ceiling puts
its own footer past the bottom of the screen with nothing left to scroll. The close control is
pinned with the header rather than placed inside the scrollport, where an absolutely positioned
box scrolls away with the content and is clipped by it.

**Motion.** Purposeful micro-interactions only, **at most one orchestrated moment per view** —
on the board that is the first paint of the columns, and nothing else.

| Case                                             | Duration                      | Curve                                                     |
| ------------------------------------------------ | ----------------------------- | --------------------------------------------------------- |
| Sancak rail moving                               | 150ms                         | `--ease-out`                                              |
| Tooltip, small popover                           | 125–200ms                     | `--ease-out`                                              |
| Dropdown, select, menu                           | 150–250ms                     | `--ease-out`, `transform-origin: var(--transform-origin)` |
| Detail panel, sheet                              | 220ms                         | `--ease-drawer`                                           |
| Dialog · toast (`translateY(100%)`)              | 200ms                         | `--ease-out`, dialog origin centered                      |
| Dialog scrim                                     | 200ms                         | `--ease-out`                                              |
| Card returning after a failed drop               | 220ms                         | `--ease-in-out`                                           |
| Column stagger on first board paint              | 40ms between columns          | `--ease-out`                                              |
| Skeleton pulse (loop, not a one-shot transition) | 1.6s, opacity 1.0 → 0.6 → 1.0 | `--ease-in-out`                                           |

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1); /* entering, exiting, default */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1); /* moving on screen */
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1); /* panel and sheet */
```

All three curves above are real custom properties in `app/globals.css`, also exposed as
Tailwind `ease-out`, `ease-in-out` and `ease-drawer` utilities through `@theme inline`, not
only this table's notation. The dialog surface and its scrim, the dropdown and submenu, and
the off-canvas drawer all bind their keyframes through `data-slot`/`data-state` in
`app/globals.css` rather than a Tailwind animation-plugin class, since this project ships
plain `tailwindcss` with no such plugin: those classes would compile to nothing and every
open would cut instead of transition.

- **Press feedback is not shipped.** Nothing scales on `:active`; a pressed control steps its
  colour and stays where it is. The table above is what the app draws, not what it could.
- **No animation on keyboard-initiated actions** — the command palette opens instantly; it runs
  a hundred times a day and motion makes it feel slow.
- **`transform` and `opacity` only** (accordion height excepted). Never `transition: all`, never
  `scale(0)` — enter from `scale(0.96)` + `opacity: 0`. Never `ease-in` on UI: it delays the
  exact moment the user is watching.
- **Transitions, not keyframes**, for anything triggerable twice a second (toasts, toggles, the
  rail) — transitions retarget from the current value, keyframes restart from zero.
- Nothing over 300ms except the panel. Gate hover motion behind `@media (hover: hover) and
(pointer: fine)`. Springs (`{ duration: 0.5, bounce: 0.2 }`) only where a gesture carries
  velocity — drag preview, swipe-to-dismiss.
- **Loop indicators sit outside the "nothing over 300ms" rule**: a skeleton's pulse (1.6s,
  opacity 1.0 to 0.6 and back) and a loading button's spinner (700ms per rotation, linear, shown
  only after 400ms) run continuously while work is in progress instead of once on enter or exit.
  Both hold still under `prefers-reduced-motion: reduce`, the skeleton at a flat 0.75 opacity and
  the spinner not spinning at all.
- **Waiting for a response draws from exactly one mechanism**: `Button`'s `loading` prop,
  `aria-busy` and `disabled` immediately, spinner after the 400ms threshold, drawn over the
  control's own content and out of its layout flow, so the button keeps its exact box and no
  label moves (§6 has the full shape). No screen swaps a control's label to a "sending" string of
  its own.
- **`prefers-reduced-motion: reduce`** drops movement and keeps opacity and color: the panel
  cross-fades, the rail jumps, the highlight is unchanged. Fewer and gentler, not zero.

## 6. States

**Empty states are invitations** — one damga mark and one primary action per screen. They name
the next move; they do not explain the feature. This is the only place damga marks appear.

**One primary action counts the whole screen.** Where the empty state carries the action, the
page header's copy of the same action is hidden while the screen is empty and comes back with the
first row. Two identical primary buttons on a first run is a choice the reader does not have.

The dashboard is the one screen where two regions can be empty at once, and there the two actions
are not the same action: with boards but no tasks, the charts invite "Open a board" while the board
list below still carries its standing "Create board". Measured on the running app, both drew the
fill, which with the sidebar rail put three full-strength marks on one screen. The fill stays with
the action the route carries in every state, so the charts' shortcut is an outline button
(`components/dashboard/dashboard-summary.tsx`).

| Surface               | Mark       | Headline                     | Body                                                                                                  | Action                           |
| --------------------- | ---------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------- |
| No boards yet         | Damga 96px | No boards yet                | A board is where the work gets divided. Start with one.                                               | Create board                     |
| Board has no columns  | Damga 96px | This board has no columns    | Columns are the stages work moves through. Start with To Do, In Progress, and Done, or name your own. | Add column · Use default columns |
| Empty column          | —          | —                            | 56px solid `--border-strong` drop zone: "Drop a task here"                                            | Add task                         |
| Filters match nothing | —          | No tasks match these filters | Three filters are active.                                                                             | Clear filters                    |
| Dashboard, no data    | Damga 64px | Nothing to chart yet         | Charts fill in as tasks are created and moved.                                                        | Open a board                     |
| Notifications         | —          | You're caught up             | —                                                                                                     | —                                |

**Loading** uses skeletons that match the final layout in `--accent`, with a 1.6s opacity pulse
(1.0 → 0.6) and no shimmer sweep: the board renders column skeletons at real width with three
card skeletons at real card heights; the task panel opens immediately with the clicked card's
title already in place, so it is never blank; inline actions are optimistic. Spinners exist in
exactly one place: inside a pressed button, 14px, over its content, after 400ms. List
content never gets one. Unknown-length work (import, export) gets a progress bar with a count.

**Errors** derive from the problem-JSON shape in [api-conventions.md](api-conventions.md#errors).
Per that contract the UI **branches on `statusCode` and `error`, never on `message` text** — so
user-facing strings come from the i18n catalog and the API `message` is logged, not shown. Only
`details[]` is surfaced, being field-level and safe. Name the object that failed, give the next
action as a real control, keep it to one sentence, and never print an id, a stack trace, or the
word "Oops".

| Status                         | Surface                                           | Copy                                                                                      |
| ------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `400` / `422` with `details[]` | Inline under each field; focus moves to the first | From `details[].constraint`, mapped to a catalog string: "Title can't be empty"           |
| `401`                          | Redirect to sign-in, keeping the return URL       | Your session ended. Sign in to pick up where you left off.                                |
| `403`                          | Inline on the blocked control                     | You need admin access to change columns. Ask a workspace owner.                           |
| `404` in panel                 | Replaces the panel body                           | This task no longer exists. Someone may have deleted it. → **Back to board**              |
| `409`                          | Dialog over the stale editor                      | Someone changed this task while you were editing. → **Reload** · **Copy my changes**      |
| `429` · `5xx`                  | Toast · error block where the content should be   | Too many requests. Try again in a few seconds. · The board couldn't load. → **Try again** |
| Offline                        | Persistent topbar strip                           | You're offline. Changes won't save until the connection is back.                          |

## 7. UI writing

From the user's side of the screen, active voice, sentence case.

| Instead of                 | Write                                       | Why                                  |
| -------------------------- | ------------------------------------------- | ------------------------------------ |
| Submit                     | Save changes                                | Says what happens                    |
| Oops! Something went wrong | The board couldn't load.                    | Names the object                     |
| Task successfully created! | Task created                                | The button's verb, no exclamation    |
| Are you sure?              | Delete this board?                          | The question is the consequence      |
| Invalid input              | Title can't be empty                        | Specific beats clever                |
| Users / Org / Entity       | Members / Workspace / Task                  | Product vocabulary, not schema       |
| Socket disconnected        | Connection lost, changes may not be showing | What it costs them, not what dropped |
| Position updated           | Moved to In Progress                        | What they did, not what the row did  |

- **One verb through a flow:** button **Create board** → dialog **Create board** → toast **Board
  created**. Buttons name their action, never Yes/No/OK; destructive ones name the object. The
  verb holds all the way to the failure: an **Add column** button does not fail with "Could not
  _create_ this column."
- **The third beat only exists where the screen cannot show the result.** A card lands under the
  cursor, a renamed column shows its new name, a deleted board leaves the grid — those confirm
  themselves, and a toast on top is noise. Confirm when the effect is off-screen (an inbox, a
  stored preference), when the thing that changed has no on-screen representation (a column's
  `category`), or when the change reaches further than the view admits (deleting a board label
  strips it from every task). Silence is the default; a message is the exception that has to
  earn itself.
- **One job per element.** A label labels, helper text explains, a placeholder shows an example
  — a placeholder is never a label.
- **Never expose internals** (`workspaceId`, `position`, "fractional index", "optimistic
  update"). Ids appear only behind a copy-id affordance, in mono.
- **Dates and durations:** relative near now ("in 2 days"), absolute beyond a week, exact value
  always in `title`. `estimatedMinutes` renders "2h 30m", never "150".

**Every error ends with a way out.** Naming the object that failed is only half the message; the
other half is the next move. Which half carries it is decided by one question — **could the
identical request succeed on a second attempt?**

|                   | **No** — the server explained itself                                                                        | **Yes** — the server did not                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Recovery lives in | **The sentence**                                                                                            | **The surface**                                                                       |
| The user gets     | The reason, then the one move that changes it: ask an admin, reload, use the other address, send a new link | The object that failed, then a control: `action` on a toast, **Try again** on a block |
| Typical causes    | `400` · `401` · `403` · `404` · `409`, a rejected credential, an expired link                               | network · timeout · `429` · `5xx`                                                     |
| Example           | You need admin access to change columns. Ask a workspace owner.                                             | The board couldn't load. → **Try again**                                              |

Two things keep the right-hand column honest. A control that re-fails on every press teaches the
user the product is broken, so an **explained** failure never gets one — re-sending a write the
server rejected on a `403`, or against a task that is gone, only repeats the toast. And when the
control that failed is **still on screen and still live** — a dialog's submit button, "Load more",
a select — that already _is_ the retry; a second one beside it is clutter, which is why the
create/rename/delete dialogs carry no action of their own.

Every user-visible string goes through **next-intl** from the first component, even though MVP
ships English-only. This is the _layer_, not the translations: the roadmap's Beyond-MVP "i18n in
the application UI" row is about shipping further language packs, and the plumbing lands with
the Phase 1 skeleton because retrofitting it costs far more than starting with it.

| i18n rule                     |                                                                                                                                                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No hardcoded strings          | User-facing copy goes through `useTranslations` / `getTranslations` and `messages/*.json`. There is no ESLint rule forbidding JSX string literals yet — `messages/catalog.test.ts` catches missing/orphan keys for bound `t('…')` calls. |
| Keys                          | By domain, mirroring the component tree: `board.column.addAction`, `task.priority.urgent`, `errors.http.409`                                                                                                                             |
| Catalogs                      | `messages/en.json` is canonical; `messages/tr.json` ships beside it and `messages/catalog.test.ts` fails the build on a key one has and the other does not                                                                               |
| Plurals, interpolation        | ICU format (`{count, plural, …}`). Never concatenate sentence fragments — word order differs per language.                                                                                                                               |
| Dates, numbers, relative time | `Intl.*` via next-intl formatters with the active locale; no hand-formatted dates                                                                                                                                                        |
| Casing                        | **No `text-transform: uppercase` on translated strings** — Turkish `i → İ` breaks under CSS casing. Write the intended casing into the catalog.                                                                                          |
| Layout                        | Assume ±35% string length; nothing is a fixed pixel width because the English fits                                                                                                                                                       |

## 8. Charts and dashboard

For the dashboard ([ROADMAP.md](../ROADMAP.md#shipped-mvp-summary), Phase 7), rendered with Recharts. Form is chosen by the
reader's job, before any color decision. Never a dual y-axis, never a pie past two slices,
never a generated ninth hue — fold the tail into "Other" or facet into small multiples.

| Aggregate                                      | Form                                                                             | Color job                  |
| ---------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------- |
| Open tasks, overdue count, completed this week | **Stat tile** — label, value, signed delta vs a named period, optional sparkline | none / emphasis            |
| Completion over time                           | **Line**, one series (10% area fill only if it is alone)                         | sequential                 |
| Created vs completed over time                 | **Two lines**, direct-labeled at the right edge                                  | categorical 1–2            |
| Tasks per column · per assignee                | **Horizontal bar**, sorted; assignees top 8 then "Other"                         | sequential                 |
| Priority breakdown                             | **Horizontal stacked bar**, one row, LOW→URGENT                                  | the priority scale (§3)    |
| Label distribution                             | **Horizontal bar**                                                               | categorical, by label slot |
| Column composition over time                   | **Stacked area / column**, ≤ 6 series                                            | categorical                |
| More than ~7 categories that all matter        | **Table**, or table plus chart                                                   | —                          |

Palette validated against Kurul's own surfaces (`#FFFFFF` light, `#212523` dark). These slots
also back `Label.color`.

| Slot | Hue    | Light     | Dark      |     | Slot | Hue     | Light     | Dark      |
| ---- | ------ | --------- | --------- | --- | ---- | ------- | --------- | --------- |
| 1    | blue   | `#2A78D6` | `#3987E5` |     | 5    | magenta | `#E87BA4` | `#D55181` |
| 2    | orange | `#EB6834` | `#D95926` |     | 6    | green   | `#008300` | `#2A9D3C` |
| 3    | aqua   | `#1BAF7A` | `#199E70` |     | 7    | violet  | `#4A3AA7` | `#9085E9` |
| 4    | yellow | `#EDA100` | `#C98500` |     | 8    | red     | `#E34948` | `#E66767` |

Validator — **light**: lightness band, chroma, CVD (worst adjacent ΔE 9.1) and normal-vision
(19.6) all PASS; contrast WARN on slots 2, 3, 4, 5 (2.61 / 2.29 / 1.76 / 2.19, below 3:1 as a dot
on the signature tint, the worst ground `app/globals.contrast.test.ts` measures a label chip
against). The dot is never the only channel: it is `aria-hidden` and always paired with the
label's own name, and every chart carrying these slots still offers **direct labels or the table
view** as the relief route. **Dark**: lightness band, chroma, normal-vision (worst adjacent ΔE
19.3) and contrast against the dark surface all PASS; CVD separation lands in the 6 to 8 floor band
at worst adjacent ΔE 7.2 (deutan, slot 5 magenta against slot 6 green), recomputed after slot 6
moved to `#2A9D3C` to clear 3:1 on the dark surfaces. That band is legal only with a second
channel, and every use of these slots already carries one: the label's own name in the chip, a
legend plus direct labels or the table view in a chart.

| Rule                   |                                                                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Slot assignment        | Fixed order, assigned in sequence, **never cycled**. Color follows the entity, not its rank — filtering out a series must not repaint the survivors.                                                                                                                                 |
| Series cap             | 6 soft / 8 hard for bars, lines, stacks; **3** for scatter, bubble, and small multiples (the all-pairs gate)                                                                                                                                                                         |
| Sequential · diverging | One hue, blue, light→dark for magnitude · blue ↔ red with a **neutral gray** midpoint (`#F0EFEC` / `#383835`), only for "vs target" views                                                                                                                                            |
| Emphasis               | One series in `--signature` copper, the rest in `--foreground-disabled`. The only copper in a chart, and the right answer whenever the story is "this one".                                                                                                                          |
| Status and priority    | Reserved — never reused as "series 4"                                                                                                                                                                                                                                                |
| Marks                  | Bars ≤ 24px thick, 4px rounded data-end, square at the baseline, 2px surface-colored gap between adjacent bars and stacked segments; lines 2px round cap/join; markers ≥ 8px with a 2px surface ring                                                                                 |
| Grid and axes          | Horizontal gridlines only, 1px solid `--border`, never dashed. No chart border, no background fill. Ticks rounded to clean numbers, thousands-separated, `tabular-nums`, in `--muted-foreground`.                                                                                    |
| Legend and labels      | Legend always present at 2+ series, none for one — the title names it. Direct labels are selective (endpoint, extreme, or the one series that is the story), never a number on every point. **Text wears text tokens, never the series hue**; identity comes from the dot beside it. |
| Tooltip                | Default-on: crosshair + tooltip on line and area, per-mark on bar and cell. Card surface, 1px border, `sm` radius, 8px padding, series dot + name + `tabular-nums` value, hit target larger than the mark.                                                                           |
| Filters and table view | Filters in one row above the charts, never inside a chart. Every chart has a "View as table" affordance — also the relief channel for the light-mode contrast WARN.                                                                                                                  |

**Stat tiles.** Label in `small` `--muted-foreground`, sentence case, no trailing colon · value
in Archivo 600 at 28px with **proportional** figures, auto-compacted (`1,284` / `12.9K`) · delta
signed against a named period, colored by _direction × whether up is good_ (more overdue tasks
is not good news) and paired with an arrow · optional 12-point sparkline in
`--foreground-disabled` with the current period in copper. **At most one hero figure per view**,
≥48px, in Archivo — never Fraunces; a display face on a number reads as decoration.

## 9. Accessibility

Target **WCAG 2.1 AA** in both themes, verified per token pair rather than per screenshot.

| Requirement                       | Floor                              | Applies to                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Body text on its surface          | 4.5:1                              | `app/globals.contrast.test.ts`: every text token in §3 against six real surfaces (canvas, column, card, popover, hover step, signature tint); boundary tokens hold the same six at 3:1. Nothing is waved through on prose: every exemption is a named entry in that file carrying its measured number and its reason, re-measured on each run and failing the gate when it drifts off that number or stops being needed. There are four classes of them. `--border`, the decorative hairline that carries no state. Copper text on the signature tint, which §3 forbids outright, and on the hover step, which no call site draws, both light only. The four light label slots, measured as dots and relieved by the name beside them (§8). And the alpha derivatives whose full-strength twin is the real mark: `opacity-50` on an inactive control (WCAG exempts it, the gate holds it to 3:1 anyway) and the hole a dragged card leaves in its column. |
| Large text (≥18.66px bold / 24px) | 3:1                                | Titles, hero figures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Component boundaries and states   | 3:1                                | Input borders, focus ring, sancak rail, chart marks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Disabled text                     | exempt, held to 3:1 anyway         | Placeholders, disabled controls                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Chart marks on the chart surface  | 3:1, or direct labels / table view | Light slots 2, 3, 4, 5 take the relief route (§8 measures all four under 3:1 as a dot on the signature tint)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

| Rule                         |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keyboard parity              | Every pointer interaction has a keyboard path, drag and drop included (§5). If a feature can only be done by dragging, it is unfinished.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Color is never alone         | Priority and status ship an icon and a word; labels carry their name in the chip; series get a legend and, at ≤4 series, direct labels; the rail is accompanied by `aria-current` and a weight change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Focus management             | The non-modal panel moves focus to its heading on open and returns it to the originating card on close, without trapping. Dialogs _do_ trap, restore focus on close, and close on `Esc`; popovers return focus to their trigger.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Focus inside a menu          | Radix moves focus into a dropdown's content when it opens and onto a row on pointer move, and the rows carry no outline suppressor, so the row under the pointer wears the same single focus outline an arrowed-to row does, on top of its `bg-accent` step. Kept deliberately: the alternative is suppressing the outline again on the one row type a keyboard reaches by arrow key. One mark too many for a pointer is accepted; one too few for a keyboard is not. Measured on the running app in Chromium 151 and Firefox 153.                                                                                                                                                                                                                                                                                                                                                 |
| Announcements                | Drag transitions, optimistic failures, realtime arrivals, and toasts go through `aria-live="polite"`; only a session-ending error is `assertive`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Reduced motion               | Respected everywhere and never removes a state change: the state still changes, it just stops moving                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Structure                    | One `h1` per route; landmarks for sidebar, main, panel; the board as a labelled composite widget; column counts exposed as text, not inferred                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Zoom, reflow, forced colors  | Usable at 200%: the sidebar collapses and the panel becomes a sheet rather than the board scrolling in two directions. `forced-colors: active` keeps borders and focus rings; charts fall back to the table view.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Forced colors, high contrast | Every state built on a surface step or a tint carries a border-based twin, with one named exception. Under `forced-colors: active`: the selected card takes a `Highlight` outline, a card another member just changed takes a dotted `Highlight` border (dotted so it stays distinct from selection's solid one), the column drop target takes a `Highlight` outline inset, and a highlighted menu row paints `Highlight` / `HighlightText` in place of its tint. The exception is the card's hover step: forced colours collapse `--border` and `--border-strong` onto one `CanvasText`, so its twin would have to borrow `Highlight` and would then read as selection; hover is also the only state with no keyboard path to lose, and focus keeps its own ring. Under `prefers-contrast: more`: `--border` takes `--border-strong`'s value instead of opening a second palette. |
| `--input` alias              | `--input` reads `--border-strong`'s value (`--input: var(--border-strong)` in `app/globals.css`), so every field, select and textarea wearing `border-input` already clears the 3:1 boundary floor without a token of its own.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `dark:` binding              | Tailwind's `dark:` variant is bound to the `.dark` class next-themes writes (`@custom-variant dark (&:where(.dark, .dark *))` in `app/globals.css`), not to `prefers-color-scheme`, so a viewer's chosen theme controls every `dark:` utility in `components/ui/` regardless of the OS setting.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## 10. Cross-references

| Document                                                               | What it binds here                                                                                                                                                |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [coding-standards.md](coding-standards.md#nextjs-appsweb)              | `components/ui/` is shadcn output only — tokens are edited in the theme, never in a primitive; no arbitrary hex in components; conditional classes through `cn()` |
| [architecture.md](architecture.md#4-appsweb--structure)                | The `(auth)` / `(app)` route groups and the `board/`, `task/`, `dashboard/`, `layout/` component domains this document lays out                                   |
| [api-conventions.md](api-conventions.md#errors)                        | The problem-JSON shape error copy derives from, and the rule to branch on `statusCode`                                                                            |
| [Shipped MVP summary](../ROADMAP.md#shipped-mvp-summary)               | Phase 3 lands tokens, shell, and board chrome; Phase 4 the drag interaction and detail panel; Phase 5 priority and label rendering; Phase 7 the charts            |
| [`decisions/0003-frontend-stack.md`](decisions/0003-frontend-stack.md) | Next.js 16 + Tailwind + shadcn/ui + @dnd-kit + Recharts — the toolkit every rule above is written against                                                         |
| [tech-stack.md](tech-stack.md)                                         | Why that toolkit                                                                                                                                                  |
