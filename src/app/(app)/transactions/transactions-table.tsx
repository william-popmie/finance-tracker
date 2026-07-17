"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Category, TransactionWithRelations } from "@/lib/types";
import { updateTransaction } from "./actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function eur(n: number, currency = "EUR") {
  return new Intl.NumberFormat("nl-BE", { style: "currency", currency }).format(n);
}

function categoryPaths(categories: Category[]) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return categories
    .map((c) => {
      const parent = c.parent_id ? byId.get(c.parent_id) : null;
      return { id: c.id, path: parent ? `${parent.name} > ${c.name}` : c.name };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function TransactionsTable({
  transactions,
  categories,
}: {
  transactions: TransactionWithRelations[];
  categories: Category[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<TransactionWithRelations | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const paths = categoryPaths(categories);

  function handleSave(formData: FormData) {
    if (!editing) return;
    setError(null);
    const categoryId = (formData.get("category") as string) || null;
    const merchantName = (formData.get("merchant") as string) || null;
    const tags = ((formData.get("tags") as string) || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const notes = (formData.get("notes") as string) || null;
    const applyToAll = formData.get("applyToAll") === "on";
    const splitRaw = Number.parseInt((formData.get("split") as string) || "", 10);
    const splitCount = Number.isFinite(splitRaw) && splitRaw >= 2 ? splitRaw : null;

    startTransition(async () => {
      try {
        await updateTransaction({
          id: editing.id,
          categoryId,
          merchantName,
          tags,
          notes,
          applyToAll,
          splitCount,
        });
        setEditing(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">Date</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Account</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map((t) => (
            <TableRow
              key={t.id}
              className="cursor-pointer"
              onClick={() => setEditing(t)}
            >
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {t.booking_date}
              </TableCell>
              <TableCell className="max-w-md">
                <p className="truncate font-medium">
                  {t.merchants?.canonical_name ||
                    t.description ||
                    t.counterparty_name ||
                    t.raw_description}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {t.raw_description}
                </p>
                {t.tags.length > 0 && (
                  <p className="mt-0.5 flex flex-wrap gap-1">
                    {t.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-[10px]">
                        {tag}
                      </Badge>
                    ))}
                  </p>
                )}
              </TableCell>
              <TableCell>
                {t.categories ? (
                  <Badge
                    variant="secondary"
                    style={
                      t.categories.color
                        ? {
                            backgroundColor: `${t.categories.color}20`,
                            color: t.categories.color,
                          }
                        : undefined
                    }
                  >
                    {t.categories.name}
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {t.accounts?.name ?? "—"}
              </TableCell>
              <TableCell
                className={`whitespace-nowrap text-right font-medium ${
                  t.amount < 0 ? "text-red-600" : "text-emerald-600"
                }`}
              >
                {eur(Number(t.amount), t.currency)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          {editing && (
            <form action={handleSave} className="contents">
              <DialogHeader>
                <DialogTitle>Edit transaction</DialogTitle>
                <DialogDescription className="break-words">
                  {editing.booking_date} · {eur(Number(editing.amount), editing.currency)}
                  <br />
                  <span className="text-xs">{editing.raw_description}</span>
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="merchant">Merchant</Label>
                  <Input
                    id="merchant"
                    name="merchant"
                    defaultValue={editing.merchants?.canonical_name ?? ""}
                    placeholder="e.g. Carrefour Express"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="category">Category</Label>
                  <select
                    id="category"
                    name="category"
                    defaultValue={editing.category_id ?? ""}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                  >
                    <option value="">Uncategorized</option>
                    {paths.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.path}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tags">Tags (comma-separated)</Label>
                  <Input
                    id="tags"
                    name="tags"
                    defaultValue={editing.tags.join(", ")}
                    placeholder="festival-x, shared-expense"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    name="notes"
                    rows={2}
                    defaultValue={editing.notes ?? ""}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="applyToAll" className="h-4 w-4" />
                  Apply this category to all transactions from this merchant
                </label>
                {Number(editing.amount) < 0 && (
                  <div className="space-y-1.5">
                    <Label htmlFor="split">
                      Split across people (incl. you) — tracks repayments
                    </Label>
                    <Input
                      id="split"
                      name="split"
                      type="number"
                      min={2}
                      max={20}
                      placeholder="e.g. 4"
                    />
                  </div>
                )}
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
