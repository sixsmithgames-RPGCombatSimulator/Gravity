import { GRAVITY_SUPPORT_EMAIL } from '../../session/errors';
import type { SessionUiError } from '../../session/types';

type SessionErrorNoticeProps = {
  error: SessionUiError | null;
  className: string;
};

/**
 * Purpose: Render player-safe recovery copy while keeping support details visually secondary and copyable.
 * Parameters: A structured session UI error and caller-controlled spacing classes.
 * Returns: An accessible alert, or no markup when there is no current failure.
 * Side effects: None.
 */
export function SessionErrorNotice({ error, className }: SessionErrorNoticeProps) {
  if (!error) return null;

  return (
    <div
      role="alert"
      className={`${className} rounded-lg border border-rose-400/40 bg-rose-950/50 px-4 py-3 text-sm text-rose-100`}
    >
      <p>{error.message}</p>
      {error.supportCode ? (
        <p className="mt-3 border-t border-rose-300/20 pt-3 text-xs text-rose-200/85">
          Email{' '}
          <a className="select-all underline underline-offset-2" href={`mailto:${GRAVITY_SUPPORT_EMAIL}`}>
            {GRAVITY_SUPPORT_EMAIL}
          </a>{' '}
          and include support code{' '}
          <code className="select-all rounded bg-black/25 px-1.5 py-1 font-mono text-rose-100">
            {error.supportCode}
          </code>
          .
        </p>
      ) : null}
    </div>
  );
}
