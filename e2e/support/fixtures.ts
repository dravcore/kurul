import {
  test as base,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { Stack, type TestUser } from './stack';

/**
 * Opens a browser tab already signed in as <user>.
 *
 * The session comes from the API context that registered them rather than from typing into
 * the login form, for the same reason the rest of the setup goes over HTTP: only one of these
 * seven scenarios is about signing in, and the other six should not go red when the login
 * page changes. It works because the session cookie Better Auth issues is host-scoped to
 * `localhost` with no port — the API on 4110 and the web app on 3110 are the same cookie
 * origin, which is also why the suite can hand an API-issued session to a browser at all.
 *
 * `options` reaches `browser.newContext` because a few context settings cannot be changed
 * afterwards: `hasTouch` and `isMobile` decide whether the page gets a touchscreen and
 * `pointer: coarse` at all, and `page.setViewportSize` cannot add either. The mobile scenario
 * needs both, and `test.use({ … })` would not reach a context this fixture creates itself.
 */
export type OpenAs = (user: TestUser, options?: BrowserContextOptions) => Promise<Page>;

/**
 * Every test builds its own world — its own accounts, workspace and board, all with generated
 * identifiers. Nothing is shared and nothing is truncated between tests, which is what makes
 * `fullyParallel` safe and what keeps a failure local: a red test here cannot be the residue
 * of the one that ran before it.
 */
export const test = base.extend<{ stack: Stack; openAs: OpenAs }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright's signature for a fixture with no dependencies.
  stack: async ({}, use) => {
    const stack = new Stack();
    await use(stack);
    await stack.dispose();
  },

  openAs: async ({ browser }, use) => {
    // Tracked explicitly rather than trusting the `browser` fixture to reap them: the
    // realtime scenario keeps two contexts open at once, and a leaked context keeps a
    // Socket.io connection (and its board room) alive into the next test.
    const contexts: BrowserContext[] = [];

    await use(async (user: TestUser, options: BrowserContextOptions = {}) => {
      const context = await browser.newContext({
        ...options,
        storageState: await user.api.storageState(),
      });
      contexts.push(context);
      return context.newPage();
    });

    await Promise.all(contexts.map((context) => context.close()));
  },
});

export { expect } from '@playwright/test';
export type { TestUser };
