import type { Edition } from "@/lib/frontpage";

// Full-decimal euros for the numbers rail and ticker.
function eur(n: number, currency = "EUR") {
  return new Intl.NumberFormat("nl-BE", { style: "currency", currency }).format(n);
}

export function Masthead({ edition }: { edition: Edition }) {
  const { nameplate, dateline } = edition;
  return (
    <header>
      <div className="np-mono flex justify-between text-[9.5px] tracking-[0.14em] text-muted-foreground uppercase pb-1.5">
        <span>Personal Edition</span>
        <span>Est. 2026 · Brussels</span>
        <span>Saturday Review</span>
      </div>
      <hr className="np-rule" />
      <div className="py-2.5 text-center">
        <div className="text-[clamp(2.2rem,6vw,3rem)] leading-none font-semibold tracking-[-0.02em]">
          {nameplate.title}
        </div>
        <div className="np-mono mt-1.5 text-[9.5px] tracking-[0.28em] text-muted-foreground uppercase">
          {nameplate.tagline}
        </div>
      </div>
      <hr className="np-rule-thick" />
      <div className="np-mono flex justify-between px-0.5 py-1.5 text-[10.5px] tracking-[0.1em] uppercase">
        <span>{dateline.volume}</span>
        <span className="font-medium">{dateline.monthLabel}</span>
        <span>
          The month cost you{" "}
          <b className="text-brand-strong">{dateline.costLine}</b>
        </span>
      </div>
      <hr className="np-rule-thick" />
    </header>
  );
}

export function Figure({ edition }: { edition: Edition }) {
  const max = Math.max(...edition.figure.map((f) => f.value), 1);
  return (
    <figure className="my-3 border-y border-border py-2.5">
      <div className="flex h-[66px] items-end gap-1.5">
        {edition.figure.map((f, i) => (
          <div
            key={i}
            className="flex-1 rounded-[1px]"
            style={{
              height: `${Math.max(4, Math.round((f.value / max) * 100))}%`,
              backgroundColor: f.current ? "var(--brand)" : "var(--faint)",
            }}
          />
        ))}
      </div>
      <figcaption className="np-mono mt-1.5 text-[9px] tracking-[0.08em] text-muted-foreground">
        FIG. 1 — MONTHLY SPENDING, LAST SIX MONTHS. THIS MONTH SHADED.
      </figcaption>
    </figure>
  );
}

export function LeadStory({ edition }: { edition: Edition }) {
  const { lead } = edition;
  return (
    <div className="md:pr-5">
      <div className="np-kicker">{lead.kicker}</div>
      <h1 className="mt-1 mb-1.5 text-[clamp(1.5rem,3.4vw,1.9rem)] leading-[1.08] font-semibold tracking-[-0.02em]">
        {lead.headline}
      </h1>
      <p className="mb-2 font-serif text-[15px] leading-snug text-foreground/85 italic">
        {lead.deck}
      </p>
      <div className="np-mono mb-2 text-[9.5px] tracking-[0.1em] text-muted-foreground uppercase">
        {lead.byline}
      </div>
      {lead.body.map((para, i) => (
        <p key={i} className={`np-body ${i === 0 ? "np-dropcap" : "mt-2"}`}>
          {para}
        </p>
      ))}
      <Figure edition={edition} />
    </div>
  );
}

export function CategoryColumn({ edition }: { edition: Edition }) {
  if (edition.articles.length === 0) return <div className="hidden md:block" />;
  return (
    <div className="md:border-x md:border-border md:px-4">
      {edition.articles.map((a, i) => (
        <div key={i}>
          {i > 0 && <hr className="np-hair my-3" />}
          <div className="np-kicker">{a.kicker}</div>
          <h3 className="mt-0.5 mb-1 text-[18px] leading-[1.1] font-semibold tracking-[-0.01em]">
            {a.headline}
          </h3>
          <p className="np-body text-[12.5px]">{a.blurb}</p>
        </div>
      ))}
    </div>
  );
}

export function NumbersBox({ edition }: { edition: Edition }) {
  const { numbers } = edition;
  const rows: [string, string, string?][] = [
    ["Spent", eur(numbers.spent)],
    ["Received", eur(numbers.received), "text-pos"],
    [
      "Net",
      `${numbers.net >= 0 ? "+" : ""}${eur(numbers.net)}`,
      "font-medium",
    ],
    ["Balance", eur(numbers.balance)],
  ];
  return (
    <div className="border-[1.5px] border-foreground px-3 pt-2 pb-3">
      <div className="np-mono border-b border-foreground pb-1.5 text-center text-[9.5px] font-medium tracking-[0.14em] uppercase">
        By the Numbers
      </div>
      {rows.map(([label, value, cls], i) => (
        <div key={label}>
          {i > 0 && <hr className="np-hair" />}
          <div className="np-figrow">
            <span className="text-muted-foreground">{label}</span>
            <span className={cls}>{value}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function MerchantIndex({ edition }: { edition: Edition }) {
  if (edition.merchants.length === 0) return null;
  return (
    <div>
      <div className="np-kicker mt-4 mb-1.5">Top Merchants — Index</div>
      <div className="np-mono text-[11.5px]">
        {edition.merchants.map((m) => (
          <div key={m.name} className="flex justify-between gap-3 py-[3px]">
            <span className="truncate">{m.name}</span>
            <span className="shrink-0 text-muted-foreground">
              {eur(m.amount)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ForecastBox({ edition }: { edition: Edition }) {
  return (
    <div className="mt-3.5 bg-secondary px-3 py-2.5">
      <div className="np-kicker !text-foreground">Forecast</div>
      <p className="mt-0.5 font-serif text-[13px] leading-snug text-foreground/80 italic">
        {edition.forecast}
      </p>
    </div>
  );
}

export function Ticker({ edition }: { edition: Edition }) {
  if (edition.ticker.length === 0) return null;
  return (
    <>
      <hr className="np-rule-thick mt-4" />
      <div className="np-mono flex gap-4 overflow-hidden py-1.5 text-[10.5px] tracking-[0.05em] whitespace-nowrap">
        <span className="shrink-0 font-medium text-brand-strong">LATE EDITION —</span>
        {edition.ticker.map((t, i) => (
          <span key={i} className="flex shrink-0 items-center gap-4">
            <span className={t.amount >= 0 ? "text-pos" : "text-foreground"}>
              {t.label.toUpperCase()} {t.amount >= 0 ? "+" : "−"}
              {eur(Math.abs(t.amount), t.currency).replace(/[^\d.,]/g, "")}
            </span>
            {i < edition.ticker.length - 1 && (
              <span className="text-muted-foreground">·</span>
            )}
          </span>
        ))}
      </div>
      <hr className="np-rule" />
    </>
  );
}

export function Newspaper({ edition }: { edition: Edition }) {
  return (
    <div className="newspaper mx-auto max-w-5xl border border-border bg-card px-5 py-5 sm:px-7 sm:py-6">
      <Masthead edition={edition} />
      <div className="mt-3.5 grid grid-cols-1 gap-6 md:grid-cols-[1.7fr_1.15fr_1fr] md:gap-0">
        <LeadStory edition={edition} />
        <CategoryColumn edition={edition} />
        <div className="md:pl-4">
          <NumbersBox edition={edition} />
          <MerchantIndex edition={edition} />
          <ForecastBox edition={edition} />
        </div>
      </div>
      <Ticker edition={edition} />
    </div>
  );
}
