## Summary

- What changed?
- Why is this change needed?

## Related issue

Closes #

## Validation

Run the full local gate before opening the PR (one command):

```bash
npm run preflight   # format:check vs origin/main + lint + typecheck + npm test
```

- [ ] `npm run preflight` passes locally
- [ ] New or changed behavior is covered by a test that **fails without the change**

List any checks not run and explain why:

## High-risk areas (check every one your diff touches)

- [ ] **Updater / installer** (`tools/hermesoffice-update.mjs`, `apps/shell/src/main/*updater*`): `node --check` passes; the swap remains atomic (verify → copy aside → rename swap → rollback) and never runs with the app alive. Describe the manual dry-run you did.
- [ ] **i18n strings**: every new key was added to **all 19 locales** in the touched dictionary (a missing key crashes rendering of that string).
- [ ] **IPC / preload surface**: channel names, types (`shared/ipc.ts` / `home-api.ts`) and preload bridges updated together; input from the renderer is validated in the main process.
- [ ] **File open/save (engines)**: includes a round-trip or fidelity test — untouched content must survive byte-for-byte.
- [ ] **AI tools** (`*-skill.ts`, `ai/tools.ts`): tool schemas valid, validation happens before any IPC, mutating tools report `mutated: true`, and the app's contract test suite covers the new tool.
- [ ] **Renderer flows** (home/onboarding/panels): relevant Playwright spec in `e2e/` updated or added, and it passes locally where runnable.

## Screenshots or recordings

Include before/after evidence for visible changes, or write "Not applicable."

## Contributor checklist

- [ ] The change is focused and does not include unrelated reformatting or refactoring.
- [ ] User-facing strings use the existing i18n resources.
- [ ] No tool/check was weakened to make the gate pass (skipped tests, loosened types, disabled lint rules) — if one had to be, it is called out in the Summary with the reason.
