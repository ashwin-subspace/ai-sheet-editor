# Model scorecard

The scorecard did not run, so the three weakest prompts are not known yet.

LM Studio was not available at http://127.0.0.1:1234 (fetch failed). Load a small model, start the local server, and run `npm run scorecard`.

The app still refuses edits unless the checker accepts them. Prompts 15, 16, 17, and 19 are supposed to leave the sheet unchanged.

## Formula differences to watch

- `COUNT` counts numbers only. Text and blanks are ignored. `AVERAGE` ignores blanks and text. A blank cell used with `+` counts as 0.
- `SUM` of an empty range is 0. `AVERAGE` of an empty range is `#DIV/0!`.
- Inserting a row shifts references at or below that row. A range grows when the insert sits inside it.
- Number formats outside `General`, `0`, `0.00`, `#,##0`, `#,##0.00`, and `0%` are stored and written back, but the grid shows the raw number.
