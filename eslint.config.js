// Minimal flat ESLint config. Kept intentionally light for v1 — the build's
// `tsc --noEmit` typecheck is the primary correctness gate.
export default [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
];
