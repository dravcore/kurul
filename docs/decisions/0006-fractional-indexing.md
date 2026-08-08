# 0006. Fractional Indexing for Task and Column Position

**Status:** Accepted
**Date:** 2026-08-08
**Updated:** 2026-08-08 — rebalancing is on-demand, not a periodic job, matching testing.md and roadmap.md.

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0006-fractional-indexing.md)

## Context

Kanban cards and columns are reordered constantly via drag-and-drop. A naive
integer position column requires renumbering every subsequent row whenever a
card is inserted between two existing ones, which turns every drag-and-drop
move into an O(n) write and a source of lock contention as boards grow.

## Decision

`Task.position` and `Column.position` are **`Float`**, never `Int`.

## Rationale

- Inserting a card between position `1` and `2` assigns the new/moved row a
  position of `1.5`. Only that single row is written — no sibling rows are
  touched.
- Card and column reordering is the core interaction surface of a kanban tool
  and needs to feel instant regardless of list length; a single-row write
  achieves that where integer renumbering cannot.
- This is a hard requirement, not a style preference — reversing it later means
  a data migration across every existing board.

## Consequences

- On the common path, moving a card is a single-row database write,
  independent of column size — no O(n) renumbering, no lock contention across
  the moved list. The exception is rebalancing, below.
- Repeated insertions between the same two neighbors (e.g., always dropping a
  new card at the very top of a busy column) can drive position values to
  increasingly fine decimal precision over time.
- Floating-point precision is finite, so **rebalancing is on-demand, not a
  scheduled job**: when a move would place a card in a gap narrower than the
  precision threshold, that column's positions are reflowed to round,
  well-spaced numbers in the same transaction as the move, and only then is
  the move applied. A scheduled job was rejected — it needs a scheduler and
  can still let a write fail *between* runs if the gap is already exhausted,
  whereas the reactive check cannot. Rebalancing is the one O(n) write in the
  model, bounded to a single column and rare enough at ordinary insertion
  depths that it is an accepted trade-off rather than a design gap.
- Equality/ordering comparisons on `position` must account for float
  comparison edge cases in queries and in the ORM layer.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Integer position with renumbering | Every move updates every row after the insertion point — O(n) writes, and race conditions under concurrent multi-user drag-and-drop |
| String-based fractional indexing (e.g., base62 order keys) | Avoids float precision limits entirely, but adds key-generation complexity not justified yet; worth reconsidering if float rebalancing ever becomes a real operational problem |
