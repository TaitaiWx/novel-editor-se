# Remaining maturity fixes implementation plan

**Goal:** Implement all outstanding items in the previous reliability audit, verify concrete failure modes, and report remaining external prerequisites without claiming simulated platform tests are real installations.

**Authorization:** User explicitly requested immediate implementation of the previously described fixes. Preserve the shared dirty checkout; no commits, releases, actual downgrade, paid AI requests, or changes to original development Electron.

**Architecture:** Field-owned drafts and acknowledged save queues; shared cooperative process leases plus source-change detection; journaled sample publication reused by media generation; OS-native recovery guardian armed before replacing the application; signed build identity as the WebAuthn capability source; strict script typechecking.

**Review focus:** Delayed/out-of-order save acknowledgements; process kill at every publication phase; dead lock owners and overlapping workspace paths; native application failure before JS; missing/mismatched code-signing identity; strict JS checks without blanket suppressions.

- [x] Character design: reproduce another-field draft overwrite and overlapping saves; implement field reconciliation, serialized acknowledged persistence, failure/retry UI, and entity ownership tests.
- [x] Shared workspace lease: test real independent CLI/GUI writers against exports; integrate gates, reject detected uncooperative modifications, test dead-owner recovery.
- [x] Generation transaction: persist recoverable phases, handle process death safely, route media through stage/publication with metadata; test preview, partial failure and recovery.
- [x] Recovery guardian: stage validated rollback artifacts and arm independent OS supervisor before install, nonce-bound healthy acknowledgement, idempotent recovery and permissions/capability preflight; test real child aborts without touching installed apps.
- [x] Touch ID: derive entitlements from actual signing identity and verify signed capability at runtime; reject mismatches; test signing hook contracts, runtime detection and unsigned package behavior.
- [x] Strict JS: include all maintenance JS/CJS/MJS and browser generators in checkJs, add proper API/type declarations; no ts-nocheck/implicit-any escape.
- [x] Integrate, peer-review cross-domain boundaries, run all UT/lint/types/build and relevant Electron/package tests, then update the root-cause audit table with evidence.

External prerequisites remain explicit: a matching provisioning profile and physical Touch ID registration/sign-in (the actual certificate-signed default build was verified), Windows/Linux native installation permissions, and arbitrary third-party editors which do not participate in cooperative locking.
