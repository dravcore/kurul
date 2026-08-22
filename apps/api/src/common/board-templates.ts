/**
 * The board templates a creator can pick from, and the seed rows each one writes.
 *
 * **Code, not database rows.** A template is a starting shape, not a resource: nobody edits
 * one, nothing points at one after the board exists, and a workspace does not own a private
 * copy. Storing them would buy a table, a migration and a seeding script in exchange for a
 * list that ships with the release anyway. The consequence to accept is that adding a template
 * is a deploy, which is the same cost as adding a locale, and for the same reason.
 *
 * **Why the names live here and not in `@kurul/shared-types`.** For the column and label names
 * this is the rule `board-defaults.ts` already follows: they are data the API writes on the
 * user's behalf (ADR 0018 §3), seeded once in the creator's language and owned by the board
 * from then on. The *template's* own name and description are the one addition, and they are
 * resolved in the same locale rather than from the web's catalog on purpose: a picker card is
 * a promise about the rows that are about to be written, and the alternative renders the title
 * from the browser's language while the columns underneath it come back in the creator's
 * stored one. One card, one language, one source.
 *
 * See docs/decisions/0018-localization-strategy.md and
 * docs/decisions/0019-column-category.md.
 */
import { ColumnCategory, LabelColorSlot, type Locale } from '@kurul/shared-types';
import type { DefaultColumn } from './board-defaults';

/**
 * Seed label for a new board.
 *
 * `color` is a design-token slot, never a raw hex value: the slot resolves per theme, so a
 * preset chosen once stays legible in light and dark.
 */
export interface DefaultLabel {
  name: string;
  color: LabelColorSlot;
}

/** One template, resolved into the rows it writes and the text a picker renders. */
export interface BoardTemplate {
  slug: BoardTemplateSlug;
  name: string;
  description: string;
  columns: DefaultColumn[];
  labels: DefaultLabel[];
}

/**
 * The locale-independent half: which columns and labels, in what order, meaning what.
 *
 * Held apart from the names, and it matters more here than it did for the single seed list this
 * replaced: a template is judged by its shape, and a translator must not be able to move a
 * stage, change what it means, or repaint a chip.
 *
 * Positions are spaced by 1000 and are `Float` — fractional indexing, never contiguous ints —
 * so a column can be dropped between any two neighbours without rewriting the board.
 */
const TEMPLATE_STRUCTURE = {
  /**
   * First on purpose. Its columns are exactly what `defaultColumnsFor` returns, and
   * `board-templates.spec.ts` fails if the two ever drift: this is the shape every board in
   * the product already has, so it has to stay the shape the picker opens on.
   */
  kanban: {
    columns: [
      { key: 'todo', position: 1000, category: ColumnCategory.UNSTARTED },
      { key: 'inProgress', position: 2000, category: ColumnCategory.STARTED },
      { key: 'done', position: 3000, category: ColumnCategory.COMPLETED },
    ],
    labels: [
      { key: 'bug', color: LabelColorSlot['slot-1'] },
      { key: 'feature', color: LabelColorSlot['slot-2'] },
      { key: 'chore', color: LabelColorSlot['slot-3'] },
      { key: 'blocked', color: LabelColorSlot['slot-4'] },
    ],
  },
  'scrum-sprint': {
    columns: [
      { key: 'backlog', position: 1000, category: ColumnCategory.BACKLOG },
      { key: 'sprintBacklog', position: 2000, category: ColumnCategory.UNSTARTED },
      { key: 'inProgress', position: 3000, category: ColumnCategory.STARTED },
      { key: 'review', position: 4000, category: ColumnCategory.STARTED },
      { key: 'done', position: 5000, category: ColumnCategory.COMPLETED },
    ],
    labels: [
      { key: 'story', color: LabelColorSlot['slot-1'] },
      { key: 'bug', color: LabelColorSlot['slot-2'] },
      { key: 'spike', color: LabelColorSlot['slot-3'] },
      { key: 'techDebt', color: LabelColorSlot['slot-4'] },
      { key: 'blocked', color: LabelColorSlot['slot-5'] },
    ],
  },
  /**
   * The one template with a `CANCELED` column. A rejected report is neither finished work nor
   * open work, which is the distinction ADR 0019 shipped the category for; without it a triage
   * board either counts every "won't fix" as throughput or leaves it open forever.
   */
  'bug-triage': {
    columns: [
      { key: 'reported', position: 1000, category: ColumnCategory.BACKLOG },
      { key: 'triaged', position: 2000, category: ColumnCategory.UNSTARTED },
      { key: 'fixing', position: 3000, category: ColumnCategory.STARTED },
      { key: 'verifying', position: 4000, category: ColumnCategory.STARTED },
      { key: 'closed', position: 5000, category: ColumnCategory.COMPLETED },
      { key: 'wontFix', position: 6000, category: ColumnCategory.CANCELED },
    ],
    labels: [
      { key: 'critical', color: LabelColorSlot['slot-1'] },
      { key: 'major', color: LabelColorSlot['slot-2'] },
      { key: 'minor', color: LabelColorSlot['slot-3'] },
      { key: 'regression', color: LabelColorSlot['slot-4'] },
      { key: 'needsInfo', color: LabelColorSlot['slot-5'] },
    ],
  },
  'content-pipeline': {
    columns: [
      { key: 'ideas', position: 1000, category: ColumnCategory.BACKLOG },
      { key: 'approved', position: 2000, category: ColumnCategory.UNSTARTED },
      { key: 'drafting', position: 3000, category: ColumnCategory.STARTED },
      { key: 'editing', position: 4000, category: ColumnCategory.STARTED },
      { key: 'published', position: 5000, category: ColumnCategory.COMPLETED },
    ],
    labels: [
      { key: 'blog', color: LabelColorSlot['slot-1'] },
      { key: 'social', color: LabelColorSlot['slot-2'] },
      { key: 'video', color: LabelColorSlot['slot-3'] },
      { key: 'newsletter', color: LabelColorSlot['slot-4'] },
    ],
  },
} as const satisfies Record<
  string,
  {
    readonly columns: readonly { key: string; position: number; category: ColumnCategory }[];
    readonly labels: readonly { key: string; color: LabelColorSlot }[];
  }
>;

/** The stable identifier a client sends and the API validates against. Never a display name. */
export type BoardTemplateSlug = keyof typeof TEMPLATE_STRUCTURE;

type ColumnKeyOf<S extends BoardTemplateSlug> =
  (typeof TEMPLATE_STRUCTURE)[S]['columns'][number]['key'];
type LabelKeyOf<S extends BoardTemplateSlug> =
  (typeof TEMPLATE_STRUCTURE)[S]['labels'][number]['key'];

interface TemplateCopy<S extends BoardTemplateSlug> {
  name: string;
  description: string;
  columns: Record<ColumnKeyOf<S>, string>;
  labels: Record<LabelKeyOf<S>, string>;
}

/**
 * The locale-dependent half: what everything is called.
 *
 * Typed so that a missing language, a missing template, a missing column or a missing label is
 * a compile error rather than a board that comes out half in English. It is the mechanism
 * `MAIL_COPY` uses, extended one level: adding a language to `SUPPORTED_LOCALES`, or a template
 * above, breaks this object until its copy is supplied.
 *
 * Names are short on purpose. A column name renders as a board header and a label name as a
 * chip, the two tightest slots in the product, and a translation that is merely accurate but
 * long is a layout defect in that language only.
 */
const TEMPLATE_COPY: Record<Locale, { [S in BoardTemplateSlug]: TemplateCopy<S> }> = {
  en: {
    kanban: {
      name: 'Kanban',
      description: 'One flow, three stages. What every board starts as.',
      columns: { todo: 'To Do', inProgress: 'In Progress', done: 'Done' },
      labels: { bug: 'Bug', feature: 'Feature', chore: 'Chore', blocked: 'Blocked' },
    },
    'scrum-sprint': {
      name: 'Scrum Sprint',
      description: 'A backlog that feeds a sprint, with a review stage before done.',
      columns: {
        backlog: 'Backlog',
        sprintBacklog: 'Sprint Backlog',
        inProgress: 'In Progress',
        review: 'Review',
        done: 'Done',
      },
      labels: {
        story: 'Story',
        bug: 'Bug',
        spike: 'Spike',
        techDebt: 'Tech Debt',
        blocked: 'Blocked',
      },
    },
    'bug-triage': {
      name: 'Bug Triage',
      description: 'Incoming reports through fixing and verification, with a way to say no.',
      columns: {
        reported: 'Reported',
        triaged: 'Triaged',
        fixing: 'Fixing',
        verifying: 'Verifying',
        closed: 'Closed',
        wontFix: 'Won’t Fix',
      },
      labels: {
        critical: 'Critical',
        major: 'Major',
        minor: 'Minor',
        regression: 'Regression',
        needsInfo: 'Needs Info',
      },
    },
    'content-pipeline': {
      name: 'Content Pipeline',
      description: 'Ideas through drafting and editing to published.',
      columns: {
        ideas: 'Ideas',
        approved: 'Approved',
        drafting: 'Drafting',
        editing: 'Editing',
        published: 'Published',
      },
      labels: {
        blog: 'Blog',
        social: 'Social',
        video: 'Video',
        newsletter: 'Newsletter',
      },
    },
  },
  tr: {
    kanban: {
      name: 'Kanban',
      description: 'Tek akış, üç aşama. Her panonun başladığı yer.',
      columns: { todo: 'Yapılacak', inProgress: 'Devam Ediyor', done: 'Bitti' },
      labels: { bug: 'Hata', feature: 'Özellik', chore: 'Rutin İş', blocked: 'Engelli' },
    },
    'scrum-sprint': {
      name: 'Scrum Sprinti',
      description: 'Sprinti besleyen bir birikim listesi, bitmeden önce inceleme aşaması.',
      columns: {
        backlog: 'Birikim',
        sprintBacklog: 'Sprint Birikimi',
        inProgress: 'Devam Ediyor',
        review: 'İnceleme',
        done: 'Bitti',
      },
      labels: {
        story: 'Hikâye',
        bug: 'Hata',
        spike: 'Araştırma',
        techDebt: 'Teknik Borç',
        blocked: 'Engelli',
      },
    },
    'bug-triage': {
      name: 'Hata Triyajı',
      description: 'Gelen raporlar düzeltme ve doğrulamadan geçer, reddetme yolu da vardır.',
      columns: {
        reported: 'Bildirildi',
        triaged: 'Triyaj Edildi',
        fixing: 'Düzeltiliyor',
        verifying: 'Doğrulanıyor',
        closed: 'Kapandı',
        wontFix: 'Düzeltilmeyecek',
      },
      labels: {
        critical: 'Kritik',
        major: 'Önemli',
        minor: 'Küçük',
        regression: 'Regresyon',
        needsInfo: 'Bilgi Gerekli',
      },
    },
    'content-pipeline': {
      name: 'İçerik Hattı',
      description: 'Fikirlerden yazım ve düzenlemeye, oradan yayına.',
      columns: {
        ideas: 'Fikirler',
        approved: 'Onaylandı',
        drafting: 'Yazılıyor',
        editing: 'Düzenleniyor',
        published: 'Yayında',
      },
      labels: {
        blog: 'Blog',
        social: 'Sosyal Medya',
        video: 'Video',
        newsletter: 'Bülten',
      },
    },
  },
};

/**
 * Every slug, in the order a picker lists them.
 *
 * Derived from the catalog rather than written out again: `CreateBoardDto` validates against
 * this list, so a template that exists but is not accepted (or the reverse) is not expressible.
 */
export const BOARD_TEMPLATE_SLUGS = Object.keys(TEMPLATE_STRUCTURE) as BoardTemplateSlug[];

/**
 * The template a board gets when the client names none.
 *
 * Not the same thing as "what an omitted `template` does" — see `BoardService.create`. This is
 * what the picker opens on.
 */
export const DEFAULT_BOARD_TEMPLATE: BoardTemplateSlug = 'kanban';

/** Narrowing guard for a value off the network. */
export function isBoardTemplateSlug(value: unknown): value is BoardTemplateSlug {
  return typeof value === 'string' && Object.hasOwn(TEMPLATE_STRUCTURE, value);
}

/**
 * One template, named in `locale`.
 *
 * Returns fresh arrays of fresh objects: callers hand these straight to Prisma's nested create,
 * and a shared mutable catalog would let one request's edit leak into the next board anyone
 * creates.
 */
export function boardTemplateFor(slug: BoardTemplateSlug, locale: Locale): BoardTemplate {
  const structure = TEMPLATE_STRUCTURE[slug];
  const copy = TEMPLATE_COPY[locale][slug];
  return {
    slug,
    name: copy.name,
    description: copy.description,
    columns: structure.columns.map(({ key, position, category }) => ({
      name: (copy.columns as Record<string, string>)[key]!,
      position,
      category,
    })),
    labels: structure.labels.map(({ key, color }) => ({
      name: (copy.labels as Record<string, string>)[key]!,
      color,
    })),
  };
}

/** The whole catalog, named in `locale`, in picker order. */
export function boardTemplatesFor(locale: Locale): BoardTemplate[] {
  return BOARD_TEMPLATE_SLUGS.map((slug) => boardTemplateFor(slug, locale));
}
