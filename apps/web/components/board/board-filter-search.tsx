'use client';

import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';

interface BoardFilterSearchProps {
  /** The committed query from the URL; the box keeps its own draft between commits. */
  value: string | undefined;
  /** Called with the trimmed draft — an empty string means "no query". */
  onCommit: (query: string) => void;
}

/**
 * The board search box. Typing is local state so every keystroke does not rewrite the URL;
 * the draft is only committed on Enter or blur, and `/` from anywhere on the page focuses it.
 */
export function BoardFilterSearch({ value, onCommit }: BoardFilterSearchProps): React.ReactElement {
  const t = useTranslations('app.board.filter');
  const searchRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value ?? '');

  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      // A `/` typed into a field is a slash, not a shortcut.
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="relative min-w-0 flex-1 max-w-xs">
      <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={searchRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onCommit(draft.trim())}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onCommit(draft.trim());
          }
        }}
        placeholder={t('searchPlaceholder')}
        aria-label={t('searchLabel')}
        className="h-8 pl-7 text-small"
      />
    </div>
  );
}
