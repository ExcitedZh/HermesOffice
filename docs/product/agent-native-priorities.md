# Agent-native implementation priorities (P0–P2)

This document turns the product prioritization into safe implementation slices. P3 items such as runtime plugin marketplace and realtime collaboration are intentionally deferred.

## P0 — Trusted Agent Actions

- Use `ProposedChangeRecord` from `@hermesoffice/project-store` as the shared audit envelope for Docs, Sheets, Slides, and PDF.
- Default behavior: proposals are saved first; app engines apply only after approval.
- Sheets remains the gold-standard interaction pattern, but its `propose_operations` flow should eventually emit the same proposal audit record.
- Docs, Slides, and PDF should route all future agent mutations through this proposal lifecycle.

## P1 — Keystone MCP demo

MVP tools for an embedded app-owned MCP server:

- `list_open_documents`
- `read_document_outline`
- `read_blocks` / `read_slide` / `read_range` / `read_page`
- `propose_change`
- `get_proposal_status`
- `apply_approved_change`
- `save_document`

Demo target: an external agent edits a board/QBR deck from workbook data, the user approves the proposal, and the app writes an audit trail.

## P1 — First-run experience

Target activation metric: download to first accepted agent-assisted document change in under 10 minutes.

Recommended funnel checkpoints:

1. app launched;
2. Hermes gateway detected or launched;
3. `/health` succeeds;
4. first template opened;
5. first AI response streamed;
6. first proposal created;
7. first proposal accepted/applied.

## P2 — Project document graph

Use `ProjectDocumentReference` in `@hermesoffice/project-store` for typed edges between artifacts without modifying OOXML/PDF bytes. Initial relations cover decks derived from workbooks, docs summarizing transcripts, exports, references, and meeting-minutes artifacts.

## P2 — Meeting minutes MVP

Start with transcript import before live capture:

1. import `.txt` or `.vtt` transcript;
2. generate a structured `.docx` minutes draft;
3. emit changes through the proposal pipeline;
4. record a `meeting-minutes-for` document graph edge;
5. add live audio/STT only after the proposal flow is stable.
