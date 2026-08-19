import Schema from '@deepseek-ai/schemastery'

export interface Config {
  outputDirectory: string
  registerStatusTool: boolean
}

export const Config: Schema<Config> = Schema.object({
  outputDirectory: Schema.string()
    .default('kantu_docs')
    .description('Directory where Kantu will write generated analysis artifacts.'),
  registerStatusTool: Schema.boolean()
    .default(true)
    .description('Register the kantu_status diagnostic tool.'),
})

