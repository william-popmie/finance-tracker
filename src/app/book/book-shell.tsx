"use client";

import { useEffect, useRef, useState } from "react";
import type { PageFlip } from "page-flip";

export type Chapter = { label: string; page: number };

// Safety valve on how many *real* flip animations play for one navigation. Set
// high so any realistic in-book jump riffles the FULL distance (the register is
// bounded to ~15 leaves), giving the tactile "flip through the book" feel. It
// only clips pathological jumps (e.g. a future 1000-leaf virtualized book),
// which then riffle this many and snap the remainder.
const MAX_RIFFLE_FLIPS = 60;
const FLIPPING_TIME = 80;
// Pace between successive flips in a cascade. MUST exceed FLIPPING_TIME so a new
// flip is never issued while one is still animating — StPageFlip silently drops
// mid-animation calls, which desyncs the book from our tracked position.
const STEP_INTERVAL = FLIPPING_TIME + 1;

export function BookShell({
  chapters,
  children,
}: {
  chapters: Chapter[];
  children: React.ReactNode;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<PageFlip | null>(null);

  // Position is tracked *here*, never read back from the engine —
  // StPageFlip's getCurrentPageIndex()/flip event lag one flip behind, which
  // corrupts any control loop that trusts them. `stops` are the valid landing
  // leaf indices (cover, then one per spread in landscape / every leaf in
  // portrait); posRef indexes into it and is the single source of truth.
  const stopsRef = useRef<number[]>([0]);
  const posRef = useRef(0); // index into stopsRef.current
  const landRef = useRef(0); // target index into stopsRef.current
  const dirRef = useRef(1);
  const activeRef = useRef(false); // a cascade is running
  const animatedRef = useRef(0); // flips animated this cascade
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduceMotionRef = useRef(false);
  const focusedRef = useRef(false);

  const [page, setPage] = useState(0); // current leaf index (for display)
  const [count, setCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [pageInput, setPageInput] = useState("1");

  const settle = () => {
    const leaf = stopsRef.current[posRef.current] ?? 0;
    setPage(leaf);
    if (!focusedRef.current) setPageInput(String(leaf + 1));
  };

  const computeStops = (total: number, landscape: boolean): number[] => {
    if (total <= 0) return [0];
    if (!landscape) return Array.from({ length: total }, (_, i) => i);
    // Cover (0) is shown alone; each following spread's left leaf is odd.
    const s = [0];
    for (let i = 1; i < total; i += 2) s.push(i);
    return s;
  };

  const stopIdxForLeaf = (leaf: number): number => {
    const stops = stopsRef.current;
    let idx = 0;
    for (let i = 0; i < stops.length; i++) {
      if (stops[i] <= leaf) idx = i;
      else break;
    }
    return idx;
  };

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const currentLeaf = () => stopsRef.current[posRef.current] ?? 0;

  // One tick of a cascade. Timer-paced so flips never overlap; when the target
  // (or cap) is reached, snap with turnToPage — safe because the engine is idle
  // between ticks (STEP_INTERVAL > FLIPPING_TIME).
  const endCascade = () => {
    activeRef.current = false;
    animatedRef.current = 0;
    clearTimer();
    settle();
  };

  const runStep = () => {
    const flip = flipRef.current;
    if (!flip) {
      activeRef.current = false;
      return;
    }
    // Arrived purely via flips — the engine is already on the target leaf, so
    // do NOT turnToPage to it (snapping to the current page can blank it).
    if (posRef.current === landRef.current) {
      endCascade();
      return;
    }
    // Cap hit on a long jump — snap the remaining distance (engine is idle
    // between ticks, so turnToPage is reliable here).
    if (animatedRef.current >= MAX_RIFFLE_FLIPS) {
      posRef.current = landRef.current;
      flip.turnToPage(currentLeaf());
      endCascade();
      return;
    }
    if (dirRef.current > 0) flip.flipNext();
    else flip.flipPrev();
    posRef.current += dirRef.current;
    animatedRef.current += 1;
    settle();
    timerRef.current = setTimeout(runStep, STEP_INTERVAL);
  };

  // All navigation funnels through here (target = index into stops).
  const go = (targetStopIdx: number) => {
    const flip = flipRef.current;
    if (!flip) return;
    const maxIdx = stopsRef.current.length - 1;
    const target = Math.max(0, Math.min(maxIdx, Math.round(targetStopIdx)));
    if (reduceMotionRef.current) {
      posRef.current = target;
      landRef.current = target;
      flip.turnToPage(stopsRef.current[target] ?? 0);
      settle();
      return;
    }
    if (target === posRef.current && !activeRef.current) {
      settle();
      return;
    }
    landRef.current = target;
    dirRef.current = target >= posRef.current ? 1 : -1;
    if (!activeRef.current) {
      activeRef.current = true;
      animatedRef.current = 0;
      runStep();
    }
  };

  // Single step (arrows/keys): extend from the in-flight target when busy so
  // rapid presses queue into a riffle instead of being dropped.
  const step = (d: number) => {
    const base = activeRef.current ? landRef.current : posRef.current;
    go(base + d);
  };
  const jumpToLeaf = (leaf: number) => go(stopIdxForLeaf(leaf));

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    let flip: PageFlip | null = null;
    let disposed = false;

    reduceMotionRef.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    // Dynamic import keeps the vanilla engine out of the SSR bundle. The async
    // gap also dedupes React StrictMode's double-mount: the first pass is torn
    // down (disposed=true) before its import resolves, so we init exactly once.
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
        flippingTime: reduceMotionRef.current ? 0 : FLIPPING_TIME,
        mobileScrollSupport: false,
      });
      flip.loadFromHTML(el.querySelectorAll<HTMLElement>(".book-page"));

      const total = flip.getPageCount();
      stopsRef.current = computeStops(total, flip.getOrientation() === "landscape");
      posRef.current = 0;
      landRef.current = 0;
      setCount(total);
      settle();

      // Only used to follow a *user drag-turn* (not our cascades); e.data lags
      // but is close enough, and the next controlled move re-snaps.
      flip.on("flip", (e) => {
        if (activeRef.current) return;
        posRef.current = stopIdxForLeaf(e.data);
        landRef.current = posRef.current;
        settle();
      });
      flip.on("changeOrientation", () => {
        const f = flipRef.current;
        if (!f) return;
        const leaf = currentLeaf();
        stopsRef.current = computeStops(
          f.getPageCount(),
          f.getOrientation() === "landscape"
        );
        posRef.current = stopIdxForLeaf(leaf);
        landRef.current = posRef.current;
        settle();
      });

      setReady(true);
      flipRef.current = flip;
    });

    return () => {
      disposed = true;
      clearTimer();
      try {
        flip?.destroy();
      } catch {
        /* engine may have partially torn down its own DOM already */
      }
      flipRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Arrow-key navigation (ignored while the jump input is focused).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (focusedRef.current) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") step(1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onInputFocus = () => {
    // Clear on focus so the user types into an empty field — avoids the
    // append/selection race (e.g. "1" + "12" → "112", out of range).
    focusedRef.current = true;
    setPageInput("");
  };

  const commitInput = () => {
    focusedRef.current = false;
    const v = Number.parseInt(pageInput, 10);
    if (!Number.isNaN(v) && v >= 1 && v <= count) {
      jumpToLeaf(v - 1);
    } else {
      setPageInput(String(page + 1));
    }
  };

  // Which chapter contains the current leaf (last chapter whose page <= current).
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
            onClick={() => jumpToLeaf(c.page)}
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
            onClick={() => step(-1)}
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
            onClick={() => step(1)}
            aria-label="Next page"
          >
            ›
          </button>
        </div>
      </div>
    </div>
  );
}
