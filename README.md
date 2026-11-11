# AI Sheet Editor

**Showcase:** [website/index.html](website/index.html) — static overview of stack, workflow, and usage (open in a browser, or `npm run showcase`).

Local spreadsheet workspace with an AI chat sidebar. You edit cells in the grid (or via formulas); the model proposes structured edits, a checker validates them on a copy, and nothing hits the real sheet until you accept.

## Quick start

```bash
npm install
npm run dev:all
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Vite proxies `/api` to the Node file helper on port **8787**.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev:all` | File helper + Vite dev server |
| `npm run server` | Node helper only (`server/index.ts`) |
| `npm run dev` | Vite only |
| `npm test` | Vitest unit tests |
| `npm run build` | Typecheck + production bundle |
| `npm run showcase` | Serve static project site (`website/`) |
| `npm run scorecard` | Regenerates `docs/model-notes.md` (needs a live provider) |

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `OLLAMA_URL` | `http://127.0.0.1:11434/v1` | Ollama OpenAI-compatible API base |
| `WORKBOOK_DIR` | `./workbooks` | Folder for `.xlsx` and `.chat.json` |

API keys for Gemini and Groq are stored locally in `server/model-settings.json` (gitignored). Pick provider and model in the app toolbar.

## Layout

- `src/ui/` — React UI (grid, chat, accept/reject)
- `src/engine/` — Workbook engine, formulas, operations
- `src/ai/` — Model proposal schema and client
- `server/` — HTTP API: files, backups, model proxy, settings
- `docs/` — Product notes and UX scope

See `docs/idea.md` for the product overview.
