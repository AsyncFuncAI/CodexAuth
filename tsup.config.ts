import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    run: "src/run.ts",
    backend: "src/backend/index.ts",
    "backend-next": "src/backend/next/index.ts",
    "backend-worker": "src/backend/worker/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // The browser entries (index, run) must never pull Node built-ins or express.
  // The backend entry is the only one allowed to; mark heavy node deps external.
  external: ["react", "react-dom", "express", "node:child_process", "node:crypto"],
});
