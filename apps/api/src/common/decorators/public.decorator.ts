import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Skip SessionAuthGuard (e.g. health). */
export const Public = (): ReturnType<typeof SetMetadata> => SetMetadata(IS_PUBLIC_KEY, true);
