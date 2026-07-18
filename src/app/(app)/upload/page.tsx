import { db } from "@/lib/db";
import type { Statement } from "@/lib/types";
import { UploadDropzone } from "./upload-client";
import { StatementsList } from "./statements-list";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  // Self-heal statements stuck in "parsing" (server killed mid-parse):
  // after 15 minutes they're clearly dead — flip to error so Re-parse works.
  await db
    .updateTable("statements")
    .set({
      status: "error",
      error_msg: "Parsing was interrupted — click Re-parse.",
    })
    .where("status", "=", "parsing")
    .where(
      "created_at",
      "<",
      new Date(Date.now() - 15 * 60_000).toISOString()
    )
    .execute();

  const statements = await db
    .selectFrom("statements")
    .selectAll()
    .orderBy("created_at", "desc")
    .execute();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Upload statements</h1>
      <UploadDropzone />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Uploaded statements</CardTitle>
        </CardHeader>
        <CardContent>
          {!statements || statements.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              Nothing uploaded yet.
            </p>
          ) : (
            <StatementsList statements={statements as Statement[]} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
