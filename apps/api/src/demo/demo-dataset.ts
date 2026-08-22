import { ColumnCategory, Priority } from '../generated/prisma';

/**
 * The golden dataset the demo instance is restored to, every interval, forever.
 *
 * Data, not code: `reset.ts` walks these structures and writes them, so changing what the demo
 * shows is an edit to a literal and never to the wipe-and-rebuild logic that has to stay
 * boring. It is deliberately *not* `prisma/seed.ts`. The seed is a development fixture that
 * cannot ship — it runs through `pnpm exec tsx` (`prisma.config.ts`), which the production
 * image has no tsx and no pnpm workspace to satisfy, and `assertSeedAllowed` refuses it under
 * `NODE_ENV=production` on purpose. Trying to reuse it would have meant either loosening that
 * refusal or shipping a toolchain into the runtime image; both are worse than a second dataset.
 *
 * It is also written for a different reader. The seed exists so a developer has *something* on
 * the board; this is the first screen a stranger sees after clicking a link in an announcement,
 * so every column has work in it, tasks carry due dates, estimates, labels, assignees, comments
 * and checklists, and the two boards show the product doing two different jobs.
 *
 * ## Dates are relative
 *
 * Every date is an offset in days from the moment of the reset, resolved in `reset.ts`. A fixed
 * ISO date would be correct on the day it was written and would spend the rest of the demo's
 * life rendering as overdue — which is the one thing a board full of red cards teaches a
 * visitor about the product that is not true.
 */

/** The one account whose password is published. `DEMO_PASSWORD` supplies the password. */
export const DEMO_USER_EMAIL = 'demo@kurul.dev';
export const DEMO_USER_NAME = 'Demo User';

/**
 * A second person, so the demo has comments and assignments that are not all the visitor's own.
 *
 * Created as a bare `User` row with **no `Account` row**, which is what makes it unable to sign
 * in at all: Better Auth resolves credentials through `Account`, so there is no password to
 * guess and none to leak. The address is under `.invalid`, the TLD RFC 2606 reserves precisely
 * so that it can never resolve — the demo host's mail goes to the log anyway (`DEMO_MODE`
 * selects the log transport), but a fixture address that could one day belong to a real mailbox
 * is not a thing to ship.
 */
export const DEMO_TEAMMATE_EMAIL = 'avery@demo.invalid';
export const DEMO_TEAMMATE_NAME = 'Avery Kim';

export const DEMO_WORKSPACE_NAME = 'Kurul Demo';
export const DEMO_WORKSPACE_SLUG = 'demo';

/** Who a seeded task or comment belongs to. Resolved to a real user id by `reset.ts`. */
export type DemoPerson = 'demo' | 'teammate';

export interface DemoChecklistSeed {
  title: string;
  items: readonly { content: string; isDone: boolean }[];
}

export interface DemoCommentSeed {
  author: DemoPerson;
  body: string;
  /** Days before the reset. Positive numbers are in the past. */
  daysAgo: number;
}

export interface DemoTaskSeed {
  title: string;
  description?: string;
  priority: Priority;
  /** Index into the board's `columns`. */
  column: number;
  /** Indices into the board's `labels`. */
  labels?: readonly number[];
  assignees?: readonly DemoPerson[];
  /** Days from the reset; negative is overdue, omitted is no due date. */
  dueInDays?: number;
  estimatedMinutes?: number;
  comments?: readonly DemoCommentSeed[];
  checklists?: readonly DemoChecklistSeed[];
}

export interface DemoColumnSeed {
  name: string;
  category: ColumnCategory;
}

export interface DemoLabelSeed {
  name: string;
  /** A design-token slot, never a hex (CLAUDE.md). */
  color: string;
}

export interface DemoBoardSeed {
  name: string;
  description: string;
  columns: readonly DemoColumnSeed[];
  labels: readonly DemoLabelSeed[];
  tasks: readonly DemoTaskSeed[];
}

/**
 * Two boards, chosen to show two shapes of work rather than the same board twice: a product
 * team's delivery flow, and a support queue where "done" means answered.
 */
export const DEMO_BOARDS: readonly DemoBoardSeed[] = [
  {
    name: 'Product Roadmap',
    description: 'What the team is building this quarter',
    columns: [
      { name: 'Backlog', category: ColumnCategory.BACKLOG },
      { name: 'To Do', category: ColumnCategory.UNSTARTED },
      { name: 'In Progress', category: ColumnCategory.STARTED },
      { name: 'Review', category: ColumnCategory.STARTED },
      { name: 'Done', category: ColumnCategory.COMPLETED },
    ],
    labels: [
      { name: 'Feature', color: 'slot-1' },
      { name: 'Bug', color: 'slot-2' },
      { name: 'Design', color: 'slot-3' },
      { name: 'Docs', color: 'slot-4' },
      { name: 'Infra', color: 'slot-5' },
    ],
    tasks: [
      {
        title: 'Dark mode for the board view',
        description:
          'Colours come from the design tokens, so the label slots resolve per theme. Nothing stores a hex.',
        priority: Priority.MEDIUM,
        column: 0,
        labels: [0, 2],
        estimatedMinutes: 480,
      },
      {
        title: 'Keyboard shortcuts for moving a card',
        description: 'Arrow keys move a focused card between columns without a pointer.',
        priority: Priority.LOW,
        column: 0,
        labels: [0],
      },
      {
        title: 'Export a board to CSV',
        priority: Priority.LOW,
        column: 0,
        labels: [0],
        estimatedMinutes: 240,
      },
      {
        title: 'Weekly digest email',
        description: 'One email per person per week instead of one per notification.',
        priority: Priority.MEDIUM,
        column: 1,
        labels: [0],
        assignees: ['teammate'],
        dueInDays: 9,
        estimatedMinutes: 600,
      },
      {
        title: 'Fix drag-and-drop on touch devices',
        description: 'A long press starts a drag on iOS but the drop target is off by a row.',
        priority: Priority.HIGH,
        column: 1,
        labels: [1],
        dueInDays: 3,
        estimatedMinutes: 180,
        comments: [
          {
            author: 'teammate',
            body: 'Reproduced on iPhone 15, Safari. Chrome on the same device is fine, so it is the pointer-event fallback.',
            daysAgo: 2,
          },
        ],
      },
      {
        title: 'Board templates',
        description: 'Pick a starting set of columns and labels when creating a board.',
        priority: Priority.HIGH,
        column: 2,
        labels: [0, 2],
        assignees: ['demo'],
        dueInDays: 5,
        estimatedMinutes: 900,
        checklists: [
          {
            title: 'Scope',
            items: [
              { content: 'Three built-in templates', isDone: true },
              { content: 'Translated in en and tr', isDone: true },
              { content: 'Selectable at board creation', isDone: false },
              { content: 'Column categories set per template', isDone: false },
            ],
          },
        ],
        comments: [
          {
            author: 'demo',
            body: 'Starting with Kanban, Scrum and Support. A custom template can wait until someone asks for one.',
            daysAgo: 4,
          },
          {
            author: 'teammate',
            body: 'Agreed. Please keep the label slots the same across all three so the theme work does not fork.',
            daysAgo: 3,
          },
        ],
      },
      {
        title: 'Rate-limit the invitation endpoint',
        description: 'Per-IP and per-workspace, so a single account cannot fan out invitations.',
        priority: Priority.URGENT,
        column: 2,
        labels: [4],
        assignees: ['teammate'],
        dueInDays: -1,
        estimatedMinutes: 120,
      },
      {
        title: 'Self-hosting guide: reverse proxy section',
        priority: Priority.MEDIUM,
        column: 3,
        labels: [3],
        assignees: ['demo'],
        dueInDays: 2,
        estimatedMinutes: 240,
        comments: [
          {
            author: 'teammate',
            body: 'Reads well. One ask: say what the two body-size limits are for, not just what they are.',
            daysAgo: 1,
          },
        ],
      },
      {
        title: 'Trello import',
        description: 'Read a Trello JSON export and write the board once, with no partial state.',
        priority: Priority.HIGH,
        column: 4,
        labels: [0],
        assignees: ['demo', 'teammate'],
        estimatedMinutes: 1200,
      },
      {
        title: 'Attachment storage quotas',
        description: 'Per workspace and per instance, both configurable, both unlimited at zero.',
        priority: Priority.MEDIUM,
        column: 4,
        labels: [4],
        assignees: ['teammate'],
        estimatedMinutes: 360,
      },
      {
        title: 'Turkish interface',
        priority: Priority.MEDIUM,
        column: 4,
        labels: [0, 3],
        assignees: ['demo'],
        estimatedMinutes: 720,
      },
    ],
  },
  {
    name: 'Support Queue',
    description: 'Incoming questions from self-hosters',
    columns: [
      { name: 'New', category: ColumnCategory.UNSTARTED },
      { name: 'Investigating', category: ColumnCategory.STARTED },
      { name: 'Waiting on reporter', category: ColumnCategory.STARTED },
      { name: 'Answered', category: ColumnCategory.COMPLETED },
      { name: "Won't fix", category: ColumnCategory.CANCELED },
    ],
    labels: [
      { name: 'Docker', color: 'slot-6' },
      { name: 'Email', color: 'slot-7' },
      { name: 'Upgrade', color: 'slot-8' },
    ],
    tasks: [
      {
        title: 'Invitations are never delivered',
        description: 'SMTP_HOST is unset, so mail is written to the API log instead of sent.',
        priority: Priority.HIGH,
        column: 0,
        labels: [1],
        dueInDays: 1,
      },
      {
        title: 'Which port does the proxy publish?',
        priority: Priority.LOW,
        column: 0,
        labels: [0],
      },
      {
        title: 'Upload fails with 413 behind my own nginx',
        description: 'Two size limits have to move together: the proxy and the API.',
        priority: Priority.MEDIUM,
        column: 1,
        labels: [0],
        assignees: ['teammate'],
        estimatedMinutes: 60,
        comments: [
          {
            author: 'teammate',
            body: 'Asked which of the two 413s they see. The bodies differ, which is the whole point of the section.',
            daysAgo: 1,
          },
        ],
      },
      {
        title: 'Migration failed on upgrade from 0.2.0',
        priority: Priority.URGENT,
        column: 2,
        labels: [2],
        assignees: ['demo'],
        dueInDays: -2,
        estimatedMinutes: 90,
      },
      {
        title: 'Redis password is optional, is that safe?',
        description: 'It is, on a single host with no published Redis port. It is not, otherwise.',
        priority: Priority.MEDIUM,
        column: 3,
        labels: [0],
        assignees: ['demo'],
      },
      {
        title: 'Please add a Windows installer',
        priority: Priority.LOW,
        column: 4,
      },
    ],
  },
];
