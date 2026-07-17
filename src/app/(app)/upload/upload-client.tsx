"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { UploadCloud } from "lucide-react";

type UploadState = {
  fileName: string;
  status: "uploading" | "parsing" | "done" | "error";
  message?: string;
};

export function UploadDropzone() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        const ext = file.name.split(".").pop()?.toLowerCase();
        if (ext !== "pdf" && ext !== "csv") {
          setUploads((u) => [
            { fileName: file.name, status: "error", message: "Only PDF and CSV files are supported." },
            ...u,
          ]);
          continue;
        }

        setUploads((u) => [{ fileName: file.name, status: "uploading" }, ...u]);
        const update = (patch: Partial<UploadState>) =>
          setUploads((u) =>
            u.map((s) => (s.fileName === file.name ? { ...s, ...patch } : s))
          );

        try {
          const formData = new FormData();
          formData.append("file", file);
          const upRes = await fetch("/api/statements/upload", {
            method: "POST",
            body: formData,
          });
          const upBody = await upRes.json();
          if (!upRes.ok) throw new Error(upBody.error ?? "Upload failed");

          update({ status: "parsing" });
          const res = await fetch("/api/statements/parse", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ statementId: upBody.id }),
          });
          const body = await res.json();
          if (!res.ok) throw new Error(body.error ?? "Parse failed");

          update({
            status: "done",
            message: `${body.inserted} new transactions (${body.skipped} duplicates skipped)`,
          });
          router.refresh();
        } catch (err) {
          update({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
          router.refresh();
        }
      }
    },
    [router]
  );

  return (
    <div className="space-y-3">
      <Card
        className={`cursor-pointer border-2 border-dashed transition-colors ${
          dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25"
        }`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <UploadCloud className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">
            Drop bank statements here, or click to browse
          </p>
          <p className="text-xs text-muted-foreground">
            PDF (scanned or digital) and CSV exports are supported
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.csv"
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
        </CardContent>
      </Card>

      {uploads.length > 0 && (
        <ul className="space-y-1 text-sm">
          {uploads.map((u, i) => (
            <li key={`${u.fileName}-${i}`} className="flex items-center gap-2">
              <span
                className={
                  u.status === "error"
                    ? "text-destructive"
                    : u.status === "done"
                      ? "text-emerald-600"
                      : "text-muted-foreground"
                }
              >
                {u.status === "uploading" && "Uploading…"}
                {u.status === "parsing" && "Extracting transactions…"}
                {u.status === "done" && "Done"}
                {u.status === "error" && "Failed"}
              </span>
              <span className="font-medium">{u.fileName}</span>
              {u.message && (
                <span className="text-muted-foreground">— {u.message}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
