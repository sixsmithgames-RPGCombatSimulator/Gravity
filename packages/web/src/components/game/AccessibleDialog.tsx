import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type AccessibleDialogProps = {
  open: boolean;
  onClose: () => void;
  eyebrow: string;
  title: string;
  description: string;
  size?: 'medium' | 'large';
  children: ReactNode;
};

const SIZE_CLASSES: Record<NonNullable<AccessibleDialogProps['size']>, string> = {
  medium: 'max-w-xl',
  large: 'max-w-3xl',
};

/**
 * Purpose: Present one labelled, genuinely modal surface with bounded scrolling.
 * Parameters: open is presentation state; onClose requests its owner to close;
 * the remaining props supply the visible labels, content and responsive width.
 * Returns: A native modal in the document top layer, or nothing while closed.
 * Side effects: showModal/close provide native inertness and keyboard focus
 * containment; scoped gesture listeners protect the underlying mission panels.
 * Root cause: The former modal's body-style writes and animation style reads
 * forced scene-wide work during every opening. Native modality needs neither.
 */
export function AccessibleDialog({
  open,
  onClose,
  eyebrow,
  title,
  description,
  size = 'medium',
  children,
}: AccessibleDialogProps) {
  const labelId = useId();
  const descriptionId = useId();
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const backdropPointerDownRef = useRef(false);

  useLayoutEffect(() => {
    if (!open) return;

    // The portal has committed before this effect. Never set the open attribute
    // manually: only showModal creates the browser's inert, top-layer boundary.
    const dialog = dialogRef.current!;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    backdropPointerDownRef.current = false;
    const preventCoveredScroll = (event: Event) => {
      const content = contentRef.current;
      if (!content || !event.composedPath().includes(content)) event.preventDefault();
    };
    document.addEventListener('wheel', preventCoveredScroll, { passive: false, capture: true });
    document.addEventListener('touchmove', preventCoveredScroll, { passive: false, capture: true });
    dialog.showModal();

    return () => {
      document.removeEventListener('wheel', preventCoveredScroll, true);
      document.removeEventListener('touchmove', preventCoveredScroll, true);
      if (dialog.open) dialog.close();
      // Native close normally restores this focus already. The explicit check
      // covers owner-driven unmounts without focusing twice or moving the view.
      const opener = returnFocusRef.current;
      if (opener?.isConnected && document.activeElement !== opener) opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      aria-modal="true"
      className="mission-modal fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden border-0 bg-transparent p-0 text-gravity-text open:flex open:items-center open:justify-center"
      onCancel={(event) => {
        // Keep the owning React state authoritative for Escape and close controls.
        event.preventDefault();
        onClose();
      }}
    >
      <div
        data-testid="modal-backdrop"
        aria-hidden="true"
        className="absolute inset-0 bg-black/80"
        style={{ touchAction: 'none' }}
        onPointerDown={(event) => { backdropPointerDownRef.current = event.button === 0; }}
        onClick={(event) => {
          // Dismiss only a primary gesture that started on the dim layer; a
          // content drag ending outside must not unexpectedly close the dialog.
          if (event.button === 0 && backdropPointerDownRef.current) onClose();
          backdropPointerDownRef.current = false;
        }}
      />
      <div
        ref={contentRef}
        data-testid="modal-surface"
        className={`relative flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] flex-col overflow-hidden rounded-lg border border-gravity-border bg-gravity-surface/95 shadow-2xl sm:max-h-[calc(100dvh-2rem)] ${SIZE_CLASSES[size]}`}
        onPointerDown={() => { backdropPointerDownRef.current = false; }}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gravity-border/60 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.25em] text-gravity-muted">{eyebrow}</div>
            <h2 id={labelId} className="mt-1 text-lg font-semibold text-slate-100">{title}</h2>
            <p id={descriptionId} className="mt-1 text-sm text-gravity-muted">
              {description}
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn shrink-0 px-3 py-1 text-sm" aria-label={`Close ${eyebrow}`}>
            Close
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
          {children}
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
