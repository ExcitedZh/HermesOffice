#!/usr/bin/env node
/**
 * Spike #39 — MCP client harness.
 * Spawns server.mjs over stdio and drives the MCP handshake like an external
 * agent (Hermes CLI / Claude Code) would: initialize → tools/list →
 * read_blocks → replace_blocks → read_blocks again (verify the edit landed).
 *
 * Usage:
 *   node client.mjs /path/to/file.docx [--skip-replace]
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const docxPath = process.argv[2]
const skipReplace = process.argv.includes('--skip-replace')

if (!docxPath) {
  console.error('usage: node client.mjs /path/to/file.docx [--skip-replace]')
  process.exit(1)
}

// the workspace packages export TS source ("./src/index.ts"), so the server
// must run through tsx like the rest of the repo tooling
const tsxBin = join(here, '..', '..', 'node_modules', '.bin', 'tsx')
const server = spawn(tsxBin, [join(here, 'server.mjs')], {
  env: { ...process.env, DOCX_PATH: docxPath },
  stdio: ['pipe', 'pipe', 'inherit'],
})

let nextId = 0
const pending = new Map()
let buf = ''

server.stdout.setEncoding('utf8')
server.stdout.on('data', (chunk) => {
  buf += chunk
  let idx
  while ((idx = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, idx).trim()
    buf = buf.slice(idx + 1)
    if (!line) continue
    const msg = JSON.parse(line)
    if (msg.id && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id)
      pending.delete(msg.id)
      resolve(msg)
    }
  }
})

function call(method, params = {}) {
  const id = ++nextId
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  return new Promise((resolve) => pending.set(id, { resolve }))
}

function textOf(result) {
  return (result.content || []).map((c) => c.text).join('\n')
}

async function main() {
  const before = createHash('sha256')
    .update(await readFile(docxPath))
    .digest('hex')
  console.log(`\n=== target: ${docxPath}`)
  console.log(`sha256 before: ${before}\n`)

  const init = await call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'spike39-client', version: '0.0.1' },
  })
  console.log(
    `[initialize] server: ${init.result?.serverInfo?.name} v${init.result?.serverInfo?.version}`,
  )

  const tools = await call('tools/list')
  console.log(`[tools/list] ${tools.result?.tools?.map((t) => t.name).join(', ')}`)

  const read1 = await call('tools/call', {
    name: 'read_blocks',
    arguments: { startBlockIndex: 0, endBlockIndex: 4 },
  })
  console.log(`\n[read_blocks 0..4]\n${textOf(read1.result)}`)

  if (!skipReplace) {
    const rep = await call('tools/call', {
      name: 'replace_blocks',
      arguments: {
        startBlockIndex: 0,
        endBlockIndex: 0,
        html: 'Spike 39 MCP edit: this paragraph was replaced by an external agent via MCP.',
      },
    })
    console.log(`\n[replace_blocks 0..0]\n${textOf(rep.result)}`)

    const read2 = await call('tools/call', {
      name: 'read_blocks',
      arguments: { startBlockIndex: 0, endBlockIndex: 2 },
    })
    console.log(`\n[read_blocks 0..2 after replace]\n${textOf(read2.result)}`)

    const after = createHash('sha256')
      .update(await readFile(docxPath))
      .digest('hex')
    console.log(`\nsha256 after:  ${after}`)
    console.log(`changed: ${before !== after}`)
  }

  server.kill()
}

main().catch((err) => {
  console.error(err)
  server.kill()
  process.exit(1)
})
