import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { waitForBoardReady } from '../support/board-page';
import { expect, test, type TestUser } from '../support/fixtures';
import type { Stack } from '../support/stack';

/**
 * The axe half of a UI phase's closing evidence: six routes, both themes, twelve reads.
 *
 * Run by hand at the end of a phase that moved colour tokens, focus handling or shell shape:
 *
 *     pnpm --filter @kurul/e2e exec playwright test -c audit.config.ts
 *
 * The routes are the ones UI work keeps landing on. `/dashboard` and the board carry the shell,
 * the roving column strip and the card meta rows; the task route is the panel with every field
 * and live region on it; the three settings routes are the forms, the member list and the
 * delete-account confirmation. A phase that touches something outside this list adds it here
 * rather than sweeping it from a throwaway script.
 *
 * Both themes, because the two palettes are separate token blocks in `app/globals.css` and a
 * contrast rule can hold in one and fail in the other. The theme is written into
 * `localStorage` before the first navigation, which is where `next-themes` reads it in its
 * pre-paint script, and then *asserted* on `<html>`: a sweep that quietly ran both passes in
 * light is one measurement reported twice.
 *
 * ## What this asserts, and what it only records
 *
 * Serious and critical violations fail the run. Moderate and minor are written to the report
 * and left there: axe's own severities are advisory, and a rig that fails on all four would be
 * a rig somebody turns off. The report is the artefact a phase attaches to its handoff.
 *
 * Nothing here is a substitute for the in-process gates. `app/globals.contrast.test.ts`
 * measures every token pair against every surface, including combinations no route paints
 * today; axe can only see what these twelve pages actually rendered.
 */

/** Where the JSON lands. Overridable so a phase can name its own file. */
const REPORT_PATH = resolve(process.env.AXE_REPORT ?? 'test-results/axe-sweep.json');

/**
 * WCAG 2.1 A and AA, which is the standard `docs/design.md` §9 holds the product to, plus
 * axe's own best-practice set for the rules that catch a broken landmark or heading order
 * before a person does.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

/**
 * Read off `analyze()` rather than imported from `axe-core`. axe-core is a transitive
 * dependency of `@axe-core/playwright` and pnpm does not hoist it, so it is not resolvable
 * from this workspace by name.
 */
type Violation = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number];

interface Route {
  name: string;
  path: string;
  /** Waits until the route has painted whatever axe has to read. */
  settle: (page: Page) => Promise<void>;
}

interface Finding {
  id: string;
  impact: string;
  help: string;
  /**
   * Selector and markup per offending element. The markup is not redundant: half the ids in
   * this tree come from React's `useId`, so a target like `#_r_t_` names nothing a reader can
   * find in the source, and without the element beside it the report costs a second run to
   * interpret.
   */
  nodes: { target: string; html: string }[];
}

interface RouteReport {
  path: string;
  violationCount: number;
  critical: Finding[];
  serious: Finding[];
  moderate: Finding[];
  minor: Finding[];
}

/**
 * The generic readiness wait: `<main>` painted and every skeleton gone.
 *
 * Skeletons rather than a network idle, because the board holds a Socket.io connection open
 * and a page with a live socket never goes idle. A skeleton is also the more honest signal:
 * it is exactly the placeholder axe would otherwise audit instead of the content.
 */
async function settled(page: Page): Promise<void> {
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
}

function findings(violations: Violation[], impact: string): Finding[] {
  return violations
    .filter((violation) => violation.impact === impact)
    .map((violation) => ({
      id: violation.id,
      impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => ({ target: node.target.join(' '), html: node.html })),
    }));
}

async function sweep(page: Page, route: Route, theme: Theme): Promise<RouteReport> {
  await page.addInitScript((stored) => {
    window.localStorage.setItem('theme', stored);
  }, theme);
  await page.goto(route.path);
  await route.settle(page);
  // The theme actually applied, not the one that was asked for. `next-themes` writes the class
  // onto <html> from its pre-paint script; if the nonce ever stops reaching that script the
  // page paints light and every dark row below would be a light row wearing a dark label.
  await expect(page.locator('html')).toHaveClass(new RegExp(`(^|\\s)${theme}(\\s|$)`));

  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return {
    path: route.path,
    violationCount: results.violations.length,
    critical: findings(results.violations, 'critical'),
    serious: findings(results.violations, 'serious'),
    moderate: findings(results.violations, 'moderate'),
    minor: findings(results.violations, 'minor'),
  };
}

/** One workspace, one board, one card, which is what the six routes need between them. */
async function seed(
  stack: Stack,
  owner: TestUser,
): Promise<{ routes: Route[]; workspaceId: string }> {
  const workspace = await stack.createWorkspace(owner);
  const { board, columns } = await stack.createBoard(owner, workspace.id);
  const todo = columns[0]!;
  const task = await stack.createTask(
    owner,
    workspace.id,
    board.id,
    todo.id,
    'Audit the closing evidence',
  );

  return {
    workspaceId: workspace.id,
    routes: [
      { name: 'dashboard', path: '/dashboard', settle: settled },
      { name: 'board', path: `/board/${board.id}`, settle: waitForBoardReady },
      {
        name: 'task',
        path: `/board/${board.id}/task/${task.id}`,
        settle: async (page) => {
          await waitForBoardReady(page);
          await expect(page.locator('[data-slot="task-panel"]')).toBeVisible();
        },
      },
      { name: 'settings', path: '/settings', settle: settled },
      { name: 'settings-members', path: '/settings/members', settle: settled },
      { name: 'settings-account-delete', path: '/settings/account/delete', settle: settled },
    ],
  };
}

test('axe finds nothing serious on the six phase routes, in either theme', async ({
  stack,
  openAs,
}) => {
  const owner = await stack.createUser();
  const { routes } = await seed(stack, owner);

  const results: Record<string, RouteReport> = {};
  for (const theme of THEMES) {
    for (const route of routes) {
      // A page per read rather than one navigated twelve times: `localStorage` is written from
      // an init script, and an init script added to a page that has already navigated does not
      // apply until the next load anyway.
      const page = await openAs(owner);
      results[`${theme}:${route.name}`] = await sweep(page, route, theme);
      await page.close();
    }
  }

  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(
    REPORT_PATH,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        routes: routes.map(({ name, path }) => ({ name, path })),
        results,
      },
      null,
      2,
    )}\n`,
  );

  const blocking = Object.entries(results).flatMap(([key, report]) =>
    [...report.critical, ...report.serious].map(
      (finding) =>
        `${key} ${finding.impact} ${finding.id}: ${finding.nodes
          .map((node) => node.target)
          .join(', ')}`,
    ),
  );
  expect(blocking, `axe report written to ${REPORT_PATH}`).toEqual([]);
});
