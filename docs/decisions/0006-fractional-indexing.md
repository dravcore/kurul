# 0006. Fractional Indexing for Task and Column Position

**Status:** Accepted
**Date:** 2026-08-08

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

- Moving a card is a single-row database write, independent of column size —
  no O(n) renumbering, no lock contention across the moved list.
- Repeated insertions between the same two neighbors (e.g., always dropping a
  new card at the very top of a busy column) can drive position values to
  increasingly fine decimal precision over time.
- Floating-point precision is finite: at extreme insertion depth, a periodic
  rebalancing job may eventually be needed to reflow a column's positions back
  to round, well-spaced numbers. This is an accepted, deferred trade-off, not
  a design gap — it only matters at depths ordinary usage is unlikely to reach
  quickly.
- Equality/ordering comparisons on `position` must account for float
  comparison edge cases in queries and in the ORM layer.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Integer position with renumbering | Every move updates every row after the insertion point — O(n) writes, and race conditions under concurrent multi-user drag-and-drop |
| String-based fractional indexing (e.g., base62 order keys) | Avoids float precision limits entirely, but adds key-generation complexity not justified yet; worth reconsidering if float rebalancing ever becomes a real operational problem |
