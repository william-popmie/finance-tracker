import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // The engine's core is deliberately DOM-free, so these run in plain node.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
