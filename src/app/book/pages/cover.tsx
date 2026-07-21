import type { Edition } from "@/lib/frontpage";

function eur0(n: number) {
  return new Intl.NumberFormat("nl-BE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

// The front cover — a hard leaf. Embossed nameplate on a leather field.
export function Cover({ edition }: { edition: Edition }) {
  return (
    <div className="book-page book-cover" data-density="hard">
      <div className="book-cover-inner">
        <div className="book-cover-frame">
          <div className="book-cover-kicker">Personal Edition · Est. 2026</div>
          <h1 className="book-cover-title">{edition.nameplate.title}</h1>
          <div className="book-cover-rule" />
          <div className="book-cover-tagline">{edition.nameplate.tagline}</div>
          <div className="book-cover-foot">
            <span>{edition.dateline.monthLabel}</span>
            <span>Balance {eur0(edition.numbers.balance)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// The inside-front leaf: a short colophon so the cover opens onto something,
// not straight into the masthead.
export function Colophon({ edition }: { edition: Edition }) {
  return (
    <div className="book-page">
      <div className="book-page-inner book-colophon">
        <div className="np-kicker">Being an account of</div>
        <p className="book-colophon-lede">
          the household&rsquo;s money for {edition.dateline.monthLabel},
          set in type from the record of transactions and bound herein.
        </p>
        <div className="book-colophon-rule" />
        <div className="book-colophon-index">
          <div className="book-colophon-index-row">
            <span>The Monthly Ledger</span>
            <span className="text-muted-foreground">Front page</span>
          </div>
          <div className="book-colophon-index-row">
            <span>The Register</span>
            <span className="text-muted-foreground">Transactions</span>
          </div>
        </div>
        <div className="book-colophon-note">
          {edition.dateline.volume}
        </div>
      </div>
    </div>
  );
}
