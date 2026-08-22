import {
  expect,
  test as base,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { Stack, type TestUser } from './stack';

/**
 * Records every Content-Security-Policy violation the browser reports, from every page in a
 * context.
 *
 * This exists because a CSP failure is invisible to every assertion a scenario makes. The
 * policy blocks a script; the page still renders, the element is still there, the click still
 * lands — and the only trace is a line in a console nobody reads. That is exactly how the
 * `'unsafe-inline'` this suite now guards against would come back: someone adds an inline
 * script, it is silently refused in production, and seven green scenarios say nothing.
 *
 * Two sources, because they fail in different directions. The `securitypolicyviolation` DOM
 * event is the precise one — it names the directive and the blocked URI — but it only sees
 * what the document reports. Chromium's console message is the coarse backstop, and it
 * catches violations raised before any listener could exist. A duplicate report costs
 * nothing: the assertion is "the list is empty".
 */
async function collectCspViolations(context: BrowserContext, violations: string[]): Promise<void> {
  await context.exposeFunction('__reportCspViolation', (detail: string) => {
    violations.push(detail);
  });

  // `addInitScript` runs before any script in the document, so the listener is attached
  // before the parser reaches the inline `<script>` `next-themes` puts in `<head>` — the one
  // most likely to be refused if the nonce ever stops being threaded through.
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const target = event.blockedURI || 'inline';
      void (
        window as unknown as { __reportCspViolation: (detail: string) => Promise<void> }
      ).__reportCspViolation(
        `${location.pathname}: ${event.effectiveDirective || event.violatedDirective} blocked ${target}`,
      );
    });
  });

  context.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Content Security Policy')) {
      violations.push(message.text());
    }
  });
}

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
export const test = base.extend<{ stack: Stack; openAs: OpenAs; cspViolations: string[] }>({
  /**
   * Fails any scenario in which the browser refused something the policy did not allow.
   *
   * `auto` so it applies to every test without one of them having to opt in — an opt-in check
   * for a silent failure is a check that is missing from the test where it was needed. It
   * tears down *after* the context fixtures below (Playwright unwinds in reverse dependency
   * order), so every page has closed and flushed its reports before the list is read.
   */
  cspViolations: [
    // eslint-disable-next-line no-empty-pattern -- Playwright's signature for a fixture with no dependencies.
    async ({}, use) => {
      const violations: string[] = [];
      await use(violations);
      expect(violations, 'the browser refused content under the Content-Security-Policy').toEqual(
        [],
      );
    },
    { auto: true },
  ],

  // Playwright's own `context` fixture, wrapped: this is the one the built-in `page` fixture
  // is built from, so overriding it here is what puts the collector on scenarios that never
  // call `openAs`.
  context: async ({ context, cspViolations }, use) => {
    await collectCspViolations(context, cspViolations);
    await use(context);
  },

  // eslint-disable-next-line no-empty-pattern -- Playwright's signature for a fixture with no dependencies.
  stack: async ({}, use) => {
    const stack = new Stack();
    await use(stack);
    await stack.dispose();
  },

  openAs: async ({ browser, cspViolations }, use) => {
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
      await collectCspViolations(context, cspViolations);
      return context.newPage();
    });

    await Promise.all(contexts.map((context) => context.close()));
  },
});

export { expect } from '@playwright/test';
export type { TestUser };
