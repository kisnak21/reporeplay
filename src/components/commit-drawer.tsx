"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface CommitDrawerProps {
  closeHref: string;
  headingId?: string;
  children: React.ReactNode;
}

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export function CommitDrawer({ closeHref, headingId = "commit-title", children }: CommitDrawerProps) {
  const router = useRouter();
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    document.getElementById(headingId)?.focus();
    const observer = new MutationObserver(() => {
      const heading = document.getElementById(headingId);
      if (heading && (document.activeElement === document.body || document.activeElement === null)) {
        heading.focus();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [headingId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        router.push(closeHref);
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === first || !panelRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeHref, router]);

  return <main className="flex min-h-[calc(100vh-4rem)] justify-end bg-black/65 max-[800px]:block max-[800px]:bg-panel" id="main-content"><article ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={headingId} className="w-full max-w-3xl border-l border-signal bg-panel p-[clamp(1rem,3vw,2rem)] max-[800px]:min-h-[calc(100vh-4rem)] max-[800px]:max-w-none max-[800px]:border-l-0">{children}</article></main>;
}
