#!/usr/bin/env node
/**
 * Debug wrapper: logs every MCP message the client sends, then proxies to
 * server.mjs. Lets us see exactly which methods the Hermes client calls
 * during the add/test handshake.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const tsxBin = join(here, '..', '..', 'node_modules', '.bin', 'tsx')
const child = spawn(tsxBin, [join(here, 'server.mjs')], {
  env: process.env,
  stdio: ['pipe', 'pipe', 'inherit'],
})

process.stdin.setEncoding('utf8')
let buf = ''
process.stdin.on('data', (chunk) => {
  buf += chunk
  let idx
  while ((idx = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, idx)
    buf = buf.slice(idx + 1)
    if (line.trim()) console.error('[CLIENT →]', line.slice(0, 300))
    child.stdin.write(line + '\n')
  }
})
child.stdout.on('data', (d) => process.stdout.write(d))
child.on('exit', () => process.exit(0))
