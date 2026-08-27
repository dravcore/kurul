import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// tailwind-merge only knows Tailwind's own font-size and font-weight class groups. Kurul's type
// scale (docs/design.md §3: text-body/small/micro/title/title-lg/display/read) and the
// font-strong weight name live outside that table, so without this extension a consumer's
// override and a primitive's default land in the DOM together and Tailwind's stylesheet order
// silently decides which one wins instead of `cn()`.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['body', 'small', 'micro', 'title', 'title-lg', 'display', 'read'] }],
      'font-weight': [{ font: ['strong'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
