interface FormulaBarProps {
  name: string;
  value: string;
  locked: boolean;
  onChange: (value: string) => void;
  onCommit: () => void;
  onMove: () => void;
}

export function FormulaBar({ name, value, locked, onChange, onCommit, onMove }: FormulaBarProps) {
  return (
    <div className="formula-bar">
      <div className="name-box" aria-label="Selection">{name}</div>
      <label className="fx">
        <span>fx</span>
        <input
          value={value}
          disabled={locked}
          aria-label="Formula bar"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onCommit();
              onMove();
            }
            if (event.key === "Escape") {
              (event.target as HTMLInputElement).blur();
            }
          }}
          onBlur={onCommit}
        />
      </label>
    </div>
  );
}
