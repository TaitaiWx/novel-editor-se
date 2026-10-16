# Character editing validation implementation plan

**Goal:** Add regression coverage for character enrichment, editable diffs, staged development records, persistence and navigation protection, then run the complete repository checks.

**Architecture:** Pure unit tests cover shared algorithms and data contracts. Renderer tests exercise real CodeMirror and React state with IPC boundary doubles. Electron E2E uses disposable sample projects and a local HTTP AI service, with real UI input, IPC and SQLite writes.

**Tech stack:** Vitest, Testing Library/happy-dom, Electron/CDP, TypeScript.

**Spec:** User requests in this conversation: optional fields and four editable tabs; no enrichment of growth/gallery; inline colored additions/deletions; drafts saved/cancelled per tab; failure/retry details and navigation protection; multiple staged character entries and chapter discovery.

## Constraints

- Preserve the existing uncommitted implementation and user data. No commit/push.
- User now explicitly authorizes UT/E2E and full validation.
- Do not use real API credentials or charge external AI services for deterministic regression tests.
- Do not weaken assertions, skip failing cases or increase timeouts without finding the cause.

## Work

- [ ] Pure UT: Unicode and multiline diff, output offsets and long input; enrichment batching/errors/scope; development history/migration/tombstones; discovery evidence.
- [ ] Persistence UT: workspace and payload validation, compare-and-swap, atomic group rollback, stale project handling and request timeout.
- [ ] Renderer UT: real editable diff input, draft baseline lifecycle, loading/retry, per-tab save/cancel, leave guards; update old textarea assumptions.
- [ ] Electron E2E: local AI truncation/invalid replies, popup closure/loading, edited diff saved without deletion marks, per-tab isolation, retained draft navigation, retry and persisted reload.
- [ ] Reproduce and fix any production bugs exposed by the above.
- [ ] Run all `pnpm test:ut`, `pnpm test:e2e`, `pnpm typecheck`, `pnpm lint`, build/CLI build and bundle checks. Record totals and explicit environment-gated exclusions.

## Review focus

- Unicode graphemes and deleted text must never corrupt copied or saved text.
- Generated values must never overwrite newer user edits or unrelated tabs.
- A failed partial batch must retain successful drafts and allow retry.
- App refresh and switching characters must not destroy pending edits.
- E2E failures must not be hidden by broad console-error suppression.
