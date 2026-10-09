# Reliability hardening implementation plan

> **For agentic workers:** Use test-driven development for each behavior change; coordinate shared lifecycle APIs before editing shared files.

**Goal:** Complete the requested development-launch simplification, four P1 fixes and three P2 fixes, then report verification and remaining maturity issues.

**Architecture:** Explicit renderer save acknowledgements and main-process write barriers protect shutdown and export. Rollback uses immutable, version-verified artifacts and the existing platform updater installer. Maintenance tools validate destinations and publish staged output; release gates run on the exact tagged commit.

**Tech Stack:** Electron 42, React 18, TypeScript, better-sqlite3, pnpm, Vitest, electron-builder/updater, GitHub Actions.

**Spec:** User's 2026-10-09 request in this conversation: implement eight reviewed items and produce a first-principles audit table.

## Constraints and review focus

- Preserve existing dirty user changes and prior fixes. Work in this authorized shared checkout; no commits, releases or real installation side effects.
- New IPC must be sender-bound, typed and included in preload allowlists.
- Do not equate a timeout, a spawned installer or a downloaded file with completed saving/recovery.
- Test delayed/rejected writes, cancellation, process loss, wrong version/hash, partial-copy failure, and unsafe script destinations.
- Agents run scoped isolated tests; root runs full checks after integration.

## Tasks

- [x] Remove development Electron copying/signing; test original binary launch and packaged localized resources.
- [x] P1: Native close/quit saves all affected drafts, awaits acknowledgement and main queues; failure cancels close.
- [x] P1: Bind rollback downloads/cache to immutable version/platform/architecture and trusted expected hashes.
- [x] P1: Complete automatic rollback through platform installer; commit state only after target version is healthy.
- [x] P1: Flush and coordinate project export, use SQLite backup, stage and publish coherent output.
- [x] P2: Gate tagged releases with lint, all typechecks and unit tests on that exact commit.
- [x] P2: Validate sample-generation target and publish generated data transactionally instead of deleting first.
- [x] P2: Include maintenance scripts in lint/typechecking, remove unused notarization wrapper, document entrypoints.
- [x] Narrow sample metadata Git allowlist.
- [x] Review integrated changes for root-cause fixes and additional maturity issues; record evidence in report.
- [x] Run final checks and appropriate real Electron/package checks; mark only verified items complete.

## Shared interfaces

Shutdown owns renderer save acknowledgement, preload and renderer IPC types. Export consumes that barrier and coordinates file/database snapshot operations. Rollback consumes safe-quit preparation before invoking native installation. Root owns launch/scripts/config/release gates and integration checks.

## Execution record

2026-10-09: Existing checkout intentionally retained because this task continues the user's uncommitted changes. Three independent domain workers dispatched under the parallel-agents skill; root implements development and maintenance workflow changes.

2026-10-09 验证：全量 4094 UT 通过，lint 零警告、typecheck、生产构建通过；8 项选定真实 Electron/打包测试通过。复查追加修复了窗口发送方、后台视频、导出副本任务、原生安装异步错误、多架构元数据、canary 通道、镜像提交及 macOS 无效权限。完整表格与边界见 `docs/reliability-audit-2026-10-09.md`。实际平台升级降级、生产公证不在本机伪造执行。
