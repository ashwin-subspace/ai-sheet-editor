# Local AI Spreadsheet Workspace

## Overview

A desktop spreadsheet application that combines an Excel-like editor with an AI assistant. Think of it as **Cursor for spreadsheets**: users describe what they want in plain language, and the AI creates or edits the actual workbook while they watch.

The interface places an editable spreadsheet on the left and an AI chat panel on the right. Users can work manually, ask the AI for help, or combine both approaches.

## The problem it solves

Creating spreadsheets often requires repetitive setup, formula writing, formatting, and manual adjustments. This software aims to make those tasks conversational.

Instead of receiving instructions from a separate chatbot and copying them into a spreadsheet, users can ask the AI to make changes directly inside their workspace.

## How it works

1. Create a new workbook or open an existing `.xlsx` file.
2. Describe a task in the AI sidebar.
3. The AI proposes changes to cells, formulas, formatting, or sheet structure.
4. Review the changes and accept or reject them.
5. Continue editing manually or through follow-up prompts.
6. Save the workbook to a chosen folder.
7. Reopen the saved file in this app or a compatible spreadsheet application, with the supported changes preserved.

### Example

A user asks:

> “Create a monthly expense tracker with categories, budget, actual spending, and totals.”

The AI proposes a table, headers, basic formulas, and formatting.

The user then selects part of the sheet and asks:

> “Add a savings column and highlight expenses that exceed the budget.”

The application previews the proposed edits before applying them.

## Main features

### Spreadsheet workspace

- Editable cells, rows, and columns.
- Formula bar and worksheet tabs.
- Basic formulas and formatting.
- Workbook import, save, and export.
- Undo and redo.

### AI assistant

- Create spreadsheet structures from prompts.
- Modify selected cells or ranges.
- Suggest and explain formulas.
- Apply formatting through natural-language instructions.
- Answer questions using relevant workbook data.

### User control

- Preview AI-generated changes.
- Accept or reject proposed edits.
- Undo applied changes.
- Keep backups before overwriting existing files.

## Local-first AI

The proposed application uses a downloaded model running through LM Studio rather than requiring a cloud AI service.

```text
User prompt + relevant workbook context
                    ↓
          Local AI through LM Studio
                    ↓
        Structured spreadsheet operations
                    ↓
          Validation and change preview
                    ↓
          User approval → Workbook update
                    ↓
              Save as an .xlsx file
```

The goal is for the finished application to work offline after the model and required software are installed. AI chat history would be stored separately from the workbook, keeping the exported spreadsheet usable independently.

## Initial version

The first version would focus on:

- One editable worksheet.
- An AI chat sidebar.
- Prompt-based table creation.
- Selected-range editing.
- Basic formulas and formatting.
- Change preview, approval, and undo.
- Local workbook save and reopen.
- Basic `.xlsx` import and export.

Charts, advanced analysis, multiple-sheet automation, and broader Excel compatibility would come later. The initial goal is not to reproduce every Excel feature, but to deliver a reliable conversational spreadsheet workflow.

## Proposed implementation

- Development assistance: Cursor.
- Desktop application: Electron.
- Interface: React and TypeScript.
- AI runtime: LM Studio with a compatible local model.
- Application logic: a local backend that validates AI-proposed operations.
- File handling: a spreadsheet library selected for its features and licensing.

## Short pitch

> We’re building a local-first AI spreadsheet editor—like Cursor, but for spreadsheets. Users work with an editable sheet on the left and an AI assistant on the right. They can describe what they want, review proposed changes, and save the result as a real Excel workbook. The aim is to make spreadsheet creation and editing conversational while keeping users in control and supporting offline AI.
