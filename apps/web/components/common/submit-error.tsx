'use client';

import { useEffect, useRef } from 'react';

/**
 * A submit-level failure message — the one every dialog and auth form shows above its footer
 * when `onSubmit`/`onConfirm` rejects.
 *
 * Wired for both halves of WCAG 4.1.3 (audit finding UX-01): `role="alert"` gets it announced
 * to assistive tech without waiting for a toast (there is none on this path — toasts fire only
 * on success), and the effect below moves visible focus to it, the same "focus moves to the
 * first error" `docs/design.md` §6 already asks for on field-level `details[]`.
 *
 * Every caller clears the error to `null` before the request that might set it again
 * (`setError(null)` ahead of `onSubmit`/`onConfirm`), and the callers render this element
 * conditionally rather than always-mounted-but-empty — so a retry that fails with the exact
 * same wording still unmounts this node before remounting it. That matters because a
 * `role="alert"` region whose text content does not change is not guaranteed to be
 * re-announced by every screen reader; a fresh mount is announced regardless.
 *
 * `focusOnMount={false}` is for the one caller whose failure does not arrive on a submit the
 * reader is waiting on: the task panel saves on blur, so its error lands after focus has
 * already moved into the next field, and pulling it back out would interrupt someone who is
 * mid-sentence. `role="alert"` announces the line either way; only the focus move is dropped.
 */
export function SubmitError({
  message,
  focusOnMount = true,
}: Readonly<{ message: string; focusOnMount?: boolean }>): React.ReactElement {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount, message]);

  return (
    <p ref={ref} role="alert" tabIndex={-1} className="text-body text-destructive">
      {message}
    </p>
  );
}
