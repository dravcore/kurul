/**
 * One section of the settings screen: a heading, one sentence about what it decides, and the
 * control that decides it.
 *
 * Extracted the moment there was a second section. The page is a list of these and nothing
 * else, so a new one (workspace name, outbound mail) is a `<SettingsSection>` and its body,
 * not another copy of the heading markup that the next section would drift away from.
 *
 * Lifted out of `app/(app)/settings/page.tsx` when members grew its own route: the members
 * slot on `/settings` is now a link out rather than the roster itself, and that slot is still
 * one `<SettingsSection>` like every other, not a special case with its own markup.
 */
export function SettingsSection({
  title,
  description,
  children,
}: Readonly<{
  title: string;
  description: string;
  children: React.ReactNode;
}>): React.ReactElement {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-title font-semibold">{title}</h2>
        <p className="text-body text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}
