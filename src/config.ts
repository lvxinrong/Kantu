import Schema from '@deepseek-ai/schemastery'

export interface Config {
  workspaceRoot: string
  outputDirectory: string
  discoveryMaxDepth: number
  registerCommand: boolean
  registerSystemScanTool: boolean
  registerStatusTool: boolean
}

export const Config: Schema<Config> = Schema.object({
  workspaceRoot: Schema.string()
    .default('.')
    .description('Workspace root scanned by Kantu. Relative paths resolve from the Harness process working directory.'),
  outputDirectory: Schema.string()
    .default('kantu_docs')
    .description('Directory where Kantu will write generated analysis artifacts.'),
  discoveryMaxDepth: Schema.number()
    .min(1)
    .max(12)
    .default(3)
    .description('Maximum directory depth used to discover Git project roots.'),
  registerCommand: Schema.boolean()
    .default(true)
    .description('Register the deterministic /kantu command when a command adapter is available.'),
  registerSystemScanTool: Schema.boolean()
    .default(true)
    .description('Register the kantu_scan_system model-facing tool.'),
  registerStatusTool: Schema.boolean()
    .default(true)
    .description('Register the kantu_status run inspection tool.'),
})
