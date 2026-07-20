"use client";

import { useEffect, useRef, useState } from "react";
import type { PageFlip } from "page-flip";

export type Chapter = { label: string; page: number };

export function BookShell({
  chapters,
  children,
}: {
  chapters: Chapter[];
  children: React.ReactNode;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<PageFlip | null>(null);
  const [page, setPage] = useState(0);
  const [count, setCount] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    let flip: PageFlip | null = null;
    let disposed = false;

    // Dynamic import keeps the vanilla engine out of the SSR bundle. The async
    // gap also dedupes React StrictMode's double-mount: the first pass is torn
    // down (disposed=true) before its import resolves, so we init exactly once.
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    import("page-flip").then(({ PageFlip: Engine }) => {
      if (disposed || !mountRef.current) return;
      flip = new Engine(el, {
        width: 440,
        height: 600,
        size: "stretch",
        minWidth: 300,
        maxWidth: 520,
        minHeight: 420,
        maxHeight: 720,
        maxShadowOpacity: 0.5,
        showCover: true,
        usePortrait: true,
        autoSize: true,
        drawShadow: true,
        flippingTime: reduceMotion ? 0 : 700,
        mobileScrollSupport: false,
      });
      flip.loadFromHTML(el.querySelectorAll<HTMLElement>(".book-page"));
      flip.on("flip", (e) => setPage(e.data));
      setCount(flip.getPageCount());
      setPage(flip.getCurrentPageIndex());
      setReady(true);
      flipRef.current = flip;
    });

    return () => {
      disposed = true;
      try {
        flip?.destroy();
      } catch {
        /* engine may have partially torn down its own DOM already */
      }
      flipRef.current = null;
    };
  }, []);

  // Arrow-key navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        flipRef.current?.flipNext();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        flipRef.current?.flipPrev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const goTo = (p: number) => flipRef.current?.turnToPage(p);

  // Which chapter contains the current page (last chapter whose page <= current).
  const activeChapter = chapters.reduce(
    (acc, c, i) => (c.page <= page ? i : acc),
    0
  );

  return (
    <div className="book-layout">
      <nav className="book-tabs" aria-label="Chapters">
        {chapters.map((c, i) => (
          <button
            key={c.label}
            type="button"
            onClick={() => goTo(c.page)}
            aria-current={i === activeChapter ? "true" : undefined}
            className={`book-tab${i === activeChapter ? " book-tab-active" : ""}`}
          >
            {c.label}
          </button>
        ))}
      </nav>

      <div className="book-stage">
        <div ref={mountRef} className="book-mount">
          {children}
        </div>

        <div className="book-controls" aria-hidden={!ready}>
          <button
            type="button"
            className="book-arrow"
            onClick={() => flipRef.current?.flipPrev()}
            aria-label="Previous page"
          >
            ‹
          </button>
          <span className="book-counter np-mono">
            {count > 0 ? `${Math.min(page + 1, count)} / ${count}` : "…"}
          </span>
          <button
            type="button"
            className="book-arrow"
            onClick={() => flipRef.current?.flipNext()}
            aria-label="Next page"
          >
            ›
          </button>
        </div>
      </div>
    </div>
  );
}
