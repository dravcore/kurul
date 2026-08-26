import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';

const mocks = vi.hoisted(() => ({
  getLocale: vi.fn<() => Promise<string>>(),
  getMessages: vi.fn<() => Promise<Record<string, unknown>>>(),
  getTranslations: vi.fn<(ns: string) => Promise<(key: string) => string>>(),
  headers: vi.fn<() => Promise<Headers>>(),
  fraunces: vi.fn(() => ({ variable: '--font-fraunces' })),
}));

// `next/font/google` is a build-time transform, not a runtime module — the loaders are
// invoked at import time, so they have to be stubbed before the layout is loaded at all.
vi.mock('next/font/google', () => ({
  Archivo: () => ({ variable: '--font-archivo' }),
  Fraunces: mocks.fraunces,
  JetBrains_Mono: () => ({ variable: '--font-jetbrains' }),
}));

vi.mock('next-intl/server', () => ({
  getLocale: mocks.getLocale,
  getMessages: mocks.getMessages,
  getTranslations: mocks.getTranslations,
}));

// `headers()` needs a request scope Next only provides during a real render, so the layout
// cannot be called at all without this stub.
vi.mock('next/headers', () => ({
  headers: mocks.headers,
}));

vi.mock('@/components/layout/theme-provider', () => ({
  ThemeProvider: ({ children }: Readonly<{ children: React.ReactNode }>) => children,
}));

vi.mock('@/components/ui/sonner', () => ({
  Toaster: (): null => null,
}));

vi.mock('./globals.css', () => ({}));

import RootLayout, { generateMetadata } from './layout';
import messages from '@/messages/en.json';

/** Depth-first search for the first element whose props carry `prop`. */
function findWithProp(node: unknown, prop: string): ReactElement | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findWithProp(child, prop);
      if (hit) {
        return hit;
      }
    }
    return undefined;
  }

  if (!isValidElement(node)) {
    return undefined;
  }

  const props = node.props as Record<string, unknown>;
  if (prop in props) {
    return node;
  }

  return findWithProp(props.children, prop);
}

/** Depth-first search for the first element of the given host type (e.g. `'body'`). */
function findByType(node: unknown, type: string): ReactElement | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findByType(child, type);
      if (hit) {
        return hit;
      }
    }
    return undefined;
  }

  if (!isValidElement(node)) {
    return undefined;
  }

  if (node.type === type) {
    return node;
  }

  const props = node.props as Record<string, unknown>;
  return findByType(props.children, type);
}

beforeEach(() => {
  mocks.getLocale.mockReset().mockResolvedValue('tr');
  mocks.getMessages.mockReset().mockResolvedValue({ app: { dashboard: { title: 'Panel' } } });
  mocks.getTranslations
    .mockReset()
    .mockResolvedValue((key: string) => `${key} in the negotiated locale`);
  mocks.headers.mockReset().mockResolvedValue(new Headers({ 'x-nonce': 'nonce-from-the-proxy' }));
});

describe('RootLayout', () => {
  it('stamps the negotiated locale onto the document', async () => {
    const tree = await RootLayout({ children: null });

    expect(tree.type).toBe('html');
    expect((tree.props as { lang: string }).lang).toBe('tr');
  });

  it('hands the server-loaded catalogue to the client provider', async () => {
    // Client components read their copy from this provider; if the messages stop being
    // passed down, every `useTranslations` call renders its own key path instead.
    const tree = await RootLayout({ children: null });

    const provider = findWithProp(tree, 'messages');
    expect(provider).toBeDefined();
    expect((provider?.props as { messages: unknown }).messages).toEqual({
      app: { dashboard: { title: 'Panel' } },
    });
  });

  it('passes the request nonce to the theme provider, whose inline script needs it', async () => {
    // `next-themes` writes a `<script>` into `<head>` to set the theme class before first
    // paint, and `script-src` carries no `'unsafe-inline'` (`lib/security-headers.ts`). Drop
    // this prop and the script is refused: the page paints in the wrong theme and React fails
    // hydration on the `<html>` class that never arrived — a browser-only failure that every
    // other test in this file would stay green through.
    const tree = await RootLayout({ children: null });

    expect((findWithProp(tree, 'nonce')?.props as { nonce: unknown }).nonce).toBe(
      'nonce-from-the-proxy',
    );
  });

  it('renders without a nonce rather than a literal "null" one when the header is absent', async () => {
    // `proxy.ts` sets `x-nonce` on every request that reaches a render, so in the app this is
    // unreachable. It is asserted because of what the missing branch would do if it ever
    // became reachable: `headers().get()` answers `null`, and `nonce={null}` reaches
    // `next-themes` as an attribute — `<script nonce="null">`, which matches no policy and is
    // refused exactly like an un-nonced one, while looking in the markup as though it worked.
    // `undefined` omits the attribute instead, which is the honest failure.
    mocks.headers.mockResolvedValue(new Headers());

    const tree = await RootLayout({ children: null });

    const provider = findWithProp(tree, 'nonce');
    expect(provider).toBeDefined();
    expect((provider?.props as { nonce: unknown }).nonce).toBeUndefined();
  });

  it('names the app in the document title', async () => {
    // A static `metadata` export would pin the tab title and share description to English
    // for every locale, so both are resolved per request through the catalogue instead.
    const meta = await generateMetadata();

    expect(mocks.getTranslations).toHaveBeenCalledWith('app.meta');
    expect(meta.title).toBe('title in the negotiated locale');
    expect(meta.description).toBe('description in the negotiated locale');
  });

  it('keeps the English metadata copy in the catalogue', () => {
    expect(messages.app.meta.title).toBe('Kurul');
    expect(messages.app.meta.description).toBe('Open-source Kanban-focused project management');
  });

  // Without the `opsz` axis, next/font/google embeds only Fraunces' default instance, which is
  // cut for text-sized rendering (docs/design.md §3). A 40px `display` heading drawn from that
  // instance carries the low-optical-size cut's thinner strokes instead of the display cut the
  // scale is meant to look like, and no test that renders the layout in jsdom can tell the two
  // cuts apart, so this asserts the axis was requested at all.
  it('loads Fraunces with the opsz axis so the display cut is embedded', () => {
    // The loader runs once, at module import, so this reads the call captured when this file's
    // own top-level `import './layout'` first evaluated the module.
    expect(mocks.fraunces).toHaveBeenCalledWith(expect.objectContaining({ axes: ['opsz'] }));
  });

  // globals.css's theme font stacks (`--font-sans` etc.) resolve their `var()` reference on
  // :root, and a custom property only resolves against the element that declares it, so the
  // next/font `.variable` classes have to live on <html> rather than <body> or every stack falls
  // through to its fallback list.
  it('carries every next/font variable on the html element rather than the body', async () => {
    const tree = await RootLayout({ children: null });

    expect(tree.type).toBe('html');
    const htmlClassName = (tree.props as { className?: string }).className ?? '';
    expect(htmlClassName).toContain('--font-archivo');
    expect(htmlClassName).toContain('--font-fraunces');
    expect(htmlClassName).toContain('--font-jetbrains');

    const body = findByType(tree, 'body');
    expect(body).toBeDefined();
    expect((body?.props as { className?: string }).className).toBeUndefined();
  });
});
