'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  TrelloImportScope,
  TrelloImportSkipReason,
  type TrelloImportReportDto,
  type TrelloImportSkipGroupDto,
} from '@kurul/shared-types';
import { Button } from '@/components/ui/button';

interface ImportReportPanelProps {
  report: TrelloImportReportDto;
  /** Removes the panel. There is nothing that brings it back — see the note below. */
  onDismiss: () => void;
}

/** The six count lines, in the order the import writes them. */
const IMPORTED_KEYS = [
  'columns',
  'tasks',
  'labels',
  'checklists',
  'checklistItems',
  'attachments',
] as const satisfies ReadonlyArray<keyof TrelloImportReportDto['imported']>;

function groupKey(group: TrelloImportSkipGroupDto): string {
  return `${group.scope}:${group.reason}`;
}

/**
 * Everything a Trello import did and did not do, as a panel that stays until it is dismissed.
 *
 * Not a toast and not a self-closing dialog, and the difference is load-bearing: the report only
 * ever exists in the body of the `201` (ADR 0025 — there is no `ImportRun` table and no status
 * endpoint). Anything that removes itself on a timer removes the only copy, so the panel says
 * outright that dismissing it is permanent rather than leaving the user to find that out.
 *
 * `count` and `samples` are rendered as two different things on purpose. `count` is the real
 * number and is never capped; `samples` stops at the twenty names the API is willing to send. A
 * panel that headlined `samples.length` would report "20 cards were not imported" about an import
 * that dropped 143 — the report would be lying with numbers it was handed correctly. So the
 * sentence always carries `count`, and the example list always carries the ratio.
 */
export function ImportReportPanel({
  report,
  onDismiss,
}: ImportReportPanelProps): React.ReactElement {
  const t = useTranslations('app.board.import');

  return (
    <section
      aria-label={t('reportRegion')}
      className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-border bg-card p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-title font-semibold">
            {t('reportTitle', { name: report.boardName })}
          </h2>
          <p className="max-w-prose text-small text-muted-foreground">{t('notSaved')}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
          {t('dismiss')}
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-small font-strong text-foreground">{t('importedTitle')}</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-small text-muted-foreground">
          {IMPORTED_KEYS.map((key) => (
            <li key={key}>{t(`imported.${key}`, { count: report.imported[key] })}</li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-small font-strong text-foreground">{t('skippedTitle')}</p>
        {report.skipped.length === 0 ? (
          <p className="text-small text-muted-foreground">{t('nothingSkipped')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {report.skipped.map((group) => (
              <li key={groupKey(group)} className="rounded-md border border-border px-3 py-2">
                <SkipGroup group={group} boardId={report.boardId} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <Button asChild type="button">
          <Link href={`/board/${report.boardId}`}>{t('goToBoard')}</Link>
        </Button>
      </div>
    </section>
  );
}

function SkipGroup({
  group,
  boardId,
}: {
  group: TrelloImportSkipGroupDto;
  boardId: string;
}): React.ReactElement {
  const t = useTranslations('app.board.import');

  // The count, never the sample count. `samples` is capped at twenty by the API; `count` is the
  // number the user has to act on.
  const items = t(`skip.scope.${group.scope}`, { count: group.count });
  const sentence = t(`skip.reason.${group.reason}`, { count: group.count, items });

  // The one skipped group with somewhere to go: every imported column took the default category
  // because the export carries no such concept (ADR 0025), and the column settings dialog on the
  // board is where that is fixed.
  const columnAction =
    group.scope === TrelloImportScope.Column && group.reason === TrelloImportSkipReason.Defaulted;

  if (group.samples.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-read text-foreground">{sentence}</p>
        {columnAction ? (
          <ColumnSettingsLink boardId={boardId} label={t('setColumnCategories')} />
        ) : null}
      </div>
    );
  }

  return (
    <details className="flex flex-col gap-1">
      <summary className="cursor-pointer text-read text-foreground">{sentence}</summary>
      <div className="mt-1 flex flex-col gap-1">
        {/*
          The ratio is not decoration. `samples` is truncated at the API's `SKIP_SAMPLE_LIMIT`
          and `count` is not, so a list of twenty names under a sentence about 143 cards reads as
          a complete list unless the gap is stated where the names are.
        */}
        <p className="text-small text-muted-foreground">
          {t('samples', { shown: group.samples.length, count: group.count })}
        </p>
        <ul className="flex flex-col gap-0.5 text-small text-muted-foreground">
          {group.samples.map((sample, index) => (
            <li key={`${index}-${sample}`}>{sample}</li>
          ))}
        </ul>
        {columnAction ? (
          <ColumnSettingsLink boardId={boardId} label={t('setColumnCategories')} />
        ) : null}
      </div>
    </details>
  );
}

function ColumnSettingsLink({
  boardId,
  label,
}: {
  boardId: string;
  label: string;
}): React.ReactElement {
  return (
    <Link href={`/board/${boardId}`} className="text-small font-strong text-primary underline">
      {label}
    </Link>
  );
}
