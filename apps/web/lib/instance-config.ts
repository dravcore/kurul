import type { InstanceConfigDto } from '@kurul/shared-types';
import { api } from '@/lib/api';

/**
 * Where an operator goes to switch outbound email on.
 *
 * A GitHub URL rather than an in-app page or a relative link: the docs live in the repository
 * and Kurul ships no documentation site, so this is the only address that resolves for a
 * self-hosted install. Pinned to `main` — a self-hoster is running a release, and `develop`
 * would show them setup steps their build may not have.
 *
 * Kept in code rather than in `messages/en.json` because it is an address, not copy: a
 * translator has nothing to change here, and a mistyped one fails silently in a way a missing
 * catalogue key would not.
 */
export const SMTP_SETUP_DOCS_URL =
  'https://github.com/dravcore/kurul/blob/main/docs/development.md#smtp-and-mailpit';

/**
 * What this API instance is configured to do — see `InstanceConfigDto`.
 *
 * Fetched per screen that needs it rather than hoisted into a provider. It is one small
 * document, only the members screen reads it today, and a provider would have to decide when
 * to invalidate a value that changes only when the server restarts.
 */
export function fetchInstanceConfig(init?: RequestInit): Promise<InstanceConfigDto> {
  return api.get<InstanceConfigDto>('/config', init);
}
