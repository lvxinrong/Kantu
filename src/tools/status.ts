import { defineTool } from '@deepseek-ai/dsh-tools'

export interface StatusOptions {
  outputDirectory: string
}

export function createStatusMessage(options: StatusOptions): string {
  return [
    'Kantu is loaded.',
    `Analysis artifacts: ${options.outputDirectory}.`,
    'System scanning is not implemented in this scaffold yet.',
  ].join(' ')
}

export function createStatusTool(options: StatusOptions) {
  return defineTool({
    name: 'kantu_status',
    description: 'Report whether the Kantu plugin scaffold is loaded and where it will write artifacts.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute() {
      return createStatusMessage(options)
    },
  })
}

