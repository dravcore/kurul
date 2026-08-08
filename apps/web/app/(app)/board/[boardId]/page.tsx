import { getTranslations } from 'next-intl/server';

export default async function BoardPage({
  params,
}: {
  params: Promise<{ boardId: string }>;
}): Promise<React.ReactElement> {
  const { boardId } = await params;
  const t = await getTranslations();

  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">{boardId}</h1>
      <p className="text-sm text-[var(--color-muted-foreground)]">{t('app.board.placeholder')}</p>
    </section>
  );
}
