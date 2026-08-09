import { redirect } from 'next/navigation';

/** Middleware owns session-aware routing; this is a static fallback. */
export default function HomePage(): never {
  redirect('/login');
}
