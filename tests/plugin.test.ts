import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import { describe, expect, it, vi } from 'vitest'

import { apply } from '../src/index.js'

describe('Kantu plugin registration', () => {
  it('registers /kantu through the optional commands service', () => {
    let command: CommandDefinition | undefined
    const registerTool = vi.fn()
    const ctx = {
      tools: { register: registerTool },
      inject(dependencies: string[], callback: (child: unknown) => void) {
        expect(dependencies).toEqual(['commands'])
        callback({
          commands: {
            register(definition: CommandDefinition) {
              command = definition
            },
          },
        })
      },
    } as unknown as Context

    apply(ctx, {
      outputDirectory: 'kantu_docs',
      registerCommand: true,
      registerStatusTool: true,
    })

    expect(command?.name).toBe('kantu')
    expect(command?.input?.hint).toContain('system')
    expect(registerTool).toHaveBeenCalledOnce()
  })

  it('can disable both interaction surfaces through config', () => {
    const inject = vi.fn()
    const registerTool = vi.fn()
    const ctx = {
      tools: { register: registerTool },
      inject,
    } as unknown as Context

    apply(ctx, {
      outputDirectory: 'kantu_docs',
      registerCommand: false,
      registerStatusTool: false,
    })

    expect(inject).not.toHaveBeenCalled()
    expect(registerTool).not.toHaveBeenCalled()
  })
})
