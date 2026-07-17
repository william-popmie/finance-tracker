import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { saveUpload } from "@/lib/storage";

const MAX_SIZE = 25 * 1024 * 1024; // 25 MB

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File too large (max 25 MB)" }, { status: 413 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext !== "pdf" && ext !== "csv") {
    return NextResponse.json(
      { error: "Only PDF and CSV files are supported" },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const storagePath = await saveUpload(buffer, file.name);

  const statement = await db
    .insertInto("statements")
    .values({
      storage_path: storagePath,
      file_name: file.name,
      file_type: ext,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return NextResponse.json({ id: statement.id });
}
