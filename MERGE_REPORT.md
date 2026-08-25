# HermesOffice 分支合并对比分析报告

> 日期：2026-08-15
> 目标：将 `custom-llm` 分支的本地定制功能移植到基于 `main` 的 `merge-main` 分支
> 策略：以 main 为基线，本地定制逐条分析、逐条确认后移植

## 0. 背景与分支关系

- **`origin/main`**：项目主线，包含大量新功能（Markdown 应用、PDF 编辑、Sheets/Slides 增强、主题系统、docx-engine 修复等），相对本地有 **424 个文件、约 6 万行**新增。
- **`custom-llm`**：孤儿分支（无共同祖先），改动集中在 **AI Provider 相关**约 14 个文件、约 100 行。核心价值是「自定义 LLM Provider」能力。
- **`merge-main`**：基于 `origin/main` 新建的工作分支（当前所在，本报告的操作目标）。
- **备份**：`custom-llm` 原分支、`backup-custom-llm` 分支、`stash@{0}`（未提交的 Serper 改动）均已保留。

> ⚠️ 重要：由于两个分支无共同祖先，直接 `git merge` 会对 1226 个同名文件产生海量冲突，不可行。采用「以 main 为基线 + 手动移植本地定制」的方式。

---

## 1. 本地独有、需要决策的定制改动

### 1.1 AI Provider 核心（custom-llm 独有，main 无此功能）

**文件：`packages/ai-provider/src/types.ts`**

custom-llm 在 `AiProviderConfig` 中新增了 3 个字段：

```ts
export interface AiProviderConfig {
  apiKey: string
  model: string
  maxTokens?: number          // ← 新增
  timeoutMs?: number          // ← 新增
  baseUrl?: string | undefined
  protocol?: 'openai' | 'gemini' | 'anthropic'   // ← 新增
}
```

main 现状：只有 `apiKey / model / baseUrl`。

**文件：`packages/ai-provider/src/stream.ts`**

custom-llm 的改动：
1. `streamAnthropic` / `streamGemini` / `streamOpenAiCompatible` 中读取 `config.timeoutMs` 覆盖默认超时。
2. `streamForProvider` 的 `custom` case 中，按 `config.protocol` 路由到原生 `streamAnthropic` / `streamGemini`（而不只是 OpenAI 兼容）。

main 现状：
- `createStreamWatchdog(cb.signal)` 用全局常量（签名已兼容，移植无技术障碍）。
- `custom` case 只走 `streamOpenAiCompatible`。

**文件：`packages/ai-provider/src/watchdog.ts`**

两组超时值：
| 常量 | custom-llm | main |
|------|-----------|------|
| `AI_CONNECT_TIMEOUT_MS` | 120s | 60s |
| `AI_IDLE_TIMEOUT_MS` | 600s | 180s |
| `AI_CHAT_RESPONSE_TIMEOUT_MS` | 600s | 180s |

> ✅ **已确认：采用 main 的 60s/180s/180s**（main 注释说明 60s idle 曾误杀真实生成，已达 180s，更稳妥）。

---

### 1.2 各 app 的 AI 设置读取逻辑（Provider 决策）

**文件：`apps/docs/src/main/docs-main.ts`、`apps/pdf/src/main/ai-ipc.ts`、`apps/sheets/src/main/sheets-main.ts`、`apps/slides/src/main/ai-ipc.ts`**

custom-llm 的改动（4 个文件相似）：
1. `ai:get-settings`：设置文件不存在时**自动生成默认配置文件写入磁盘**（`defaultAiSettings()`）。
2. provider 从**存储的配置**决定：`if (stored.provider && stored.provider !== 'genspark') settings.provider = stored.provider`，而非 main 的强制 `'hermes'`。
3. `ai:stream`：重新从磁盘读设置，`maxTokens` 优先取 `config?.maxTokens ?? request.maxTokens ?? 8192`。

main 现状：强制 `settings.provider = 'hermes'`（AI 全部走 Hermes 网关），设置文件不存在时用内存默认值不落盘。

> ⚠️ 这是**核心架构分歧点**。custom-llm 想支持任意自定义 Provider；main 强制走 Hermes 网关（安全/统一设计）。强行移植会破坏 main 的架构意图。

---

### 1.3 Serper 配置回退（本地未提交改动，已 stash）

**文件：`packages/ai-search/src/index.ts`**

`SERPER_KEY()` 从只读环境变量，改为：环境变量优先，缺失时读取 `~/.hermesoffice/serper.json`（`{"api_key": ...}`）。让打包应用（无终端环境变量）也能读取 Serper key。

main 现状：只读 `process.env.SERPER_API_KEY`。**main 无此功能，本地独有，建议移植。**

---

## 2. main 的新功能（应保留 main，不移植本地对应改动）

以下改动全是 main 的前进，custom-llm 里是旧版/退化，**一律采用 main**：

| 模块 | main 新增/改进 |
|------|---------------|
| apps/docs | `configuredDefaultSaveDir`（可配置默认保存目录）、`toggleDevToolsItem`、View 菜单 AI 侧栏/暗色模式状态跟踪、testExportDir PDF 导出逃逸 |
| apps/pdf | `linkifyPaths` 链接、Hermes 品牌、`preset` 一键 AI 操作、回滚快照、字体子集化/文本编辑/图片编辑、`maxTurns` |
| apps/slides | `maxTurns: 24`、`replace-picture-url`、裁剪/拼写/透明度图标 |
| apps/sheets | `client.open(path, getUiLang())`、sheet 操作 `before` 字段、`configuredDefaultSaveDir` |
| packages/ai-provider | 超时 60s/180s/180s（确认采用） |
| CI | main 已有完整 Windows/多平台工作流，**不重复添加** custom-llm 的 build-windows.yml |

---

## 3. 拟执行的移植方案（待确认）

### 方案 A（推荐）：只移植核心 AI 定制，保留 main 架构
1. `types.ts`：`AiProviderConfig` 增加 `maxTokens?`、`timeoutMs?`（**不含** `protocol`，避免改变 main 的 custom=OpenAI 兼容语义；如需可后续单独讨论）。
2. `stream.ts`：`streamAnthropic/Gemini/OpenAiCompatible` 支持 `config.timeoutMs` 覆盖。
3. `watchdog.ts`：**不改**（采用 main 的 60s/180s/180s）。
4. `packages/ai-search/src/index.ts`：移植 Serper 配置回退（从 stash 取出）。
5. 各 app 的 provider 决策 / 设置文件自动生成：**不移植**（保留 main 强制 Hermes 架构），除非你明确要求改变。

### 方案 B：完整移植本地 AI Provider
在方案 A 基础上，额外把「provider 从存储配置读取、设置文件自动生成、`protocol` 覆盖」也移植。会改动 main 的强制 Hermes 架构，风险更高。

---

## 4. 拟执行操作流程（在 merge-main 分支）

1. 应用方案 A 的文件级改动（types.ts / stream.ts / ai-search index.ts）。
2. 从 `stash@{0}` 恢复 Serper 改动（或手动重做）。
3. 执行类型检查 / 构建验证。
4. 提交到 `merge-main` 分支。
5. `custom-llm`、`backup-custom-llm`、stash 均保留，供回退。

---

## 5. 决策点

- [ ] Q1：`AiProviderConfig` 是否增加 `maxTokens?` / `timeoutMs?`？（推荐：是）
- [ ] Q2：是否增加 `protocol?` 字段（custom 可选走 anthropic/gemini 原生协议）？（推荐：否，保持 main 语义；如需再议）
- [ ] Q3：是否移植「provider 从存储配置读取 + 设置文件自动生成」？（推荐：否，保留 main 强制 Hermes；如需再议）
- [ ] Q4：Serper 配置回退是否移植？（推荐：是）