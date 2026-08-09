import { cn } from '@/lib/utils';

/* Hand-authored tamga: horns, stem, ground line — 24px grid, 1.5px stroke
   (design.md §2). The only surface family where this mark may appear is
   empty states, auth, and the wordmark. */
export function DamgaMark({
  size = 96,
  className,
}: Readonly<{
  size?: number;
  className?: string;
}>): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('text-signature', className)}
      aria-hidden
    >
      <path d="M12 21V9" />
      <path d="M12 9C8.7 9 6 6.3 6 3" />
      <path d="M12 9c3.3 0 6-2.7 6-6" />
      <path d="M8 21h8" />
    </svg>
  );
}
