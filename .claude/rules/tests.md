---
name: tests
description: Rules for integration test files in the test/ directory
paths:
  - oikos/test/test-*.js
---

- File names match the pattern `test-<module>.js` and live in the `test/` directory. Imports of app code (`server/`, `public/`, `tools/`) and root files (`install.sh`, `.env.example`, compose files) are one level up (`../`).
- Every test file has a matching npm script `test:<module>` in `package.json`. The `test` aggregate script runs them all. When you add a new `test-*.js`, add it to both places.
- Runner is `node --test` (built-in, Node ≥22). Scripts that hit the DB pass `--experimental-sqlite`.
- Database in tests is an in-memory `better-sqlite3` instance built via the same `buildSchema` path used by production. Never mock `better-sqlite3`. Never stub out migrations. If a test needs seed data, insert it through normal route handlers or the same queries prod uses.
- Assertions via `node:assert/strict`. Imports use `import` syntax. No `require`.
- Tests must be deterministic. No network calls, no real filesystem writes outside `os.tmpdir()`, no `Date.now()` without faking.
- A failing test is a real failure. Don't wrap in `t.skip` or comment out to make CI green.
