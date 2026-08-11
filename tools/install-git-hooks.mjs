#!/usr/bin/env node
/**
 * Installs the repository's opt-in git hooks (run: npm run hooks).
 *
 * pre-push runs `npm run preflight` (format:check vs origin/main, lint,
 * typecheck, full unit tests) so a branch that would fail CI never leaves
 * the machine. Opt-in by design — CI remains the source of truth; the hook
 * just moves the failure earlier. Bypass for emergencies: git push --no-verify.
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf8' }).trim()
const hooksDir = join(gitDir, 'hooks')
mkdirSync(hooksDir, { recursive: true })

const PRE_PUSH = `#!/bin/sh
# Installed by \`npm run hooks\` (tools/install-git-hooks.mjs).
# Runs the same gate as CI before anything leaves your machine.
# Bypass in an emergency with: git push --no-verify
echo "[pre-push] npm run preflight (format:check, lint, typecheck, tests)…"
npm run preflight || {
  echo "[pre-push] preflight failed — push aborted. Fix the failures or use --no-verify."
  exit 1
}
`

const target = join(hooksDir, 'pre-push')
if (existsSync(target)) {
  console.log(`overwriting existing hook: ${target}`)
}
writeFileSync(target, PRE_PUSH)
chmodSync(target, 0o755)
console.log('installed pre-push hook →', target)
