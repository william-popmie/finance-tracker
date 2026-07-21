import { DragController } from "./drag";
import { Flight } from "./flight";
import { BookLayout } from "./layout";
import { SheetModel } from "./model";
import type { TurnSequence } from "./model";
import { resolveOptions } from "./options";
import type { FlipOptions } from "./options";
import { FlightScheduler } from "./scheduler";
import { Corner, Direction } from "./types";
import type { BookState, Side } from "./types";

export type ChangeListener = (state: BookState) => void;

const PAGE_SELECTOR = ".book-page:not(.book-flight-clone)";
const SLOT_Z = 2;

/**
 * The book: a mount element containing `.book-page` children, turned a sheet at
 * a time with overlapping soft curls.
 *
 * Composition, so each concern stays replaceable:
 *   SheetModel       what the book IS (sides, sheets, position) — pure
 *   BookLayout       where it sits on screen and the page-space mapping — pure
 *   FlightScheduler  the rAF loop over N concurrent turns
 *   DragController   pointer -> a turn
 *   SheetRenderer    how a turning sheet is painted (per sheet kind)
 *   ShadowRenderer   how its shadows are painted
 *
 * This class only wires them together and owns the resting composite.
 */
export class FlipBook {
  readonly model = new SheetModel();
  readonly layout = new BookLayout();
  readonly options: FlipOptions;

  private readonly scheduler: FlightScheduler;
  private readonly drag: DragController;
  private readonly listeners = new Set<ChangeListener>();
  private readonly resizeObserver: ResizeObserver | null = null;

  private seq = 0;
  private measuredWidth = -1;
  private measuredHeight = -1;
  private riffleToken = 0;
  private riffleTimer: ReturnType<typeof setTimeout> | null = null;
  private padded: HTMLElement | null = null;
  private destroyed = false;

  constructor(
    private readonly mount: HTMLElement,
    overrides?: Partial<FlipOptions>
  ) {
    this.options = resolveOptions(overrides);

    this.scheduler = new FlightScheduler(
      {
        renderStatic: () => this.renderStatic(),
        commit: (flight) => this.applyLanding(flight.landPos),
      },
      this.options
    );

    this.drag = new DragController({
      model: this.model,
      layout: this.layout,
      options: this.options,
      host: this.mount,
      canStart: () => !this.scheduler.busy && !this.reducedMotion,
      spawn: (direction, sheetIdx, landPos, corner) =>
        this.createFlight(direction, sheetIdx, landPos, corner),
      renderStatic: () => this.renderStatic(),
      land: (flight) => this.applyLanding(flight.landPos),
      settle: () => {
        this.renderStatic();
        this.emit();
      },
    });

    this.collectSides();
    this.measure();

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.mount);
    }

    this.mount.dataset.flipReady = "true";
    this.emit();
  }

  // --- content -------------------------------------------------------------

  /** Re-read `.book-page` children. Call after the page list changes. */
  refresh(): void {
    this.scheduler.landAll();
    this.collectSides();
    this.renderStatic();
    this.emit();
  }

  private collectSides(): void {
    if (this.padded) {
      this.padded.remove();
      this.padded = null;
    }

    const els = Array.from(
      this.mount.querySelectorAll<HTMLElement>(PAGE_SELECTOR)
    );

    const sides: Side[] = els.map((el) => ({
      el,
      kind: el.dataset.density === "hard" ? "hard" : "soft",
    }));

    // A sheet needs two sides. An odd count would leave the last page with no
    // partner and therefore unreachable, so give it a blank back.
    if (sides.length % 2 === 1) {
      const blank = document.createElement("div");
      blank.className = "book-page book-page-blank";
      blank.setAttribute("aria-hidden", "true");
      this.mount.appendChild(blank);
      this.padded = blank;
      sides.push({ el: blank, kind: "soft" });
    }

    this.model.setSides(sides);
    this.renderStatic();
  }

  // --- layout --------------------------------------------------------------

  private measure(): void {
    this.measuredWidth = this.mount.clientWidth;
    this.measuredHeight = this.mount.clientHeight;
    this.layout.measure(
      this.measuredWidth,
      this.measuredHeight,
      this.options
    );
    this.renderStatic();
  }

  resize(): void {
    if (this.destroyed) return;

    // ResizeObserver also fires on observe and on changes that do not affect
    // our geometry. Landing turns on one of those would snap a flip mid-air,
    // so only react when the box genuinely changed.
    if (
      this.mount.clientWidth === this.measuredWidth &&
      this.mount.clientHeight === this.measuredHeight
    ) {
      return;
    }

    // Flights hold geometry built against the old page size and cannot be
    // rescaled mid-air, so land them first. A real resize is already a visual
    // discontinuity, which is why snapping there reads as fine.
    this.cancelRiffle();
    this.scheduler.landAll();
    this.measure();
  }

  /**
   * The resting composite: exactly the two slot pages visible, everything else
   * hidden. Rebuilt at the top of every frame so flights paint over a known
   * baseline and stale clips never survive.
   */
  private renderStatic(): void {
    const left = this.model.leftSideIndex();
    const right = this.model.rightSideIndex();
    const leftCss = this.slotCss("left");
    const rightCss = this.slotCss("right");

    const sides = this.model.sides;
    for (let i = 0; i < sides.length; i++) {
      const el = sides[i].el;
      if (i === right) el.style.cssText = rightCss;
      else if (i === left) el.style.cssText = leftCss;
      else if (el.style.display !== "none") el.style.cssText = "display:none";
    }
  }

  private slotCss(slot: "left" | "right"): string {
    const r = this.layout.slotRect(slot);
    return [
      "display:block",
      "position:absolute",
      `left:${r.left}px`,
      `top:${r.top}px`,
      `width:${r.width}px`,
      `height:${r.height}px`,
      `z-index:${SLOT_Z}`,
      "transform:none",
      "clip-path:none",
      // The resting shadow lives on the PAGE so it traces the page's real shape
      // and peels with the clip. See shadows/resting.ts.
      `filter:${this.options.restingShadow}`,
    ].join(";");
  }

  // --- navigation ----------------------------------------------------------

  get reducedMotion(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  /** Where the book will be once everything airborne lands. */
  private projectedPos(): number {
    return this.scheduler.projectedPos(this.model.pos);
  }

  next(): void {
    this.turn(Direction.Forward);
  }

  prev(): void {
    this.turn(Direction.Back);
  }

  private turn(direction: Direction): void {
    // Extend from the projected position, so a rapid burst queues consecutive
    // sheets rather than re-turning the same one.
    const from = this.projectedPos();
    const target = direction === Direction.Forward ? from + 1 : from - 1;
    if (target < 0 || target > this.model.sheetCount) return;

    if (this.reducedMotion) {
      this.applyLanding(target);
      return;
    }

    const sheetIdx = this.model.sheetIndexFor(from, direction);
    this.spawnTurn(direction, sheetIdx, target);
  }

  /** Go to a sheet position, riffling up to `riffleCap` turns. */
  goToPosition(pos: number): void {
    const target = this.model.clampPosition(pos);
    this.cancelRiffle();

    const from = this.projectedPos();
    if (target === from) return;

    if (this.reducedMotion) {
      this.scheduler.landAll();
      this.applyLanding(target);
      return;
    }

    this.playSequence(
      this.model.landingSequence(from, target, this.options.riffleCap)
    );
  }

  /** Go to the spread showing a given page (side) index. */
  goToSide(sideIndex: number): void {
    this.goToPosition(this.model.positionOfSide(sideIndex));
  }

  private playSequence(sequence: TurnSequence): void {
    if (!sequence.steps.length) return;

    const token = ++this.riffleToken;
    let i = 0;

    const fire = (): void => {
      // A newer navigation invalidates this chain; without the token the old
      // riffle would keep firing turns underneath the new one.
      if (this.destroyed || token !== this.riffleToken) return;

      const step = sequence.steps[i];
      this.spawnTurn(sequence.direction, step.sheetIdx, step.landPos);
      i += 1;

      if (i < sequence.steps.length) {
        this.riffleTimer = setTimeout(fire, this.options.riffleStagger);
      }
    };

    fire();
  }

  private cancelRiffle(): void {
    this.riffleToken += 1;
    if (this.riffleTimer) {
      clearTimeout(this.riffleTimer);
      this.riffleTimer = null;
    }
  }

  private spawnTurn(
    direction: Direction,
    sheetIdx: number,
    landPos: number
  ): void {
    const flight = this.createFlight(direction, sheetIdx, landPos, Corner.Top);
    if (flight) this.scheduler.add(flight);
  }

  private createFlight(
    direction: Direction,
    sheetIdx: number,
    landPos: number,
    corner: Corner
  ): Flight | null {
    if (this.destroyed || !this.model.hasSheet(sheetIdx)) return null;
    return new Flight(
      {
        model: this.model,
        layout: this.layout,
        options: this.options,
        host: this.mount,
        direction,
        sheetIdx,
        landPos,
        corner,
        seq: this.seq++,
      },
      performance.now()
    );
  }

  private applyLanding(pos: number): void {
    this.model.pos = this.model.clampPosition(pos);
    this.renderStatic();
    this.emit();
  }

  // --- observation ---------------------------------------------------------

  getState(): BookState {
    return {
      pos: this.model.pos,
      sheets: this.model.sheetCount,
      sides: this.model.sideCount,
      page: this.model.leadingSideIndex() + 1,
    };
  }

  /** Subscribe to position changes. Returns an unsubscribe function. */
  on(event: "change", listener: ChangeListener): () => void {
    if (event !== "change") return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelRiffle();
    this.scheduler.destroy();
    this.drag.destroy();
    this.resizeObserver?.disconnect();
    this.listeners.clear();
    this.padded?.remove();
    this.padded = null;
    delete this.mount.dataset.flipReady;
  }
}
