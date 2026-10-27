import { useEffect, useRef } from "react";
import { formatAddress, indexToCol, normalizeSelection, parseAddress } from "../engine/address";
import type { EvalCache } from "../engine/formula";
import { COL_COUNT, ROW_COUNT, type Workbook } from "../engine/types";
import { cellView } from "../engine/workbook";

interface GridProps {
  workbook: Workbook;
  cache: EvalCache;
  selection: { anchor: string; end: string };
  changed: Set<string>;
  changedColumns: Set<string>;
  onSelect: (anchor: string, end: string) => void;
}

export function Grid({ workbook, cache, selection, changed, changedColumns, onSelect }: GridProps) {
  const dragging = useRef(false);
  const anchor = useRef(selection.anchor);
  const range = normalizeSelection(selection.anchor, selection.end);
  const rows = Array.from({ length: ROW_COUNT }, (_, index) => index + 1);
  const cols = Array.from({ length: COL_COUNT }, (_, index) => index + 1);

  useEffect(() => {
    const stop = () => {
      dragging.current = false;
    };
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  return (
    <div
      className="grid-scroll"
      onMouseLeave={() => {
        dragging.current = false;
      }}
      onMouseUp={() => {
        dragging.current = false;
      }}
    >
      <table className="grid">
        <colgroup>
          <col className="row-head-col" />
          {cols.map((col) => {
            const letter = indexToCol(col);
            const width = workbook.columnWidths[letter];
            return <col key={letter} style={{ width: width ? `${Math.max(24, Math.round(width * 8))}px` : undefined }} />;
          })}
        </colgroup>
        <thead>
          <tr>
            <th />
            {cols.map((col) => {
              const letter = indexToCol(col);
              return (
                <th key={letter} className={changedColumns.has(letter) ? "changed-col" : undefined}>{letter}</th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              <th>{row}</th>
              {cols.map((col) => {
                const address = formatAddress(col, row);
                const view = cellView(workbook, address, cache);
                const active = address === selection.anchor;
                const inside = range
                  ? col >= range.c1 && col <= range.c2 && row >= range.r1 && row <= range.r2
                  : false;
                const className = [
                  active ? "active" : "",
                  inside && !active ? "in-range" : "",
                  changed.has(address) ? "changed" : "",
                  view.error ? "error" : "",
                  view.unsupported ? "unsupported" : "",
                ].filter(Boolean).join(" ");
                return (
                  <td
                    key={address}
                    className={className}
                    style={{
                      fontWeight: view.bold ? 700 : 400,
                      background: view.fill ?? undefined,
                    }}
                    title={view.unsupported ? "Not calculated here. Excel will calculate this formula." : view.bar && view.bar !== view.text ? view.bar : undefined}
                    onMouseDown={(event) => {
                      if (event.button !== 0) return;
                      const pos = parseAddress(address);
                      if (!pos) return;
                      dragging.current = true;
                      if (event.shiftKey) {
                        onSelect(selection.anchor, address);
                        anchor.current = selection.anchor;
                      } else {
                        anchor.current = address;
                        onSelect(address, address);
                      }
                    }}
                    onMouseEnter={(event) => {
                      if (!dragging.current || event.buttons === 0) {
                        dragging.current = false;
                        return;
                      }
                      onSelect(anchor.current, address);
                    }}
                  >
                    {view.text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
