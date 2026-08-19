import Schema from '@deepseek-ai/schemastery'

export interface Config {
  outputDirectory: string
  registerCommand: boolean
  registerStatusTool: boolean
}

export const Config: Schema<Config> = Schema.object({
  outputDirectory: Schema.string()
    .default('kantu_docs')
    .description('Directory where Kantu will write generated analysis artifacts.'),
  registerCommand: Schema.boolean()
    .default(true)
    .description('Register the deterministic /kantu command when a command adapter is available.'),
  registerStatusTool: Schema.boolean()
    .default(true)
    .description('Register the kantu_status diagnostic tool.'),
})
