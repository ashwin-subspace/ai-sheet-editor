import { useEffect, useMemo, useRef, useState } from "react";
import { proposeEdits } from "../ai/propose";
import { formatRange, indexToCol, normalizeSelection, parseAddress } from "../engine/address";
import type { ChatTurn } from "../engine/context";
import { evaluationCache } from "../engine/formula";
import { createHistory, pushHistory, redoHistory, undoHistory, type HistoryState } from "../engine/history";
import { reviewModelText } from "../engine/operations";
import { SAMPLE_EDIT } from "../engine/sample";
import { COL_COUNT, ROW_COUNT, createWorkbook, type Workbook } from "../engine/types";
import { applyUserInput, cellView, formulaBarText, sameWorkbook } from "../engine/workbook";
import { listCuratedModels, modelOptionLabel, pickDefaultModel, shouldAutoSwitchModel, type ModelProviderId } from "../shared/sheet-models";
import { formatUserError, userErrorFromMessage } from "../shared/user-errors";
import { ChatPanel, type ChatMessage, type SetupIssue } from "./ChatPanel";
import { runClientReadiness } from "./readiness";
import { FormulaBar } from "./FormulaBar";
import { Grid } from "./Grid";
import { completeModel as completeModelRequest, isDirty, rejectAssistantText } from "./preview-state";

interface ListedFile {
  name: string;
  path: string;
}

interface StoredChat {
  messages: { role: "user" | "assistant" | "error"; text: string }[];
}

type ProviderId = "ollama" | "gemini" | "groq";

interface PublicSettings {
  provider: ProviderId;
  providerLabel: string;
  model: string;
  keyConfigured: boolean;
  keyHint: string;
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
  const [modelNote, setModelNote] = useState("Checking models…");
  const [provider, setProvider] = useState<ProviderId>("ollama");
  const [selectedModel, setSelectedModel] = useState("");
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [keyHint, setKeyHint] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [showAllModels, setShowAllModels] = useState(false);
  const [usageNote, setUsageNote] = useState("");
  const [aiReady, setAiReady] = useState(false);
  const [setupIssues, setSetupIssues] = useState<SetupIssue[]>([]);
  const [checkingSetup, setCheckingSetup] = useState(false);
  const draftRef = useRef("");
  const anchorRef = useRef("A1");
  const previewRef = useRef(false);
  const workbookRef = useRef(history.present);

  const shown = previewBook ?? history.present;
  const cache = useMemo(() => evaluationCache(), [shown]);
  const previewing = previewBook !== null;
  const visibleModels = useMemo(() => {
    const curated = listCuratedModels(modelOptions, provider as ModelProviderId);
    const base = showAllModels
      ? listCuratedModels(modelOptions, provider as ModelProviderId, { showAll: true, max: modelOptions.length })
      : curated;
    if (selectedModel && !base.includes(selectedModel)) return [selectedModel, ...base];
    return base;
  }, [modelOptions, showAllModels, selectedModel, provider]);

  const statusPill = useMemo(() => {
    if (!helperOk) return { label: "Offline editing only", tone: "offline" as const };
    if (aiReady) return { label: "Ready", tone: "ready" as const };
    return { label: "Setup needed", tone: "setup" as const };
  }, [helperOk, aiReady]);

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
    void loadProvider();
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

  async function refreshReadiness() {
    setCheckingSetup(true);
    try {
      const result = await runClientReadiness();
      setAiReady(result.ok);
      setSetupIssues(result.issues.map((issue) => ({ title: issue.title, fix: issue.fix })));
    } finally {
      setCheckingSetup(false);
    }
  }

  function applyUsageFromBody(body: { usageNote?: string }) {
    if (typeof body.usageNote === "string" && body.usageNote.trim()) {
      setUsageNote(body.usageNote.trim());
    }
  }

  function applyPublic(settings: PublicSettings) {
    setProvider(settings.provider);
    setSelectedModel(settings.model);
    setKeyConfigured(settings.keyConfigured);
    setKeyHint(settings.keyHint);
    if (settings.provider === "ollama") setUsageNote("");
    setModelNote(
      settings.model
        ? `${settings.providerLabel}: ${settings.model}`
        : `${settings.providerLabel} (choose a model${settings.provider === "ollama" ? "" : " after saving an API key"})`,
    );
  }

  async function postSettings(update: { provider: ProviderId; model?: string; apiKey?: string }): Promise<PublicSettings> {
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    if (response.status === 404) {
      throw new Error("OUTDATED_HELPER");
    }
    if (!response.ok) throw new Error("Could not save the model settings.");
    return await response.json() as PublicSettings;
  }

  function settingsFailureMessage(error: unknown): string {
    if (error instanceof Error && error.message === "OUTDATED_HELPER") {
      return "The file helper is still the old version (no /api/settings). Stop it and run npm run dev:all again from this project folder.";
    }
    return "The file helper is not running, so provider settings could not be saved.";
  }

  async function loadProvider() {
    try {
      const response = await fetch("/api/settings");
      if (response.status === 404) {
        setModelNote(settingsFailureMessage(new Error("OUTDATED_HELPER")));
        setStatus(settingsFailureMessage(new Error("OUTDATED_HELPER")));
        return;
      }
      if (!response.ok) throw new Error("settings");
      const settings = await response.json() as PublicSettings;
      applyPublic(settings);
      await loadModelIds(settings);
      await refreshReadiness();
    } catch {
      setModelNote("The file helper is not running, so the model list could not be checked.");
      setAiReady(false);
    }
  }

  async function loadModelIds(settings: PublicSettings) {
    try {
      const response = await fetch("/api/models");
      const body = (await response.json()) as {
        models?: string[];
        curatedModels?: string[];
        defaultModel?: string;
        error?: string;
        usageNote?: string;
      };
      applyUsageFromBody(body);
      const ids = Array.isArray(body.models) ? body.models.filter((id) => id) : [];
      setModelOptions(ids);
      const curated = Array.isArray(body.curatedModels) && body.curatedModels.length
        ? body.curatedModels
        : listCuratedModels(ids, settings.provider);
      if (!response.ok || ids.length === 0) {
        setModelNote(
          settings.provider === "ollama" && ids.length === 0
            ? "Start Ollama and pull a chat model (e.g. llama3.1:8b)."
            : body.error ?? `${settings.providerLabel}: no models listed.`,
        );
        return;
      }
      if (settings.model && ids.includes(settings.model)) {
        if (shouldAutoSwitchModel(settings.model, settings.provider)) {
          const better = pickDefaultModel(ids, settings.provider);
          if (better && better !== settings.model) {
            const saved = await postSettings({ provider: settings.provider, model: better });
            applyPublic(saved);
            setModelNote(`${settings.providerLabel}: switched to ${better} for sheet edits.`);
            return;
          }
        }
        setModelNote(`${settings.providerLabel}: ${settings.model}`);
        return;
      }
      const next = body.defaultModel && ids.includes(body.defaultModel)
        ? body.defaultModel
        : pickDefaultModel(ids, settings.provider);
      if (!next) {
        setModelNote(
          curated.length
            ? `${settings.providerLabel}: choose a model from the short list.`
            : "Pull or enable a sheet-friendly chat model.",
        );
        return;
      }
      const saved = await postSettings({ provider: settings.provider, model: next });
      applyPublic(saved);
    } catch (error) {
      setModelNote(settingsFailureMessage(error));
    }
  }

  async function chooseProvider(next: ProviderId) {
    const previous = provider;
    setApiKeyDraft("");
    setProvider(next);
    setSelectedModel("");
    setModelOptions([]);
    setShowAllModels(false);
    setUsageNote("");
    setModelNote(`Saving ${next === "ollama" ? "Ollama" : next === "gemini" ? "Gemini" : "Groq"}…`);
    try {
      const saved = await postSettings({ provider: next, model: "" });
      applyPublic(saved);
      setModelNote(`Checking ${saved.providerLabel} models…`);
      await loadModelIds(saved);
      await refreshReadiness();
    } catch (error) {
      setProvider(previous);
      const message = settingsFailureMessage(error);
      setModelNote(message);
      setStatus(message);
    }
  }

  async function chooseModel(next: string) {
    if (!next) return;
    try {
      const saved = await postSettings({ provider, model: next });
      applyPublic(saved);
      await refreshReadiness();
    } catch (error) {
      const message = settingsFailureMessage(error);
      setModelNote(message);
      setStatus(message);
    }
  }

  async function saveKey() {
    const key = apiKeyDraft.trim();
    if (!key || provider === "ollama") return;
    try {
      const saved = await postSettings({ provider, model: selectedModel, apiKey: key });
      setApiKeyDraft("");
      applyPublic(saved);
      await loadModelIds(saved);
      await refreshReadiness();
    } catch (error) {
      const message = settingsFailureMessage(error);
      setModelNote(message);
      setStatus(message);
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
    if (!isDirty(history.past.length, messages.length)) return true;
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
      { id: crypto.randomUUID(), role: "assistant", text: rejectAssistantText() },
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
    if (previewing || busy || !aiReady) return;
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
      complete: (request) => completeModelRequest(request, fetch, applyUsageFromBody),
    });
    setBusy(false);
    if (result.kind === "error") {
      const userError = userErrorFromMessage(result.message);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "setup",
          text: formatUserError(userError),
          detail: userError.detail,
        },
      ]);
      setStatus(userError.headline);
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
        <div className="toolbar-primary">
        <div className="brand">
          <img className="brand-icon" src="/icon.svg" alt="" width={22} height={22} />
          Local AI Sheet
        </div>
        <span className={`status-pill ${statusPill.tone}`}>{statusPill.label}</span>
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
        </div>
        <div className="toolbar-ai">
        <label>
          Provider
          <select aria-label="Model provider" value={provider} onChange={(event) => void chooseProvider(event.target.value as ProviderId)}>
            <option value="ollama">Ollama</option>
            <option value="gemini">Gemini</option>
            <option value="groq">Groq</option>
          </select>
        </label>
        <label>
          Model
          <select aria-label="Model" value={selectedModel} onChange={(event) => void chooseModel(event.target.value)}>
            <option value="">
              {visibleModels.length
                ? "Choose…"
                : provider === "ollama"
                  ? "Start Ollama and pull a chat model"
                  : "No models"}
            </option>
            {visibleModels.map((id) => (
              <option key={id} value={id}>{modelOptionLabel(id)}</option>
            ))}
          </select>
        </label>
        <details className="toolbar-advanced">
          <summary>Advanced</summary>
          <div className="toolbar-advanced-body">
            {modelOptions.length > listCuratedModels(modelOptions, provider as ModelProviderId).length && (
              <label className="toggle-inline">
                <input
                  type="checkbox"
                  checked={showAllModels}
                  onChange={(event) => setShowAllModels(event.target.checked)}
                />
                Show all models (not recommended)
              </label>
            )}
            {provider !== "ollama" && (
              <>
                <label>
                  API key
                  <input
                    type="password"
                    aria-label="API key"
                    value={apiKeyDraft}
                    placeholder={keyConfigured && keyHint ? `Saved ····${keyHint}` : "Paste API key"}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setApiKeyDraft(event.target.value)}
                  />
                </label>
                <button type="button" onClick={() => void saveKey()} disabled={!apiKeyDraft.trim()}>Save key</button>
                {usageNote && (
                  <span className="usage-note toolbar-usage" title="From provider rate-limit headers on the latest API call">
                    {usageNote}
                  </span>
                )}
              </>
            )}
          </div>
        </details>
        </div>
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
          aiReady={aiReady}
          setupIssues={setupIssues}
          checkingSetup={checkingSetup}
          summaries={summaries}
          warning={previewWarning}
          status={status}
          modelNote={modelNote}
          onSend={(prompt) => void sendPrompt(prompt)}
          onRetrySetup={() => {
            void (async () => {
              await loadProvider();
            })();
          }}
          onSample={previewSample}
          onAccept={acceptPreview}
          onReject={rejectPreview}
        />
      </div>
    </div>
  );
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
