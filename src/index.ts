import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'

import { createKantuCommand } from './commands/kantu.js'
import type { Config as KantuConfig } from './config.js'
import { createStatusTool } from './tools/status.js'

export const name = 'kantu'
export const inject = ['tools']
export { Config } from './config.js'
export type * from './intents.js'
export { KANTU_COMMAND_HELP, parseKantuCommand } from './commands/kantu.js'

export function apply(ctx: Context, config: KantuConfig): void {
  if (config.registerCommand) {
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register(
        createKantuCommand({ outputDirectory: config.outputDirectory }),
      )
    })
  }

  if (config.registerStatusTool) {
    ctx.tools.register(
      createStatusTool({
        outputDirectory: config.outputDirectory,
      }),
    )
  }
}
