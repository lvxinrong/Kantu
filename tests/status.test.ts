import { describe, expect, it } from 'vitest'

import { createStatusMessage } from '../src/tools/status.js'

describe('createStatusMessage', () => {
  it('reports when no persisted run exists', () => {
    const message = createStatusMessage({
      found: false,
      runId: '',
      status: 'NOT_FOUND',
      gate: 'BLOCKED',
      validation: 'NOT_RUN',
      projectCount: 0,
      indexedProjectCount: 0,
      evidenceProjectCount: 0,
      scopeViolationCount: 0,
      outputDirectory: '.kantu/artifacts',
    })

    expect(message).toContain('No ArchScope run was found')
    expect(message).toContain('.kantu/artifacts')
  })

  it('puts the scan outcome before run metadata', () => {
    const message = createStatusMessage({
      found: true,
      runId: 'system-1',
      status: 'BLOCKED',
      gate: 'BLOCKED',
      validation: 'PASSED',
      projectCount: 3,
      indexedProjectCount: 2,
      evidenceProjectCount: 1,
      scopeViolationCount: 0,
      outputDirectory: 'kantu_docs',
    })

    expect(message.split('\n')[0]).toBe(
      'ArchScope system scan finished · 3 projects · system analysis awaiting source evidence.',
    )
    expect(message).toContain('Fresh indexes 2/3 · collected evidence 1/3 · scope violations 0.')
    expect(message).toContain('System artifact validation PASSED · project-scan gate BLOCKED.')
    expect(message).toContain('Run: system-1 · machine status BLOCKED.')
  })
})
