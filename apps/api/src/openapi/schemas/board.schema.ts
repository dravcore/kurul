import type {
  BoardDto,
  BoardTemplateColumnDto,
  BoardTemplateDto,
  BoardTemplateLabelDto,
  ColumnCategory,
  ColumnDto,
  LabelColorSlot,
  LabelDto,
} from '@kurul/shared-types';

/** A board. */
export class BoardSchema implements BoardDto {
  id!: string;
  workspaceId!: string;
  name!: string;
  description!: string | null;
  createdAt!: string;
}

/** A column a board template will create. No id: nothing exists until the board is created. */
export class BoardTemplateColumnSchema implements BoardTemplateColumnDto {
  name!: string;
  /** Fractional index — a `Float`, spaced so a column fits between any two neighbours. */
  position!: number;
  category!: ColumnCategory;
}

/** A label a board template will create. A design-token slot, never a raw hex value. */
export class BoardTemplateLabelSchema implements BoardTemplateLabelDto {
  name!: string;
  color!: LabelColorSlot;
}

/** One starting shape offered at board creation, named in the caller's language. */
export class BoardTemplateSchema implements BoardTemplateDto {
  /** Stable identifier; send it back as `template` when creating a board. */
  slug!: string;
  name!: string;
  description!: string;
  columns!: BoardTemplateColumnSchema[];
  labels!: BoardTemplateLabelSchema[];
}

/** A column on a board. */
export class ColumnSchema implements ColumnDto {
  id!: string;
  boardId!: string;
  name!: string;
  /**
   * Fractional index — a `Float`, never an integer and never contiguous.
   *
   * Rewritten on every reorder, which is why no cursor is ever keyed on it.
   */
  position!: number;
  color!: string | null;
  /**
   * Semantic state, independent of `name` and of position. Metrics key off this; a client that
   * wants to know whether a column means "finished" reads `category`, never the typed label.
   */
  category!: ColumnCategory;
  taskCount!: number;
}

/** A board-scoped label. */
export class LabelSchema implements LabelDto {
  id!: string;
  boardId!: string;
  name!: string;
  /** A theme-resolved design-token slot name, never a raw hex value. */
  color!: LabelColorSlot;
}
