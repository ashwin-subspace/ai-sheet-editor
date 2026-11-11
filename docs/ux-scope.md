# UX scope and expansion rules

This document defines what the Local AI Sheet UI promises today and what must be updated before shipping larger changes.

## Always on (no AI gate)

- Grid editing (A–Z × 200), formula bar, undo/redo
- Open, upload, save via the file helper
- **Preview sample edit** — runs the local checker only; no model call

## Gated AI

Chat **Send** is disabled until client readiness is green:

1. File helper responds (`/api/health`)
2. `SAMPLE_EDIT` passes `reviewModelText` in the browser
3. Server `/api/ready` confirms provider, API key (if needed), model, and curated model list

Preventable failures (not ready, no model, missing key) must **not** call `proposeEdits` and must **not** show raw provider errors in chat. Use the setup strip or structured fix cards.

## Curated models

- Main toolbar shows at most **three** sheet-friendly models per provider (`listCuratedModels`).
- **Advanced** may expose “Show all models” with a warning.
- Changing allowlists in `src/shared/sheet-models.ts` requires updating `sheet-models.test.ts` and verifying `/api/ready` still passes for typical installs.

## Supported prompt style (user-facing)

Encourage: small tables, formatting, formulas, questions about the selection. Do not imply full Excel parity or unconstrained “change anything” without checker support.

## Layer boundaries

| Layer | Responsibility |
|-------|----------------|
| Engine / checker | Authoritative edit validation; new op types need tests |
| AI propose | Schema + repairs; no direct sheet writes |
| Server helper | Files, settings, provider proxy, readiness |
| UI | When AI runs, how errors read, model curation |

## Later (optional) — ship only with checklist

- Multi-sheet import, more file formats
- Prompt templates library
- Electron shell
- Per-user allowlist file or scorecard-driven ranking
- Startup model ping (`STARTUP_PING_MODEL=1`)

For any “Later” item: update allowlists, readiness tests, and this doc before merge.

## Tests to keep green

- `npm test` (engine, shared, server handler, provider)
- New modules: `sheet-models`, `user-errors`, `readiness`, `server/ready`, `GET /api/ready`
