import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Statement files live on the local filesystem (gitignored).
const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");

/** Save an uploaded statement; returns the relative storage path. */
export async function saveUpload(
  buffer: Buffer,
  fileName: string
): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const safeName = path.basename(fileName).replaceAll(/[^\w.\-]/g, "_");
  const relative = `${randomUUID()}-${safeName}`;
  await writeFile(path.join(UPLOAD_DIR, relative), buffer);
  return relative;
}

/** Read a stored statement file by its relative storage path. */
export async function readUpload(storagePath: string): Promise<Buffer> {
  const resolved = path.resolve(UPLOAD_DIR, storagePath);
  if (!resolved.startsWith(UPLOAD_DIR + path.sep)) {
    throw new Error("Invalid storage path");
  }
  return readFile(resolved);
}
