import type { Editor } from '@tiptap/core'
import type { AgentSkill } from '@hermesoffice/agent-core'
import { AGENT_SYSTEM_PROMPT, buildDocContext, type AiTrack, type NumIds } from './protocol'
import { AGENT_TOOLS, executeTool, markDocSeen } from './tools'

/**
 * The docx capability as an AgentSkill: document skeleton context, the five
 * document tools, and the local executor. Future apps register their own
 * skills (Excel / PPT) against the same agent loop.
 */
export function createDocsSkill(
  getEditor: () => Editor,
  getNumIds: () => NumIds,
  getTrack?: () => AiTrack | undefined,
  // Fork: caminho do arquivo aberto — permite ao agente editar o arquivo no
  // disco via MCP (genoffice_docx_patch) e o app recarregar sozinho
  getFilePath?: () => string,
): AgentSkill {
  return {
    id: 'docx',
    systemPrompt: AGENT_SYSTEM_PROMPT,
    tools: AGENT_TOOLS,
    buildContext: () => {
      const editor = getEditor()
      markDocSeen(editor) // the context the model receives is the freshness baseline for index-addressed writes
      return buildDocContext(editor, getFilePath?.())
    },
    executeTool: (call, signal) =>
      executeTool(getEditor(), call, getNumIds(), getTrack?.(), signal),
  }
}
