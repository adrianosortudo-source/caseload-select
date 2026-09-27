"use client";
import { useEffect, useRef, type ReactNode } from "react";

export function ConfirmationDialog({ open, labelledBy, onClose, children }: {
  open: boolean;
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const cancel = (event: Event) => { event.preventDefault(); closeRef.current(); };
    dialog.addEventListener("cancel", cancel);
    return () => { dialog.removeEventListener("cancel", cancel); if (dialog.open) dialog.close(); };
  }, []);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={dialogRef} className="dc-dialog" aria-modal="true" aria-labelledby={labelledBy}>{children}</dialog>;
}