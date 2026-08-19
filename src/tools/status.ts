import { defineTool } from '@deepseek-ai/dsh-tools'

import type { KantuStatusResult } from '../contracts/system-scan.js'
import type { KantuService } from '../service.js'

export function createStatusMessage(status: KantuStatusResult): string {
  if (!status.found) {
    return `No Kantu run was found. Analysis artifacts will be written to ${status.outputDirectory}.`
  }
  return [
    `Kantu run ${status.runId}: ${status.status}.`,
    `Projects: ${status.projectCount}.`,
    `Validation: ${status.validation}.`,
    `Gate: ${status.gate}.`,
    `Artifacts: ${status.outputDirectory}.`,
  ].join(' ')
}

export function createStatusTool(service: KantuService) {
  return defineTool({
    name: 'kantu_status',
    description: 'Inspect a persisted Kantu scan run. Omit runId to inspect the latest run.',
    parameters: {
      runId: { type: 'string', description: 'Optional Kantu run id.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          found: { type: 'boolean', required: true },
          runId: { type: 'string', required: true },
          status: { type: 'string', required: true },
          gate: { type: 'string', required: true },
          validation: { type: 'string', required: true },
          projectCount: { type: 'number', required: true },
          outputDirectory: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: createStatusMessage(value as unknown as KantuStatusResult) }],
    },
    async execute(args) {
      return service.status(args.runId)
    },
  })
}
