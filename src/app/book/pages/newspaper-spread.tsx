import type { Edition } from "@/lib/frontpage";
import {
  Masthead,
  LeadStory,
  CategoryColumn,
  NumbersBox,
  MerchantIndex,
  ForecastBox,
  Ticker,
} from "@/app/(app)/frontpage/newspaper";

// The newspaper front page reflowed across a two-page spread. A single book
// leaf is roughly half the standalone sheet, so the masthead + lead story sit
// on the left leaf and the category column + numbers rail on the right.

export function NewspaperLeft({ edition }: { edition: Edition }) {
  return (
    <div className="book-page">
      <div className="book-page-inner newspaper book-newspaper">
        <Masthead edition={edition} />
        <div className="mt-3">
          <LeadStory edition={edition} />
        </div>
      </div>
    </div>
  );
}

export function NewspaperRight({ edition }: { edition: Edition }) {
  return (
    <div className="book-page">
      <div className="book-page-inner newspaper book-newspaper">
        <div className="np-kicker mb-2">Continued · Inside</div>
        <CategoryColumn edition={edition} />
        <div className="mt-4">
          <NumbersBox edition={edition} />
          <MerchantIndex edition={edition} />
          <ForecastBox edition={edition} />
        </div>
        <Ticker edition={edition} />
      </div>
    </div>
  );
}
