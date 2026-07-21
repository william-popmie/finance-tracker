"use client";

import { Children, useEffect, useRef, useState } from "react";
import { useFlipBook } from "./use-flip-book";

export type Chapter = { label: string; page: number };

/**
 * The book's chrome: chapter tabs, the stage, and the page controls.
 *
 * All flip mechanics live in the engine (`src/lib/flip`). This file used to
 * carry a timer cascade that serialised flips, because StPageFlip silently
 * dropped any flip issued while another was animating. The engine overlaps
 * turns by design, so rapid presses just spawn more turns and none of that
 * bookkeeping is needed.
 */
export function BookShell({
  chapters,
  children,
}: {
  chapters: Chapter[];
  children: React.ReactNode;
}) {
  const pageCount = Children.count(children);
  const { mountRef, state, ready, next, prev, goToSide } =
    useFlipBook(pageCount);

  const [pageInput, setPageInput] = useState("1");
  const focusedRef = useRef(false);

  // 0-based index of the leading visible page — the same value the chapter
  // list is expressed in.
  const leadingPage = state.page - 1;
  const count = state.sides;

  useEffect(() => {
    if (!focusedRef.current) setPageInput(String(state.page));
  }, [state.page]);

  // Arrow-key navigation, ignored while the jump input has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (focusedRef.current) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") next();
      else if (e.key === "ArrowLeft" || e.key === "PageUp") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  const onInputFocus = () => {
    // Clear on focus so the user types into an empty field — avoids the
    // append/selection race (e.g. "1" + "12" → "112", out of range).
    focusedRef.current = true;
    setPageInput("");
  };

  const commitInput = () => {
    focusedRef.current = false;
    const value = Number.parseInt(pageInput, 10);
    if (!Number.isNaN(value) && value >= 1 && value <= count) {
      goToSide(value - 1);
    } else {
      setPageInput(String(state.page));
    }
  };

  // Which chapter contains the current page (last one at or before it).
  const activeChapter = chapters.reduce(
    (acc, c, i) => (c.page <= leadingPage ? i : acc),
    0
  );

  return (
    <div className="book-layout">
      <nav className="book-tabs" aria-label="Chapters">
        {chapters.map((c, i) => (
          <button
            key={c.label}
            type="button"
            onClick={() => goToSide(c.page)}
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
            onClick={prev}
            aria-label="Previous page"
          >
            ‹
          </button>
          <span className="book-counter np-mono">
            <input
              className="book-counter-input"
              value={pageInput}
              inputMode="numeric"
              disabled={!ready}
              aria-label="Current page — type a page number and press Enter to jump"
              onChange={(e) =>
                setPageInput(e.target.value.replace(/[^0-9]/g, ""))
              }
              onFocus={onInputFocus}
              onBlur={commitInput}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
            <span className="book-counter-total">/ {count || "…"}</span>
          </span>
          <button
            type="button"
            className="book-arrow"
            onClick={next}
            aria-label="Next page"
          >
            ›
          </button>
        </div>
      </div>
    </div>
  );
}
