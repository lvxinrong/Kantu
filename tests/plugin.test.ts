import { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'

import { apply } from '../src/index.js'

describe('ArchScope plugin registration', () => {
  it('registers only the canonical ArchScope interaction surfaces', () => {
    const tools: ToolDefinition[] = []
    const commands: CommandDefinition[] = []
    const ctx = new Context().extend({
      tools: {
        register(definition: ToolDefinition) {
          tools.push(definition)
          return () => undefined
        },
      },
      inject(dependencies: string[], callback: (child: Context) => void) {
        expect(dependencies).toEqual(['commands'])
        callback(new Context().extend({
          commands: {
            register(definition: CommandDefinition) {
              commands.push(definition)
              return () => undefined
            },
          },
        }))
      },
    })

    apply(ctx, {
      outputDirectory: 'archscope_docs',
      discoveryMaxDepth: 3,
      registerCommand: true,
      registerSystemScanTool: true,
      registerStatusTool: true,
    })

    expect(commands.map(command => command.name)).toEqual(['archscope'])
    expect(commands[0]?.input?.hint).toContain('system')
    expect(tools.map(tool => tool.name).sort()).toEqual(['archscope_scan_system', 'archscope_status'])
  })

  it('can disable both interaction surfaces through config', () => {
    const ctx = new Context()

    apply(ctx, {
      workspaceRoot: '.',
      outputDirectory: 'archscope_docs',
      discoveryMaxDepth: 3,
      registerCommand: false,
      registerSystemScanTool: false,
      registerStatusTool: false,
    })

    expect(ctx.archscope).toBeDefined()
  })
})
