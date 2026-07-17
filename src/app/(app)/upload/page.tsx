import { db } from "@/lib/db";
import type { Statement } from "@/lib/types";
import { UploadDropzone } from "./upload-client";
import { StatementRow } from "./statement-row";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
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
            <ul className="divide-y">
              {(statements as Statement[]).map((s) => (
                <StatementRow key={s.id} statement={s} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
