# Shared components implementation plan

## Goal and boundary

Centralize reusable React UI implementations and SCSS in `@novel-editor/ui`, replace application imports, and prevent new copies. Keep Electron IPC, workspace persistence, AI orchestration and feature screens in the app, injecting data/actions into shared views. Preserve appearance, keyboard/IME handling, refs, portals, context identity and lazy editor loading.

## Work

- [x] Move existing UI controls, overlays, feedback, layout and diff components into the package with explicit subpath exports and public prop types.
- [x] Extract avatar and window controls as presentational components; retain IPC/resource resolution in thin app adapters.
- [x] Introduce Button, Input and TextArea primitives, route React native controls through them while preserving existing styles and native semantics.
- [x] Replace production imports with package subpaths. Leave old modules as forwarding-only compatibility entries so current consumers share the same contexts/implementations.
- [x] Declare package dependencies, CSS Modules types and reusable animation/IME utilities; keep heavy CodeMirror components out of lightweight entry imports.
- [x] Add usage and ownership documentation. Remove the boundary-check script as requested.
- [x] Verify package/app production TypeScript, ESLint, formatting, Sass and renderer production build to a temporary output directory. Keep the running app and user data untouched; use isolated test hosts and temporary build output.

## UI package and testing follow-up

- [x] Rename directory and all package references to `packages/ui` / `@novel-editor/ui`.
- [x] Remove the boundary-check script and its package/root commands.
- [x] Move existing shared UI tests to the package, add missing interaction and failure-path coverage, and keep the entire source tree in the coverage denominator.
- [x] Add isolated Vitest + native WebSocket CDP browser tests, reusing the existing CDP driver without Playwright or application/database startup.
- [x] Reproduce and fix native Modal child overlays being rendered behind the dialog; cover containment in UT and real browser interaction in E2E.
- [x] Add dedicated test/typecheck commands and coverage thresholds.

The initial UT baseline was 70 cases: 60.10% lines and 54.48% branches. Test commands and coverage requirements are documented in `packages/ui/README.md`.
