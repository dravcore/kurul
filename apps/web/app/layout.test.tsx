import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';

const mocks = vi.hoisted(() => ({
  getLocale: vi.fn<() => Promise<string>>(),
  getMessages: vi.fn<() => Promise<Record<string, unknown>>>(),
  getTranslations: vi.fn<(ns: string) => Promise<(key: string) => string>>(),
}));

// `next/font/google` is a build-time transform, not a runtime module — the loaders are
// invoked at import time, so they have to be stubbed before the layout is loaded at all.
vi.mock('next/font/google', () => ({
  Archivo: () => ({ variable: '--font-archivo' }),
  Fraunces: () => ({ variable: '--font-fraunces' }),
  JetBrains_Mono: () => ({ variable: '--font-jetbrains' }),
}));

vi.mock('next-intl/server', () => ({
  getLocale: mocks.getLocale,
  getMessages: mocks.getMessages,
  getTranslations: mocks.getTranslations,
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

/** Depth-first search for the first element whose props carry `messages`. */
function findWithMessages(node: unknown): ReactElement | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findWithMessages(child);
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
  if ('messages' in props) {
    return node;
  }

  return findWithMessages(props.children);
}

beforeEach(() => {
  mocks.getLocale.mockReset().mockResolvedValue('tr');
  mocks.getMessages.mockReset().mockResolvedValue({ app: { dashboard: { title: 'Panel' } } });
  mocks.getTranslations
    .mockReset()
    .mockResolvedValue((key: string) => `${key} in the negotiated locale`);
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

    const provider = findWithMessages(tree);
    expect(provider).toBeDefined();
    expect((provider?.props as { messages: unknown }).messages).toEqual({
      app: { dashboard: { title: 'Panel' } },
    });
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
});
