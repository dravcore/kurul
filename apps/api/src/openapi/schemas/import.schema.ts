import type {
  TrelloImportReportDto,
  TrelloImportScope,
  TrelloImportSkipGroupDto,
  TrelloImportSkipReason,
} from '@kurul/shared-types';

/**
 * Aliased because `implements` takes an identifier, not an indexed access — the shape itself is
 * declared inline on `TrelloImportReportDto` and this is how the class still tracks it.
 */
type TrelloImportCounts = TrelloImportReportDto['imported'];

/** Rows the import actually wrote. */
export class TrelloImportCountsSchema implements TrelloImportCounts {
  columns!: number;
  tasks!: number;
  labels!: number;
  checklists!: number;
  checklistItems!: number;
  attachments!: number;
}

/** One `(scope, reason)` group of everything that did not come across. */
export class TrelloImportSkipGroupSchema implements TrelloImportSkipGroupDto {
  /** Which part of the export this came from. */
  scope!: TrelloImportScope;
  /**
   * Why it did not make it across.
   *
   * `defaulted` is in this list without being a skip: an imported column takes the default
   * category and an unknown Trello colour falls back to `slot-1`. Both changed something the
   * user will see, and the question after an import is "why does my board look different".
   */
  reason!: TrelloImportSkipReason;
  /** The real number. Never capped. */
  count!: number;
  /** Up to 20 names, so the response scales with the number of *kinds* of problem. */
  samples!: string[];
}

/**
 * The body of a successful Trello import.
 *
 * **This is the whole report and it is stored nowhere.** There is no import id and no
 * `GET /imports`; a caller that discards this response has lost the list of what did not come
 * across. The board itself is unaffected.
 */
export class TrelloImportReportSchema implements TrelloImportReportDto {
  boardId!: string;
  boardName!: string;
  imported!: TrelloImportCountsSchema;
  skipped!: TrelloImportSkipGroupSchema[];
}
