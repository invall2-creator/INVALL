import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({ open, onClose, children, labelledBy }: { open: boolean; onClose: () => void; children: ReactNode; labelledBy: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} aria-labelledby={labelledBy} onClose={onClose}>
    {open && <div className="dlg">{children}</div>}
  </dialog>;
}
