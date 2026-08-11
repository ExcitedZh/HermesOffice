# RFC 0008 — Unified Proposed Change Contract

Status: accepted for implementation seed
Owner: HermesOffice PM/agent platform
Scope: Docs, Sheets, Slides, PDF, embedded MCP tools, Hermes AI panel

## Goal

Every agent-driven mutation must be represented as a visible, reversible, auditable proposal before any document bytes are changed. This makes the Sheets `propose_operations` flow the product-wide trust model instead of an app-specific exception.

## Non-goals

- Runtime plugin marketplace work is intentionally out of scope.
- This RFC does not define app-specific engine payload schemas; engines still own validation.
- This RFC does not require realtime multiplayer collaboration.

## Lifecycle

A `ProposedChangeRecord` moves through these states:

1. `draft` — an agent or tool is still preparing the change.
2. `proposed` — the user can review scope, preview/diff, risks, and rationale.
3. `accepted` — a human or policy gate approved applying the operations.
4. `rejected` — the proposal was declined and must not mutate the document.
5. `applied` — the app engine applied the approved operations atomically.
6. `reverted` — the app reverted an applied proposal through undo/rollback.

## Required approval surface

Approval UI and MCP hosts must expose:

- title and summary;
- actor identity (`agent`, `human`, or `system`);
- affected scopes (block, range, slide, page, etc.);
- compact preview/diff where available;
- risk notes;
- accept/reject affordances;
- status and timestamp history.

## Storage

`@hermesoffice/project-store` persists compact proposal audit records in `projects/<project-id>/proposals/<proposal-id>.json`. Full app-specific previews stay in the app layer if they are large; the store keeps only compact/redacted preview text and validated metadata.

## MCP gate

External MCP tools must not call engine mutation APIs directly by default. They should:

1. read document context;
2. create a `ProposedChangeRecord` with app-scoped operations;
3. wait for status to become `accepted`;
4. ask the owning app to apply the accepted operation atomically;
5. update the proposal to `applied` or leave it reviewable if application fails.

Headless policies may auto-accept low-risk changes only when explicitly configured by the user or administrator.
