'use client';

import { useTranslations } from 'next-intl';
import type { ActivationFunnelDto, ActivationStepDto } from '@kurul/shared-types';
import {
  ACTIVATION_STEP_LABEL_KEYS,
  fetchActivationFunnel,
  stepBarPercent,
} from '@/lib/activation';
import { useApiResource } from '@/lib/use-api-resource';
import { StatTile } from '@/components/dashboard/stat-tile';

/**
 * The instance operator's activation funnel — and, for everybody else, nothing at all.
 *
 * ## Why it renders its own heading
 *
 * Every other block on the settings screen is wrapped in the page's `SettingsSection`, which
 * draws a title and a sentence before its child gets a say. This one has to be able to
 * disappear *including its heading*: the API answers `403` to anyone not named in the
 * deployment's `INSTANCE_ADMIN_EMAILS`, which on a default install is everyone, and a heading
 * reading "Activation" above an empty space would advertise a screen most people can never
 * open and invite a support question with no answer.
 *
 * ## Why a failure is silent
 *
 * `useApiResource` is given no error message on purpose. A refusal here is the *expected*
 * response for almost every signed-in user and there is nothing they could do about it — the
 * fix is a line in a `.env` file on the server. Reporting it would turn correct behaviour into
 * an error the reader is asked to interpret. The operator who did set the variable and still
 * sees nothing has a server log; a sentence on the settings page would not have helped them
 * either.
 */
export function ActivationFunnel(): React.ReactElement | null {
  const t = useTranslations('app.settings.activation');
  // `null` as the message, not a catalogue key: `failed` is read instead of `error`, because
  // this screen has nothing to say about a refusal it expects.
  const { data, loading, failed } = useApiResource<ActivationFunnelDto | null>(
    fetchActivationFunnel,
    null,
    null,
  );

  // Nothing at all until the answer is known: a skeleton would flash a section header at every
  // reader on every settings load, which is exactly the advertising the 403 case avoids.
  if (loading && !data) {
    return null;
  }

  if (failed || !data) {
    return null;
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-title font-strong">{t('title')}</h2>
        <p className="text-body text-muted-foreground">{t('description')}</p>
      </div>

      {/* The North Star first. It is the number the roadmap is steered by, and the two beside
          it are the context that stops it being read wrong — a 3 is excellent out of 4 team
          workspaces and a crisis out of 400. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label={t('northStar.activeTeams', { days: data.northStar.windowDays })}
          value={data.northStar.weeklyActiveTeamWorkspaces}
        />
        <StatTile
          label={t('northStar.activeWorkspaces', { days: data.northStar.windowDays })}
          value={data.northStar.weeklyActiveWorkspaces}
        />
        <StatTile label={t('northStar.teamWorkspaces')} value={data.northStar.teamWorkspaces} />
      </div>
      <p className="text-small text-muted-foreground">{t('northStar.help')}</p>

      <ol className="flex flex-col gap-2">
        {data.steps.map((step) => (
          <FunnelRow key={step.event} dto={data} step={step} />
        ))}
      </ol>

      <p className="text-small text-muted-foreground">{t('localOnly')}</p>
    </section>
  );
}

/**
 * One step: what it is, how many, and how wide that is next to the widest step.
 *
 * The `instance` unit gets words instead of a bar — see `stepBarPercent` for why a boolean
 * drawn as a quantity misleads. It is still a row in the same list rather than a note beside
 * it, because its position in the sequence is the information: it sits where it explains the
 * drop from "invite sent" to "invite accepted".
 */
function FunnelRow({
  dto,
  step,
}: Readonly<{ dto: ActivationFunnelDto; step: ActivationStepDto }>): React.ReactElement {
  const t = useTranslations('app.settings.activation');
  const label = t(ACTIVATION_STEP_LABEL_KEYS[step.event]);

  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-body">
          {label}
          {step.window === 'rolling-week' ? (
            <span className="text-small text-muted-foreground">
              {' '}
              {t('windowSuffix', { days: dto.northStar.windowDays })}
            </span>
          ) : null}
        </span>
        <span className="text-small tabular-nums text-muted-foreground">
          {step.unit === 'instance'
            ? step.count > 0
              ? t('configured')
              : t('notConfigured')
            : t('peopleCount', { count: step.count })}
        </span>
      </div>
      {step.unit === 'users' ? (
        <div
          className="h-2 w-full overflow-hidden rounded-[var(--radius-sm)] bg-muted"
          // The bar is decoration over a number that is already written out beside it, so it
          // carries no accessible name of its own — a screen reader that announced both would
          // read the same figure twice.
          aria-hidden="true"
        >
          <div
            className="h-full rounded-[var(--radius-sm)] bg-primary"
            style={{ width: `${stepBarPercent(dto, step.count)}%` }}
          />
        </div>
      ) : null}
    </li>
  );
}
