#!/usr/bin/env node
/**
 * Spike #39 — minimal embedded MCP server for a real .docx
 * =========================================================
 * Question: are the docs AI-panel tools (read_blocks / replace_blocks)
 * reusable as-is behind an MCP transport, or do they require a
 * session-scoped redesign (ProseMirror editor context)?
 *
 * This server is deliberately transport-only: MCP stdio (JSON-RPC 2.0 over
 * stdin/stdout, hand-rolled — no @modelcontextprotocol/sdk dependency) and a
 * REQUEST-SCOPED backend: every tool call parses the .docx fresh with the
 * docx-engine (parseDocx → Block[]), operates on the block tree, and writes
 * back with saveDocx (byte-preserving). No editor, no renderer, no session.
 *
 * Tools exposed:
 *   read_blocks    — read the block tree of the docx (index|type|content)
 *   replace_blocks — replace a block range; runs through a ProposedChange
 *                    record (RFC 0008) with a stub auto-approve policy and an
 *                    audit log; the docx round-trip must stay byte-preserving
 *
 * Usage:
 *   DOCX_PATH=/path/to/file.docx node server.mjs
 * (talk to it over stdio: initialize → tools/list → tools/call)
 */
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { parseDocx, saveDocx } from '@hermesoffice/docx-engine'

const DOCX_PATH = process.env.DOCX_PATH
const AUDIT_DIR = process.env.AUDIT_DIR || join(homedir(), '.hermesoffice-spike39-audit')

if (!DOCX_PATH) {
  console.error('DOCX_PATH env var required')
  process.exit(1)
}

// ── ProposedChange audit (RFC 0008, stub policy) ────────────────────────────
// The real implementation persists via @hermesoffice/project-store
// (projects/<id>/proposals/<id>.json). The spike writes the same shape to a
// flat audit dir so the record is inspectable without the full store.

function auditRecord(op) {
  const id = `spike39-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const now = new Date().toISOString()
  return {
    id,
    projectId: 'spike39',
    filePath: DOCX_PATH,
    app: 'docs',
    status: 'applied', // stub policy: auto-approve low-risk, audit logged
    title: op.title,
    summary: op.summary,
    actor: { id: 'mcp-external-agent', name: 'external MCP client', kind: 'agent' },
    createdAt: now,
    updatedAt: now,
    operations: [
      {
        id: `${id}-op1`,
        type: op.type,
        summary: op.summary,
        scope: {
          kind: 'range',
          ref: `${op.startBlockIndex}..${op.endBlockIndex}`,
          label: `blocks ${op.startBlockIndex}-${op.endBlockIndex}`,
        },
        payload: op.payload,
      },
    ],
    risks: [{ level: 'low', message: 'spike stub policy: auto-approved' }],
  }
}

async function writeAudit(record) {
  mkdirSync(AUDIT_DIR, { recursive: true })
  const p = join(AUDIT_DIR, `${record.id}.json`)
  await writeFile(p, JSON.stringify(record, null, 2))
  return p
}

// ── docx-engine backend (request-scoped) ────────────────────────────────────

async function loadParsed() {
  const bytes = await readFile(DOCX_PATH)
  const parsed = await parseDocx(new Uint8Array(bytes))
  return { bytes, parsed }
}

function blockText(b) {
  if (b.type === 'paragraph' || b.type === 'heading' || b.type === 'listItem') {
    return (b.runs || []).map((r) => r.text).join('')
  }
  return b.previewText || b.label || `[${b.type}]`
}

function blockLine(b, i) {
  const prefix = b.type === 'heading' ? `h${b.level || 1}` : b.type
  const content = blockText(b).slice(0, 200).replace(/\n/g, '⏎')
  return `${i}\t${prefix}\t${content}`
}

function readBlocks(startBlockIndex, endBlockIndex) {
  return {
    output: (async () => {
      const { parsed } = await loadParsed()
      const blocks = parsed.blocks.filter((b) => !b.hidden)
      const s = Number(startBlockIndex) || 0
      const e =
        endBlockIndex === undefined || endBlockIndex === null
          ? blocks.length - 1
          : Number(endBlockIndex)
      if (s < 0 || e < s || e >= blocks.length) {
        return {
          isError: true,
          output: `block index out of range (doc has ${blocks.length} visible blocks)`,
        }
      }
      const lines = blocks.slice(s, e + 1).map(blockLine)
      return { isError: false, output: `visible blocks: ${blocks.length}\n${lines.join('\n')}` }
    })(),
  }
}

/** Build SaveBlock[]: keep every original block, replace the target range
 * with a single generated paragraph carrying the new text. This mirrors what
 * the renderer's replaceBlockRange produces, minus the ProseMirror layer. */
function buildSaveBlocks(parsed, startBlockIndex, endBlockIndex, newText) {
  const visible = parsed.blocks.filter((b) => !b.hidden)
  const blocks = parsed.blocks
  // map visible index → real block
  const target = visible.slice(startBlockIndex, endBlockIndex + 1)
  const targetDocxIndexes = new Set(target.map((b) => b.docxIndex))
  const saveBlocks = []
  for (const b of blocks) {
    if (b.docxIndex !== null && targetDocxIndexes.has(b.docxIndex)) {
      if (b === target[0]) {
        // replace the range with one generated paragraph (keep raw pPr if any)
        const gen = {
          kind: 'generated',
          block: {
            type: 'paragraph',
            runs: [{ text: newText }],
            ...(target[0].rawPPr ? { rawPPr: target[0].rawPPr } : {}),
          },
        }
        saveBlocks.push(gen)
      }
      // remaining blocks in the range are dropped
      continue
    }
    saveBlocks.push({ kind: 'original', docxIndex: b.docxIndex })
  }
  // hidden trailing elements (sectPr etc.) are appended by the engine
  return saveBlocks
}

async function replaceBlocks(startBlockIndex, endBlockIndex, html) {
  const { bytes, parsed } = await loadParsed()
  const before = createHash('sha256').update(bytes).digest('hex')

  const visible = parsed.blocks.filter((b) => !b.hidden)
  const s = Number(startBlockIndex)
  const e = Number(endBlockIndex)
  if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e < s || e >= visible.length) {
    return {
      isError: true,
      output: `block index out of range (doc has ${visible.length} visible blocks)`,
    }
  }

  // RFC 0008 gate: create the proposal record BEFORE mutating bytes
  const record = auditRecord({
    title: `Replace blocks ${s}..${e}`,
    summary: `Replace ${e - s + 1} block(s) with new text`,
    type: 'replace_blocks',
    startBlockIndex: s,
    endBlockIndex: e,
    payload: { html },
  })
  const auditPath = await writeAudit(record)

  const saveBlocks = buildSaveBlocks(parsed, s, e, String(html || ''))
  const out = await saveDocx(parsed, saveBlocks)
  await writeFile(DOCX_PATH, out)

  const after = createHash('sha256').update(out).digest('hex')
  return {
    isError: false,
    output: `replaced blocks ${s}..${e}; docx saved (${out.length} bytes)\naudit: ${auditPath}\nsha256 before: ${before}\nsha256 after:  ${after}\nbyte-preserving: untouched parts only — verify with a re-parse`,
  }
}

// ── MCP stdio transport (JSON-RPC 2.0, hand-rolled) ─────────────────────────

const TOOLS = [
  {
    name: 'read_blocks',
    description:
      'Read the block tree of the .docx (index|type|content preview). Block indexes change after modifications; call again for fresh indexes.',
    inputSchema: {
      type: 'object',
      properties: {
        startBlockIndex: { type: 'integer', description: 'start block index (0-based, inclusive)' },
        endBlockIndex: { type: 'integer', description: 'end block index (inclusive)' },
      },
      required: ['startBlockIndex', 'endBlockIndex'],
    },
  },
  {
    name: 'replace_blocks',
    description:
      'Replace a block range with new text. Runs through the Proposed Change pipeline (RFC 0008) with a stub auto-approve policy; the change is audited and the docx round-trip is byte-preserving.',
    inputSchema: {
      type: 'object',
      properties: {
        startBlockIndex: { type: 'integer', description: 'start block index (0-based, inclusive)' },
        endBlockIndex: { type: 'integer', description: 'end block index (inclusive)' },
        html: { type: 'string', description: 'replacement text (spike: plain text)' },
      },
      required: ['startBlockIndex', 'endBlockIndex', 'html'],
    },
  },
]

async function handleCall(name, args) {
  switch (name) {
    case 'read_blocks': {
      const r = await readBlocks(args.startBlockIndex, args.endBlockIndex).output
      return { content: [{ type: 'text', text: r.output }], isError: !!r.isError }
    }
    case 'replace_blocks': {
      const r = await replaceBlocks(args.startBlockIndex, args.endBlockIndex, args.html)
      return { content: [{ type: 'text', text: r.output }], isError: !!r.isError }
    }
    default:
      return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true }
  }
}

let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', async (chunk) => {
  buf += chunk
  let idx
  while ((idx = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, idx).trim()
    buf = buf.slice(idx + 1)
    if (!line) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    const respond = (result) => {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n')
    }
    const respondError = (code, message) => {
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code, message } }) + '\n',
      )
    }
    if (msg.method === 'initialize') {
      respond({
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'hermesoffice-docx-spike39', version: '0.0.1' },
      })
    } else if (msg.method === 'tools/list') {
      respond({ tools: TOOLS })
    } else if (msg.method === 'tools/call') {
      try {
        const r = await handleCall(msg.params.name, msg.params.arguments || {})
        respond(r)
      } catch (err) {
        respondError(-32603, err instanceof Error ? err.message : String(err))
      }
    } else if (msg.method === 'ping') {
      respond({})
    } else if (msg.method === 'resources/list') {
      respond({ resources: [] })
    } else if (msg.method === 'notifications/initialized') {
      // no-op
    } else {
      respondError(-32601, `method not found: ${msg.method}`)
    }
  }
})
