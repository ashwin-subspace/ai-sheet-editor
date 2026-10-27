import { useEffect, useMemo, useRef, useState } from "react";
import { proposeEdits, type CompletionRequest, type CompletionResult } from "../ai/propose";
import { formatRange, indexToCol, normalizeSelection, parseAddress } from "../engine/address";
import type { ChatTurn } from "../engine/context";
import { evaluationCache } from "../engine/formula";
import { createHistory, pushHistory, redoHistory, undoHistory, type HistoryState } from "../engine/history";
import { reviewModelText } from "../engine/operations";
import { SAMPLE_EDIT } from "../engine/sample";
import { COL_COUNT, ROW_COUNT, createWorkbook, type Workbook } from "../engine/types";
import { applyUserInput, cellView, formulaBarText, sameWorkbook } from "../engine/workbook";
import { ChatPanel, type ChatMessage } from "./ChatPanel";
import { FormulaBar } from "./FormulaBar";
import { Grid } from "./Grid";

interface ListedFile {
  name: string;
  path: string;
}

interface StoredChat {
  messages: { role: "user" | "assistant" | "error"; text: string }[];
}

export function App() {
  const [history, setHistory] = useState<HistoryState>(() => createHistory(createWorkbook()));
  const [previewBook, setPreviewBook] = useState<Workbook | null>(null);
  const [changed, setChanged] = useState<string[]>([]);
  const [changedColumns, setChangedColumns] = useState<string[]>([]);
  const [summaries, setSummaries] = useState<string[]>([]);
  const [previewWarning, setPreviewWarning] = useState<string | undefined>();
  const [selection, setSelection] = useState({ anchor: "A1", end: "A1" });
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [directory, setDirectory] = useState("");
  const [files, setFiles] = useState<ListedFile[]>([]);
  const [fileName, setFileName] = useState("Untitled.xlsx");
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [helperOk, setHelperOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Type in a cell, or preview the sample edit.");
  const draftRef = useRef("");
  const anchorRef = useRef("A1");
  const previewRef = useRef(false);
  const workbookRef = useRef(history.present);

  const shown = previewBook ?? history.present;
  const cache = useMemo(() => evaluationCache(), [shown]);
  const previewing = previewBook !== null;

  useEffect(() => {
    workbookRef.current = history.present;
    if (previewRef.current) return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active.getAttribute("aria-label") === "Formula bar") return;
    const bar = formulaBarText(history.present.cells[anchorRef.current]);
    draftRef.current = bar;
    setDraft(bar);
  }, [history.present]);
  useEffect(() => {
    previewRef.current = previewing;
  }, [previewing]);

  useEffect(() => {
    void refreshHelper();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !typing) {
        event.preventDefault();
        if (previewRef.current) return;
        setHistory((current) => {
          const next = event.shiftKey ? redoHistory(current) : undoHistory(current);
          workbookRef.current = next.present;
          return next;
        });
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y" && !typing) {
        event.preventDefault();
        if (previewRef.current) return;
        setHistory((current) => {
          const next = redoHistory(current);
          workbookRef.current = next.present;
          return next;
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function replaceHistory(next: HistoryState) {
    workbookRef.current = next.present;
    setHistory(next);
    rememberDraft(formulaBarText(next.present.cells[anchorRef.current]));
  }

  function rememberDraft(value: string) {
    draftRef.current = value;
    setDraft(value);
  }

  function commitDraft() {
    if (previewRef.current) return;
    const address = anchorRef.current;
    const previous = workbookRef.current;
    const next = applyUserInput(previous, address, draftRef.current);
    if (sameWorkbook(previous, next)) return;
    workbookRef.current = next;
    setHistory((current) => pushHistory({ ...current, present: previous }, next));
  }

  function selectCell(anchor: string, end: string) {
    commitDraft();
    anchorRef.current = anchor;
    const bar = formulaBarText(workbookRef.current.cells[anchor]);
    if (previewRef.current) {
      const source = previewBook ?? workbookRef.current;
      const previewBar = formulaBarText(source.cells[anchor]);
      rememberDraft(previewBar);
    } else {
      rememberDraft(bar);
    }
    setSelection({ anchor, end });
  }

  function moveActive(colDelta: number, rowDelta: number) {
    const pos = parseAddress(anchorRef.current);
    if (!pos) return;
    const col = Math.min(COL_COUNT, Math.max(1, pos.col + colDelta));
    const row = Math.min(ROW_COUNT, Math.max(1, pos.row + rowDelta));
    const address = `${indexToCol(col)}${row}`;
    selectCell(address, address);
  }

  async function refreshHelper() {
    try {
      const config = await fetch("/api/config").then((response) => response.json() as Promise<{ directory: string }>);
      setHelperOk(true);
      setDirectory((current) => current || config.directory);
      await loadFiles(config.directory);
    } catch {
      setHelperOk(false);
    }
  }

  async function loadFiles(folder = directory) {
    if (!folder) return;
    const response = await fetch(`/api/files?directory=${encodeURIComponent(folder)}`);
    if (!response.ok) return;
    const body = (await response.json()) as { files: ListedFile[] };
    setFiles(body.files);
  }

  function loadDocument(workbook: Workbook, chat: StoredChat | undefined, warningsNext: string[], path: string | null, name: string) {
    workbookRef.current = workbook;
    setHistory(createHistory(workbook));
    setPreviewBook(null);
    setChanged([]);
    setSummaries([]);
    setPreviewWarning(undefined);
    setWarnings(warningsNext);
    setMessages((chat?.messages ?? []).map((message, index) => ({ ...message, id: `${index}-${message.role}` })));
    setCurrentPath(path);
    setFileName(name);
    anchorRef.current = "A1";
    setSelection({ anchor: "A1", end: "A1" });
    rememberDraft(formulaBarText(workbook.cells.A1));
  }

  async function openPath(filePath: string) {
    if (!confirmIfDirty()) return;
    const response = await fetch("/api/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath }),
    });
    const body = await response.json();
    if (!response.ok) {
      setStatus(body.error ?? "Could not open that file.");
      return;
    }
    loadDocument(body.workbook, body.chat, body.warnings ?? [], body.path, filePath.split(/[/\\]/).pop() ?? "Workbook.xlsx");
    setStatus(body.warnings?.length ? "Opened with some Excel features left out." : "Opened.");
  }

  async function uploadFile(file: File) {
    if (!confirmIfDirty()) return;
    const dataBase64 = await readBase64(file);
    const response = await fetch("/api/open-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, dataBase64 }),
    });
    const body = await response.json();
    if (!response.ok) {
      setStatus(body.error ?? "Could not read that file.");
      return;
    }
    loadDocument(body.workbook, { messages: [] }, body.warnings ?? [], null, body.fileName);
    setStatus("Opened a copy. Save writes it into the workbook folder.");
  }

  async function save() {
    const target = saveTarget();
    const response = await fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: target,
        workbook: history.present,
        chat: { messages: messages.map(({ role, text }) => ({ role, text })) },
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      setStatus(body.error ?? "Save failed. Is the file helper running?");
      return;
    }
    setCurrentPath(body.path);
    setFileName(body.path.split(/[/\\]/).pop() ?? fileName);
    setStatus(body.backup ? `Saved. Previous copy: ${body.backup}` : "Saved.");
    await loadFiles();
  }

  function saveTarget(): string {
    const name = fileName.toLowerCase().endsWith(".xlsx") ? fileName : `${fileName}.xlsx`;
    if (currentPath && currentPath.toLowerCase().endsWith(name.toLowerCase())) return currentPath;
    const separator = directory.includes("\\") ? "\\" : "/";
    return `${directory.replace(/[\\/]$/, "")}${separator}${name}`;
  }

  function confirmIfDirty(): boolean {
    const dirty = history.past.length > 0 || messages.length > 0;
    if (!dirty) return true;
    return window.confirm("Open another file and leave the current sheet?");
  }

  function showPreview(review: Extract<ReturnType<typeof reviewModelText>, { ok: true }>) {
    setPreviewBook(review.workbook);
    setChanged(review.changed);
    setChangedColumns(review.changedColumns);
    setSummaries(review.summaries);
    setPreviewWarning(review.warning);
    rememberDraft(formulaBarText(review.workbook.cells[anchorRef.current]));
  }

  function acceptPreview() {
    if (!previewBook) return;
    const accepted = previewBook;
    setHistory((current) => pushHistory(current, accepted));
    workbookRef.current = accepted;
    setPreviewBook(null);
    setChanged([]);
    setSummaries([]);
    setPreviewWarning(undefined);
    rememberDraft(formulaBarText(accepted.cells[anchorRef.current]));
    setStatus("Accepted. You can undo this.");
  }

  function rejectPreview() {
    setPreviewBook(null);
    setChanged([]);
    setSummaries([]);
    setPreviewWarning(undefined);
    rememberDraft(formulaBarText(workbookRef.current.cells[anchorRef.current]));
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "assistant", text: "Rejected the preview. The sheet was not changed." },
    ]);
    setStatus("Rejected. The sheet was not changed.");
  }

  function previewSample() {
    if (previewing) return;
    commitDraft();
    const review = reviewModelText(SAMPLE_EDIT, workbookRef.current, normalizeSelection(selection.anchor, selection.end));
    if (!review.ok) {
      setStatus(review.error);
      return;
    }
    showPreview(review);
    setStatus("Sample edit is ready. Accept or reject it.");
  }

  async function sendPrompt(prompt: string) {
    if (previewing || busy) return;
    commitDraft();
    const prior = messages;
    const nextMessages = [...prior, { id: crypto.randomUUID(), role: "user" as const, text: prompt }];
    setMessages(nextMessages);
    setBusy(true);
    setStatus("Asking the local model…");
    const historyTurns: ChatTurn[] = prior
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({ role: message.role as "user" | "assistant", text: message.text }));
    const result = await proposeEdits({
      workbook: workbookRef.current,
      selection,
      history: historyTurns,
      prompt,
      complete: completeModel,
    });
    setBusy(false);
    if (result.kind === "error") {
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "error", text: result.message }]);
      setStatus(result.message);
      return;
    }
    if (result.kind === "message") {
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: result.message }]);
      setStatus("Answered without changing the sheet.");
      return;
    }
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "assistant", text: result.review.message || "Proposed an edit." },
    ]);
    showPreview(result.review);
    setStatus("Preview is ready. The sheet changes only if you accept.");
  }

  const range = normalizeSelection(selection.anchor, selection.end);
  const nameBox = range ? formatRange(range) : selection.anchor;

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">Local AI Sheet</div>
        <label>
          Folder
          <input value={directory} onChange={(event) => setDirectory(event.target.value)} spellCheck={false} />
        </label>
        <button type="button" onClick={() => void loadFiles()}>Refresh</button>
        <select
          value=""
          onChange={(event) => {
            if (event.target.value) void openPath(event.target.value);
          }}
          aria-label="Open a workbook from the folder"
        >
          <option value="">Open…</option>
          {files.map((file) => (
            <option key={file.path} value={file.path}>{file.name}</option>
          ))}
        </select>
        <label className="upload">
          Upload
          <input
            type="file"
            accept=".xlsx"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void uploadFile(file);
            }}
          />
        </label>
        <label>
          File
          <input value={fileName} onChange={(event) => { setFileName(event.target.value); setCurrentPath(null); }} />
        </label>
        <button type="button" onClick={() => void save()} disabled={previewing}>Save</button>
        <button type="button" onClick={() => replaceHistory(undoHistory(history))} disabled={previewing || history.past.length === 0}>Undo</button>
        <button type="button" onClick={() => replaceHistory(redoHistory(history))} disabled={previewing || history.future.length === 0}>Redo</button>
        <span className={helperOk ? "status ok" : "status bad"}>{helperOk ? "File helper connected" : "File helper is not running"}</span>
      </header>
      {warnings.length > 0 && (
        <div className="banner">
          {warnings.map((warning) => <p key={warning}>{warning}</p>)}
          <button type="button" onClick={() => setWarnings([])}>Dismiss</button>
        </div>
      )}
      <div className="workspace">
        <section className="sheet-pane">
          <FormulaBar
            name={nameBox}
            value={draft}
            locked={previewing}
            onChange={rememberDraft}
            onCommit={commitDraft}
          onMove={() => moveActive(0, 1)}
          />
          <Grid
            workbook={shown}
            cache={cache}
            selection={selection}
            changed={new Set(changed)}
            changedColumns={new Set(changedColumns)}
            onSelect={selectCell}
          />
          <div className="sheet-tab">Sheet1</div>
        </section>
        <ChatPanel
          messages={messages}
          busy={busy}
          previewing={previewing}
          summaries={summaries}
          warning={previewWarning}
          status={status}
          onSend={(prompt) => void sendPrompt(prompt)}
          onSample={previewSample}
          onAccept={acceptPreview}
          onReject={rejectPreview}
        />
      </div>
    </div>
  );
}

async function completeModel(request: CompletionRequest): Promise<CompletionResult> {
  try {
    const response = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const body = (await response.json()) as { content?: string; error?: string; schemaRejected?: boolean };
    if (!response.ok || !body.content) {
      return {
        ok: false,
        status: response.status,
        error: body.error ?? (response.ok
          ? "The model returned an empty reply. The sheet was not changed."
          : "The file helper could not reach LM Studio. The sheet was not changed."),
        schemaRejected: Boolean(body.schemaRejected),
      };
    }
    return { ok: true, content: body.content };
  } catch {
    return {
      ok: false,
      status: 0,
      error: "The file helper is not running. Start it with npm run server. The sheet was not changed.",
    };
  }
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
