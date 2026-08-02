import { useRef, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

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

/** Shared modal shell with focus trapping, Escape handling, and mobile-safe scrolling. */
export function AccessibleDialog({
  open,
  onClose,
  eyebrow,
  title,
  description,
  size = 'medium',
  children,
}: AccessibleDialogProps) {
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null,
  );

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen: boolean) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm" />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 z-[60] flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-gravity-border bg-gravity-surface/95 shadow-2xl sm:max-h-[calc(100dvh-2rem)] ${SIZE_CLASSES[size]}`}
          onCloseAutoFocus={(event: Event) => {
            event.preventDefault();
            returnFocusRef.current?.focus();
          }}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gravity-border/60 px-4 py-4 sm:px-6">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.25em] text-gravity-muted">{eyebrow}</div>
              <Dialog.Title className="mt-1 text-lg font-semibold text-slate-100">{title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-gravity-muted">
                {description}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="btn shrink-0 px-3 py-1 text-sm" aria-label={`Close ${eyebrow}`}>
                Close
              </button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
