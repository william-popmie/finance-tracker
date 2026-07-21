"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FlipBook } from "@/lib/flip";
import type { BookState, FlipOptions } from "@/lib/flip";

const INITIAL: BookState = { pos: 0, sheets: 0, sides: 0, page: 1 };

export interface UseFlipBook {
  /** Attach to the element whose `.book-page` children are the pages. */
  mountRef: React.RefObject<HTMLDivElement | null>;
  state: BookState;
  ready: boolean;
  next: () => void;
  prev: () => void;
  /** Jump to the spread showing a given 0-based page index. */
  goToSide: (sideIndex: number) => void;
}

/**
 * Owns the engine's lifecycle for React.
 *
 * The engine is imperative and holds real DOM, so it lives entirely in a ref —
 * React renders the pages, the engine positions them, and neither re-renders
 * the other. Position flows back out through the `change` subscription.
 *
 * `pageCount` exists so a changed page list re-reads the DOM: React replaces
 * those nodes, which would otherwise leave the engine holding detached elements.
 */
export function useFlipBook(
  pageCount: number,
  options?: Partial<FlipOptions>
): UseFlipBook {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<FlipBook | null>(null);
  const [state, setState] = useState<BookState>(INITIAL);
  const [ready, setReady] = useState(false);

  // Snapshotted so a fresh options literal each render cannot tear the engine
  // down and rebuild it.
  const optionsRef = useRef(options);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    // Constructed synchronously, so React StrictMode's double-mount is handled
    // by the cleanup below rather than by an async guard.
    const book = new FlipBook(el, optionsRef.current);
    bookRef.current = book;

    const unsubscribe = book.on("change", setState);
    setState(book.getState());
    setReady(true);

    return () => {
      unsubscribe();
      book.destroy();
      bookRef.current = null;
      setReady(false);
    };
  }, []);

  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    bookRef.current?.refresh();
  }, [pageCount]);

  const next = useCallback(() => bookRef.current?.next(), []);
  const prev = useCallback(() => bookRef.current?.prev(), []);
  const goToSide = useCallback(
    (sideIndex: number) => bookRef.current?.goToSide(sideIndex),
    []
  );

  return { mountRef, state, ready, next, prev, goToSide };
}
