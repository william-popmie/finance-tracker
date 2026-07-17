import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runCategorization } from "@/lib/ai/categorize";

export const maxDuration = 300;

export async function POST() {
  try {
    const result = await runCategorization(db);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
