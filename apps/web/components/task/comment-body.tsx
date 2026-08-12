'use client';

import { tokenizeMentions } from '@/lib/mentions';
import { cn } from '@/lib/utils';

interface CommentBodyProps {
  body: string;
  className?: string;
}

/** Renders comment text with `@[Name](userId)` tokens as mention chips. */
export function CommentBody({ body, className }: CommentBodyProps): React.ReactElement {
  const tokens = tokenizeMentions(body);

  return (
    <p className={cn('whitespace-pre-wrap text-body text-foreground', className)}>
      {tokens.map((token, index) => {
        if (token.kind === 'text') {
          return <span key={`t-${index}`}>{token.text}</span>;
        }
        return (
          <span
            key={`m-${token.userId}-${index}`}
            className="inline-flex items-center rounded-[var(--radius-sm)] bg-signature-subtle px-1 py-0.5 text-small font-medium text-signature"
            data-user-id={token.userId}
          >
            @{token.name}
          </span>
        );
      })}
    </p>
  );
}
