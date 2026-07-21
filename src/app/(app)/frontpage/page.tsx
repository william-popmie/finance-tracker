import Link from "next/link";
import { loadEdition } from "@/lib/frontpage-data";
import { Newspaper } from "./newspaper";

export const dynamic = "force-dynamic";

export default async function FrontPage() {
  const { edition, isFirstEdition } = await loadEdition();

  return (
    <div className="space-y-4">
      {isFirstEdition && (
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 rounded-lg border border-border bg-secondary px-4 py-3 text-sm">
          <span className="text-muted-foreground">
            No transactions yet — your first edition is a template.
          </span>
          <Link
            href="/upload"
            className="font-medium text-brand-strong underline"
          >
            Upload a statement
          </Link>
        </div>
      )}
      <Newspaper edition={edition} />
    </div>
  );
}
