"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Thin styled checkbox (native input) with indeterminate support for
 * select-all headers.
 */
export function Checkbox({
  className,
  indeterminate = false,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { indeterminate?: boolean }) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className={cn("h-4 w-4 cursor-pointer accent-primary", className)}
      {...props}
    />
  );
}
