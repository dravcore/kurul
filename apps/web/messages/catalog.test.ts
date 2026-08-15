import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@kurultay/shared-types';
import messages from './en.json';

/**
 * Guards the English catalogue against the two failures a type-checker cannot see.
 *
 * A key called from code but absent from `en.json` renders as the raw key path in the running
 * app — next-intl resolves it at runtime, so nothing fails to compile and no test that does not
 * render that exact branch will notice. A key present in `en.json` but called from nowhere is
 * the mirror image: dead weight that a translator will faithfully translate into every language
 * the product ever ships.
 *
 * Both matter more than usual here because Turkish is added by translating this file
 * (ADR 0018): a missing key is a screen that silently breaks in the new language, and a dead
 * key is paid-for work that renders nowhere.
 *
 * The scanner is deliberately lenient in the direction that avoids false failures. Liveness
 * only needs *some* file that declares a matching namespace to also contain the remaining key
 * path as a string literal — which is what makes the indirect call styles in this codebase
 * count as uses:
 *
 *   - `resolveApiMessage(err, t, { fallback: 'deleteError', byStatus: { 403: 'forbidden' } })`
 *   - lookup tables such as `{ none: 'noDueDate', overdue: 'overdue', range: 'dueRange' }`
 *   - template keys such as `t(`priorityValues.${task.priority}`)`, matched by prefix
 *   - helper modules that take a bound translator as an argument (`notificationTitle(n, t)`),
 *     where the namespace lives at the call site and only the suffix is in the helper
 *
 * The cost of that leniency is that a key whose literal happens to appear for an unrelated
 * reason under a matching namespace reads as live. That is the right trade: this test exists to
 * catch whole keys being orphaned or misspelled, not to prove every literal is a translation.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');

/**
 * Every `.ts`/`.tsx` file in the web app, tests included.
 *
 * This file is skipped: it quotes namespaces and key paths in its own prose, and a scanner
 * that reads its own documentation as evidence would both invent namespaces and mask orphans.
 */
const scannerFile = fileURLToPath(import.meta.url);

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry.name) && full !== scannerFile) acc.push(full);
  }
  return acc;
}

function flatten(value: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child === 'object') Object.assign(out, flatten(child, full));
    else out[full] = String(child);
  }
  return out;
}

const catalogue = flatten(messages);

const NAMESPACE_RE = /(?:useTranslations|getTranslations)\s*\(\s*['"]([\w.]*)['"]/g;
/** `namespace: 'x'` inside a `createTranslator({ … })` options object. */
const NAMESPACE_OPTION_RE = /namespace\s*:\s*['"]([\w.]*)['"]/g;
/** Any string literal shaped like a key path: `deleteError`, `errors.forbiddenDelete`. */
const KEY_LITERAL_RE = /['"]([A-Za-z]\w*(?:\.\w+)*)['"]/g;
/** The static head of a template key: `` t(`priorityValues.${p}`) `` yields `priorityValues.`. */
const TEMPLATE_PREFIX_RE = /`([A-Za-z][\w.]*)\$\{/g;

interface Scanned {
  file: string;
  namespaces: Set<string>;
  literals: Set<string>;
  templatePrefixes: Set<string>;
}

const scanned: Scanned[] = sourceFiles(webRoot).map((file) => {
  const text = readFileSync(file, 'utf8');
  const collect = (re: RegExp): Set<string> =>
    new Set(
      Array.from(text.matchAll(re), (m) => m[1]).filter(
        (value): value is string => value !== undefined && value !== '',
      ),
    );
  const namespaces = collect(NAMESPACE_RE);
  for (const ns of collect(NAMESPACE_OPTION_RE)) namespaces.add(ns);
  return {
    file: path.relative(webRoot, file),
    namespaces,
    literals: collect(KEY_LITERAL_RE),
    templatePrefixes: collect(TEMPLATE_PREFIX_RE),
  };
});

/** Suffixes used on a translator this file never bound — a helper taking `t` as a parameter. */
const unboundSuffixes = new Set<string>();
for (const { namespaces, literals } of scanned) {
  if (namespaces.size > 0) continue;
  for (const literal of literals) if (literal.includes('.')) unboundSuffixes.add(literal);
}

function evidenceFor(key: string): string | null {
  for (const { file, namespaces, literals, templatePrefixes } of scanned) {
    for (const ns of namespaces) {
      if (!key.startsWith(`${ns}.`)) continue;
      const suffix = key.slice(ns.length + 1);
      if (literals.has(suffix)) return `${file} (namespace ${ns}, key '${suffix}')`;
      for (const prefix of templatePrefixes) {
        if (suffix.startsWith(prefix)) return `${file} (namespace ${ns}, template '${prefix}')`;
      }
    }
  }
  for (const suffix of unboundSuffixes) {
    if (key === suffix || key.endsWith(`.${suffix}`)) return `helper module (key '${suffix}')`;
  }
  return null;
}

describe('en.json', () => {
  it('has no key that nothing renders', () => {
    const orphaned = Object.keys(catalogue).filter((key) => evidenceFor(key) === null);

    expect(orphaned).toEqual([]);
  });

  it('defines every namespace the code asks for', () => {
    const declared = new Set(scanned.flatMap(({ namespaces }) => Array.from(namespaces)));
    const known = new Set<string>();
    for (const key of Object.keys(catalogue)) {
      const parts = key.split('.');
      for (let i = 1; i < parts.length; i += 1) known.add(parts.slice(0, i).join('.'));
    }

    const unknown = Array.from(declared).filter((ns) => ns !== '' && !known.has(ns));

    expect(unknown).toEqual([]);
  });

  it('resolves every statically bound key to a catalogue entry', () => {
    const missing: string[] = [];

    for (const file of sourceFiles(webRoot)) {
      const text = readFileSync(file, 'utf8');
      const rel = path.relative(webRoot, file);

      // Bind each translator variable to the namespace of its nearest preceding declaration,
      // so several `useTranslations` calls in one file do not shadow one another.
      const declarations: Array<{ at: number; variable: string; namespace: string }> = [];
      const declRe =
        /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\s*\(\s*['"]([\w.]*)['"]/g;
      for (const m of text.matchAll(declRe)) {
        const [, variable, namespace] = m;
        if (variable === undefined || namespace === undefined) continue;
        declarations.push({ at: m.index ?? 0, variable, namespace });
      }
      if (declarations.length === 0) continue;

      const callRe = /\b(\w+)\s*(?:\.rich|\.markup)?\(\s*['"]([\w.]+)['"]/g;
      for (const m of text.matchAll(callRe)) {
        const [, variable, key] = m;
        if (variable === undefined || key === undefined) continue;
        const at = m.index ?? 0;
        const bound = declarations
          .filter((d) => d.variable === variable && d.at < at)
          .sort((a, b) => b.at - a.at)[0];
        if (!bound) continue;

        const full = bound.namespace ? `${bound.namespace}.${key}` : key;
        if (!(full in catalogue)) {
          const line = text.slice(0, at).split('\n').length;
          missing.push(`${full}  (${rel}:${line})`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it('has no empty string as a message', () => {
    const blank = Object.entries(catalogue)
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key);

    expect(blank).toEqual([]);
  });
});

/**
 * The gate behind "the Turkish interface is 100% complete".
 *
 * Everything above measures `en.json` against the code. Nothing above notices that a second
 * catalogue is missing a key, and next-intl will not either: an absent message resolves to its
 * raw key path at runtime, so a half-translated locale renders `app.board.column.deleteAction`
 * to the user and fails no build. The mirror image is a key `tr.json` has and English does not
 * — a leftover from a rename, translated work that renders nowhere, and the first thing to
 * quietly rot.
 *
 * Driven off `SUPPORTED_LOCALES` rather than off a hardcoded `['tr']`, so the third language
 * is gated the day it is declared rather than the day someone remembers this file.
 */
const messagesDir = here;

function catalogueFor(locale: string): Record<string, string> {
  return flatten(JSON.parse(readFileSync(path.join(messagesDir, `${locale}.json`), 'utf8')));
}

/**
 * The ICU argument names a message interpolates.
 *
 * An identifier is only counted when the next thing after it is `,` or `}` — the two shapes a
 * real argument takes (`{name}`, `{count, plural, …}`). That is what keeps the free text
 * inside a plural branch (`=0 {no one}`, `other {# task}`) from being read as an argument,
 * which a plain `\{(\w+)` would do in every language differently.
 *
 * The remaining blind spot is a plural branch whose whole text is a single word — it would
 * read as an argument. No message in either catalogue has one, and the failure mode is a false
 * alarm on a new message rather than a missed mismatch, which is the right way round.
 */
function icuArguments(message: string): Set<string> {
  return new Set(Array.from(message.matchAll(/\{\s*([A-Za-z_]\w*)\s*(?=[,}])/g), (m) => m[1]!));
}

describe.each(SUPPORTED_LOCALES.filter((locale) => locale !== DEFAULT_LOCALE))(
  '%s.json',
  (locale) => {
    it('has a catalogue file at all', () => {
      expect(existsSync(path.join(messagesDir, `${locale}.json`))).toBe(true);
    });

    it('translates every key English defines', () => {
      const missing = Object.keys(catalogue).filter((key) => !(key in catalogueFor(locale)));

      expect(missing).toEqual([]);
    });

    it('defines no key English does not have', () => {
      const extra = Object.keys(catalogueFor(locale)).filter((key) => !(key in catalogue));

      expect(extra).toEqual([]);
    });

    it('interpolates the same arguments English does', () => {
      const translated = catalogueFor(locale);
      const mismatched: string[] = [];

      for (const [key, english] of Object.entries(catalogue)) {
        const other = translated[key];
        if (other === undefined) continue;

        const expected = [...icuArguments(english)].sort();
        const actual = [...icuArguments(other)].sort();
        // A dropped `{name}` is not a typo the reader can work around: the sentence loses the
        // thing it was about. A renamed one renders as literal braces.
        if (expected.join(',') !== actual.join(',')) {
          mismatched.push(`${key}: expected [${expected.join(', ')}], got [${actual.join(', ')}]`);
        }
      }

      expect(mismatched).toEqual([]);
    });

    it('has no empty string as a message', () => {
      const blank = Object.entries(catalogueFor(locale))
        .filter(([, value]) => value.trim() === '')
        .map(([key]) => key);

      expect(blank).toEqual([]);
    });
  },
);

describe('every supported locale', () => {
  it('is named in the language picker of every catalogue', () => {
    // `language-settings.tsx` renders one option per supported locale through
    // `t(\`options.${locale}\`)`. The liveness scan above matches that by prefix, so a locale
    // added without its option key passes every other test in this file and shows the user a
    // raw key path where a language name should be.
    const missing: string[] = [];

    for (const catalogueLocale of SUPPORTED_LOCALES) {
      const entries = catalogueFor(catalogueLocale);
      for (const named of SUPPORTED_LOCALES) {
        const key = `app.settings.language.options.${named}`;
        if (!(key in entries)) missing.push(`${catalogueLocale}.json is missing ${key}`);
      }
    }

    expect(missing).toEqual([]);
  });
});
