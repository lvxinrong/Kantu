import Schema from '@deepseek-ai/schemastery'

export interface Config {
  workspaceRoot?: string
  outputDirectory: string
  discoveryMaxDepth: number
  codebaseMemoryServerName?: string
  indexMode?: 'fast' | 'moderate' | 'full'
  evidenceProvider?: string
  systemConcurrency?: number
  registerCommand: boolean
  registerSystemScanTool: boolean
  registerStatusTool: boolean
}

export const Config: Schema<Config> = Schema.object({
  workspaceRoot: Schema.string()
    .description('Optional scan-root override. By default ArchScope uses the current DeepSeek Harness session workspace; relative overrides resolve from that workspace.'),
  outputDirectory: Schema.string()
    .default('archscope_docs')
    .description('Directory where ArchScope will write generated analysis artifacts.'),
  discoveryMaxDepth: Schema.number()
    .min(1)
    .max(12)
    .default(3)
    .description('Maximum directory depth used to discover Git project roots.'),
  codebaseMemoryServerName: Schema.string()
    .default('codebase_memory_mcp')
    .description('DSH MCP server namespace that provides codebase-memory tools.'),
  indexMode: Schema.union(['fast', 'moderate', 'full'] as const)
    .default('moderate')
    .description('codebase-memory indexing mode used for newly indexed or refreshed projects.'),
  evidenceProvider: Schema.string()
    .default('spawn')
    .description('DSH one-shot subagent provider used for read-only per-project system evidence workers.'),
  systemConcurrency: Schema.number()
    .min(1)
    .max(16)
    .default(4)
    .description('Maximum concurrent indexing and system evidence tasks.'),
  registerCommand: Schema.boolean()
    .default(true)
    .description('Register the deterministic /archscope command when a command adapter is available.'),
  registerSystemScanTool: Schema.boolean()
    .default(true)
    .description('Register the archscope_scan_system model-facing tool.'),
  registerStatusTool: Schema.boolean()
    .default(true)
    .description('Register the archscope_status run inspection tool.'),
})
