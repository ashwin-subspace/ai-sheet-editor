import { useState } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "error";
  text: string;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  busy: boolean;
  previewing: boolean;
  summaries: string[];
  warning?: string;
  status: string;
  onSend: (prompt: string) => void;
  onSample: () => void;
  onAccept: () => void;
  onReject: () => void;
}

export function ChatPanel({
  messages,
  busy,
  previewing,
  summaries,
  warning,
  status,
  onSend,
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
      <div className="chat-log" aria-live="polite">
        {messages.length === 0 && (
          <p className="hint">Ask for a table, a formula, or an explanation. Edits stay in preview until you accept them.</p>
        )}
        {messages.map((message) => (
          <article key={message.id} className={`bubble ${message.role}`}>{message.text}</article>
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
          placeholder={previewing ? "Accept or reject the preview first." : "Describe a change, or ask about the sheet."}
          disabled={previewing || busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit" disabled={previewing || busy || !draft.trim()}>Send</button>
      </form>
    </aside>
  );
}
