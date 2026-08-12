/**
 * Renders `estimatedMinutes` the way docs/design.md §7 requires: "2h 30m", never "150".
 *
 * `t` is a parameter rather than a `useTranslations()` call inside, matching
 * `notificationTitle` in `lib/notification-copy.ts`: the helper stays a plain function that a
 * server component can call and a test can pin without an intl provider. Callers bind the
 * `app.board.task` namespace and pass the result.
 *
 * The three keys are whole phrases, not fragments joined here. `${hours}h ${minutes}m` would
 * hardcode English word order and separator into the code, where no translator can reach it —
 * exactly what ADR 0018 rules out ("Never concatenate sentence fragments — word order differs
 * per language"). Splitting on which parts are non-zero is a formatting decision; arranging
 * them is a language decision, so it lives in the catalogue.
 */
/**
 * The three keys this helper may reach for, named rather than left as `string`. That keeps a
 * typo out of the catalogue scanner's blind spot, and it is also what lets both translator
 * flavours be passed in: `useTranslations()` hands back a `string`-keyed function, while
 * `createTranslator()` infers a narrow union from the messages object it was given. Widening
 * the parameter to `string` would reject the latter.
 */
type EstimateKey =
  'estimateFormat.hoursAndMinutes' | 'estimateFormat.hours' | 'estimateFormat.minutes';

export type EstimateTranslator = (key: EstimateKey, values?: Record<string, number>) => string;

export function formatEstimate(minutes: number, t: EstimateTranslator): string {
  // An estimate is a count of minutes worked. Anything else — a negative, a fraction, a NaN
  // from a malformed payload — is floored here rather than rendered onto a board.
  const total = Number.isFinite(minutes) ? Math.max(0, Math.trunc(minutes)) : 0;
  const hours = Math.trunc(total / 60);
  const rest = total % 60;

  if (hours === 0) return t('estimateFormat.minutes', { minutes: rest });
  if (rest === 0) return t('estimateFormat.hours', { hours });
  return t('estimateFormat.hoursAndMinutes', { hours, minutes: rest });
}
