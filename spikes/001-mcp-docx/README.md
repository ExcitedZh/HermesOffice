# Spike 001 — Minimal embedded MCP server for a real `.docx`

**Issue:** #39 · **Question:** are the docs AI-panel tools (`read_blocks` /
`replace_blocks`) reusable as-is behind an MCP transport, or do they require a
session-scoped redesign (ProseMirror editor context)?

**Bet (from the issue):** the tools already exist and MCP is just transport.
**Risk:** the tools are wired to the in-app chat context (block list embedded
in the first message, per-document session via `X-Hermes-Session-Id`) — a
session-scoped model, not request-scoped. If exposing them requires redesigning
the tool context, the Phase 2 estimate doubles.

## Approach

A **transport-only, request-scoped** server: every tool call parses the `.docx`
fresh with the `docx-engine` (`parseDocx` → `Block[]`), operates on the block
tree, and writes back with `saveDocx` (byte-preserving). No editor, no
renderer, no session, no ProseMirror.

- `server.mjs` — MCP stdio server (JSON-RPC 2.0 hand-rolled, zero external
  dependency beyond the workspace `@hermesoffice/docx-engine`)
- `client.mjs` — MCP client harness (drives initialize → tools/list →
  read_blocks → replace_blocks → read_blocks)
- `debug-wrapper.mjs` — protocol logger used while diagnosing the Hermes CLI
  handshake

Tools exposed:

- `read_blocks(startBlockIndex, endBlockIndex)` — block tree of the docx
  (`index | type | content-preview`), hidden blocks filtered
- `replace_blocks(startBlockIndex, endBlockIndex, html)` — replaces a range
  with a generated paragraph, runs through a **ProposedChange record
  (RFC 0008)** with a stub auto-approve policy, writes an audit log, and saves
  the docx byte-preserving

## Running it

```bash
# standalone harness (spawns the server over stdio, drives the full flow)
cp ../../templates/docs/meeting-notes.docx ./test.docx
node ../../node_modules/.bin/tsx client.mjs "$(pwd)/test.docx"

# as a real Hermes MCP client (config is already saved in ~/.hermes/config.yaml)
hermes mcp test spike39

# a fresh copy per run (the server mutates the file in place)
cp ../../templates/docs/meeting-notes.docx ./test3.docx
hermes mcp test spike39
```

Audit records land in `~/.hermesoffice-spike39-audit/`.

## Results

```
[initialize] server: hermesoffice-docx-spike39 v0.0.1
[tools/list] read_blocks, replace_blocks
[read_blocks 0..4]
visible blocks: 16
0	h1	Meeting Notes — [Topic]
1	paragraph	Template note for AI agents: ...
2	paragraph	Date: [YYYY-MM-DD] ...
3	paragraph	Attendees: [Names] ...
4	h2	Agenda

[replace_blocks 0..0]
replaced blocks 0..0; docx saved (3201 bytes)
audit: ~/.hermesoffice-spike39-audit/spike39-….json
sha256 before: 1808815…
sha256 after:  3223c65…

[read_blocks 0..2 after replace]
0	h1	Spike 39 MCP edit: this paragraph was replaced by an external agent via MCP.
```

Byte-preservation, per zip part (untouched parts must be bit-identical):

```
✓ word/styles.xml IDÊNTICA      ✓ word/theme/theme1.xml IDÊNTICA
✓ word/fontTable.xml IDÊNTICA   ✓ [Content_Types].xml IDÊNTICA
✓ word/settings.xml IDÊNTICA    ✓ _rels/.rels IDÊNTICA
✓ word/document.xml mudou (esperado — the edited part)
```

Edge cases: out-of-range block index → clean error (`block index out of range
(doc has 16 visible blocks)`), no mutation, no audit record.

Real MCP client (Hermes CLI):

```
hermes mcp test spike39
  ✓ Connected (245ms)
  ✓ Tools discovered: 2
    read_blocks      Read the block tree of the .docx …
    replace_blocks   Replace a block range with new text. …
```

## Verdict: VALIDATED

### What worked

- **Transport-only is real.** The engine (`parseDocx` → `Block[]` →
  `saveDocx`) is pure Node and request-scoped by nature. The spike exposed the
  two tools with **zero changes to the engine and zero ProseMirror** — the
  "context redesign" the issue feared was **not** needed at the engine level.
- Byte-preserving round-trip confirmed per zip part: all untouched parts
  bit-identical, only `document.xml` changed.
- The mutation correctly flowed through the RFC 0008 `ProposedChangeRecord`
  shape (status `applied`, actor `agent`, scope, payload) into an audit log —
  the store schema in `@hermesoffice/project-store` already matches.
- `rawPPr` preservation: replacing a `h1` block with a generated paragraph
  kept the heading style (block re-parsed as `h1`) — format fidelity holds.
- Real Hermes MCP client connects and discovers both tools.

### What didn't / constraints

- **The tools are not 1:1 reusable as-is.** `read_blocks`/`replace_blocks` in
  the AI panel operate on the ProseMirror `Editor` (the renderer), not on the
  engine block tree. The spike re-implemented them against `docx-engine`
  directly (~150 lines). The **transport** is reusable; the **tool bodies**
  need a headless twin (engine-backed) — a moderate, bounded cost, NOT a
  redesign of the session model.
- `replace_blocks` in the spike replaces a range with a **single generated
  paragraph of plain text**. The panel tool accepts restricted HTML and
  multiple blocks; multi-block/rich-HTML replacement needs the renderer's
  `parseHtmlFragment` logic ported (or shared) — follow-up work.
- Stub approval policy only (auto-approve, audited). The real approval model
  RFC (issue #38) is still design.
- The local `hermes` CLI binary has an argparse regression (`-z`/positional
  prompt rejected) unrelated to the spike; E2E was proven via `hermes mcp
test` and the harness client instead.

### Surprises

- `hermes mcp add` flag ordering: `--env`/`--connect-timeout` must come
  **before** `--args` (which consumes the rest of argv). Mistakenly placed
  after, they land in the server's `args` and the config is malformed.
- The workspace packages export TS source directly (`"exports": {".":
"./src/index.ts"}`), so any external consumer must run through `tsx` (the
  repo's own tooling does this everywhere).

### Recommendation for the real build (Phase 2 keystone)

1. **Build the headless tool twin as a real package** (e.g.
   `packages/docx-mcp` or a `tools/` module in the docs main process): engine-
   backed `read_blocks`/`replace_blocks` with the RFC 0008 proposal gate and
   `project-store` persistence (not a flat audit dir).
2. **Reuse the real MCP SDK** (`@modelcontextprotocol/sdk`) instead of the
   hand-rolled JSON-RPC loop — the spike proves the protocol fits; the SDK
   removes the edge cases (ping, resources, logging, shutdown).
3. **Share `parseHtmlFragment`** (renderer → engine or a shared package) so
   MCP `replace_blocks` accepts the same restricted HTML as the panel tool.
4. Wire the approval model (issue #38) to the proposal status lifecycle —
   the `draft → proposed → accepted → applied` states already exist in the
   store schema.
5. **Cost estimate for Phase 2 keystone:** the feared "context redesign" is
   NOT needed. The delta is a headless tool twin + MCP SDK wrapper + approval
   policy — roughly **half the originally feared estimate**.

## Files

- `server.mjs` — MCP stdio server (engine-backed, RFC 0008 gate, audit log)
- `client.mjs` — MCP client harness (full flow demo)
- `debug-wrapper.mjs` — protocol logger (diagnostics)
- `test*.docx` — scratch copies of `templates/docs/meeting-notes.docx`
