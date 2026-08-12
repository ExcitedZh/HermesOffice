/**
 * HermesOffice — fork de HermesOffice (genspark-ai/hermesoffice, Apache-2.0,
 * Copyright 2026 Mainfunc, Inc.). Modificações do fork por criptogus;
 * atribuição original preservada em NOTICE.
 */
import type { AgentMessage, AgentToolCall, AgentToolDef } from '@hermesoffice/agent-core'

export type AiProviderId =
  'hermes' | 'genspark' | 'anthropic' | 'gemini' | 'deepseek' | 'openai' | 'custom'

/** upstream account status (gsk login state; the sole auth source for AI features) */
export interface GenSparkAccountStatus {
  loggedIn: boolean
  email?: string
}

/** fork compat alias — the fork's own consumers use the old name */
export type GatewayAccountStatus = GenSparkAccountStatus

export interface AiProviderConfig {
  apiKey: string
  model: string
  maxTokens?: number
  timeoutMs?: number
  /** only used by the custom provider */
  baseUrl?: string | undefined
  /** optional protocol override for custom provider (defaults to 'openai') */
  protocol?: 'openai' | 'gemini' | 'anthropic'
}

export interface AiProviderMeta {
  id: AiProviderId
  label: string
  models: string[]
  defaultModel: string
  keyPlaceholder: string
  needsBaseUrl?: boolean
  /** default baseUrl when needsBaseUrl (e.g. the local Hermes gateway) */
  defaultBaseUrl?: string
}

export interface AiSettings {
  provider: AiProviderId
  providers: Record<AiProviderId, AiProviderConfig>
}

/** pre-provider settings shape (single OpenAI-compatible endpoint); migrated into "custom" */
export interface LegacyAiSettings {
  baseUrl?: string
  apiKey?: string
  model?: string
}

export interface AiChatRequest {
  settings: AiSettings
  system: string
  user: string
}

export interface AiChatResponse {
  ok: boolean
  content?: string
  error?: string
}

export interface AiStreamRequest {
  requestId: string
  settings: AiSettings
  system: string
  messages: AgentMessage[]
  tools?: AgentToolDef[]
  maxTokens?: number
  /** stable per-document conversation id; sent as X-Hermes-Session-Id for gateway session continuity */
  sessionId?: string
}

export interface AiStreamChunk {
  requestId: string
  /** 'ping' = wire-level keepalive so the renderer can tell a live stream from a dead one */
  type: 'delta' | 'tool-call' | 'done' | 'error' | 'ping'
  text?: string
  /** complete parsed tool call (emitted once its arguments finish streaming) */
  toolCall?: AgentToolCall
  error?: string
  /** machine-readable error cause ('timeout', exhausted 'credits'); lets the renderer localize the message */
  errorCode?: 'timeout' | 'credits'
  /** normalized stop reason carried on 'done' ('max_tokens' = output cut off by the token limit) */
  stopReason?: string
}
