#!/usr/bin/env node
/**
 * Writes apps/shell/build/build-info.json — the commit/version the packaged
 * app was built from. The GitHub-main updater
 * (apps/shell/src/main/main-updater.ts) reads this at runtime and compares
 * it against the head of origin/main to decide whether an update exists —
 * the same "how far behind main am I" model as the Hermes Desktop updater.
 *
 * Invoked by the `dist:mac` / `dist:win` npm scripts in apps/shell BEFORE
 * electron-builder runs, so the file lands in `build/` where
 * electron-builder.cjs picks it up as an extraResource.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outPath = join(root, 'apps', 'shell', 'build', 'build-info.json')

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

const commit = git('rev-parse', 'HEAD')
const date = git('log', '-1', '--format=%cI')
// SemVer from git describe in the fork's own tag namespace (ho-v*). The
// upstream HermesOffice tags (v0.4.110, v0.5.83, ...) are deliberately NOT
// matched — they describe HermesOffice releases, not ours. Exact tag → "0.5.0";
// commits after a tag → "0.5.0-2-gabc1234" (SemVer prerelease form); no tag
// yet → falls back to the package.json version.
const version =
  git('describe', '--tags', '--match', 'ho-v*', '--abbrev=7', '--always').replace(/^ho-v/, '') ||
  JSON.parse(
    await import('node:fs').then((fs) =>
      fs.readFileSync(join(root, 'apps', 'shell', 'package.json'), 'utf8'),
    ),
  ).version

const info = {
  commit: commit || 'unknown',
  shortCommit: commit ? commit.slice(0, 7) : 'unknown',
  date: date || new Date().toISOString(),
  version,
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(info, null, 2) + '\n')
console.log(`[build-info] ${info.shortCommit} (${info.date}) v${info.version} → ${outPath}`)
