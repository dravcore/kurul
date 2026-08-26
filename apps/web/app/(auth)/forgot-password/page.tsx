import { ForgotPasswordView } from '@/components/auth/forgot-password-view';

/**
 * The "I forgot my password" page.
 *
 * No Suspense boundary, unlike its siblings: the form reads nothing off the URL, so there is no
 * `useSearchParams` to keep out of the static render.
 */
export default function ForgotPasswordPage(): React.ReactElement {
  return <ForgotPasswordView />;
}
