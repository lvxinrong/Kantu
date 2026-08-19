import type { Context } from '@deepseek-ai/cordis'

import type { Config as KantuConfig } from './config.js'
import { createStatusTool } from './tools/status.js'

export const name = 'kantu'
export const inject = ['tools']
export { Config } from './config.js'

export function apply(ctx: Context, config: KantuConfig): void {
  if (!config.registerStatusTool) return

  ctx.tools.register(
    createStatusTool({
      outputDirectory: config.outputDirectory,
    }),
  )
}
