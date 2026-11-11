import { useState } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "error" | "setup";
  text: string;
  detail?: string;
}

export interface SetupIssue {
  title: string;
  fix: string;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  busy: boolean;
  previewing: boolean;
  aiReady: boolean;
  setupIssues: SetupIssue[];
  checkingSetup: boolean;
  summaries: string[];
  warning?: string;
  status: string;
  modelNote: string;
  usageNote?: string;
  onSend: (prompt: string) => void;
  onRetrySetup: () => void;
  onSample: () => void;
  onAccept: () => void;
  onReject: () => void;
}

export function ChatPanel({
  messages,
  busy,
  previewing,
  aiReady,
  setupIssues,
  checkingSetup,
  summaries,
  warning,
  status,
  modelNote,
  usageNote,
  onSend,
  onRetrySetup,
  onSample,
  onAccept,
  onReject,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");

  return (
    <aside className="chat">
      <div className="chat-head">
        <h2>Assistant</h2>
        <button type="button" onClick={onSample} disabled={previewing || busy}>Preview sample edit</button>
      </div>
      {modelNote && <p className="model-note">{modelNote}</p>}
      {!aiReady && setupIssues.length > 0 && (
        <div className="setup-strip" aria-live="polite">
          {setupIssues.map((issue) => (
            <div key={issue.title} className="setup-issue">
              <strong>{issue.title}</strong>
              <p>{issue.fix}</p>
            </div>
          ))}
          <button type="button" onClick={onRetrySetup} disabled={checkingSetup}>
            {checkingSetup ? "Checking…" : "Retry setup"}
          </button>
        </div>
      )}
      <div className="chat-log" aria-live="polite">
        {messages.length === 0 && (
          <p className="hint">
            {aiReady
              ? "Try: build a small table, format a range, add a formula, or ask about the selection. Edits stay in preview until you accept."
              : "Assistant starts after setup checks pass. You can still edit cells and preview the sample edit."}
          </p>
        )}
        {messages.map((message) => (
          <article
            key={message.id}
            className={`bubble ${message.role}`}
            title={message.detail}
          >
            {message.text}
            {message.detail && (
              <details className="error-detail">
                <summary>Details</summary>
                <pre>{message.detail}</pre>
              </details>
            )}
          </article>
        ))}
        {previewing && (
          <div className="preview-card">
            <strong>Preview</strong>
            {summaries.map((summary) => <p key={summary}>{summary}</p>)}
            {warning && <p className="warn">{warning}</p>}
            <div className="preview-actions">
              <button type="button" className="accept" onClick={onAccept}>Accept</button>
              <button type="button" className="reject" onClick={onReject}>Reject</button>
            </div>
          </div>
        )}
      </div>
      <p className="status-line">{busy ? "Waiting for the local model…" : status}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const prompt = draft.trim();
          if (!prompt || previewing || busy) return;
          setDraft("");
          onSend(prompt);
        }}
      >
        <textarea
          value={draft}
          placeholder={
            previewing
              ? "Accept or reject the preview first."
              : aiReady
                ? "Describe a change, or ask about the sheet."
                : "Assistant starts after setup checks…"
          }
          disabled={previewing || busy || !aiReady}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit" disabled={previewing || busy || !aiReady || !draft.trim()}>Send</button>
      </form>
    </aside>
  );
}
