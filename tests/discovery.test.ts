import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createProjectKey, discoverProjects } from '../src/system/discovery.js'

const temporaryRoots: string[] = []

async function temporaryWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'archscope-discovery-'))
  temporaryRoots.push(root)
  return root
}

async function gitRoot(directory: string): Promise<void> {
  await mkdir(path.join(directory, '.git'), { recursive: true })
  await writeFile(path.join(directory, '.git', 'HEAD'), '0123456789abcdef0123456789abcdef01234567\n')
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('discoverProjects', () => {
  it('discovers nested Git roots and gives same-named projects stable distinct identities', async () => {
    const root = await temporaryWorkspace()
    const first = path.join(root, 'group-a', 'service')
    const second = path.join(root, 'group-b', 'service')
    await gitRoot(first)
    await gitRoot(second)
    await writeFile(path.join(first, 'pom.xml'), '<project />')
    await writeFile(path.join(second, 'package.json'), JSON.stringify({ dependencies: { express: '1.0.0' } }))

    const result = await discoverProjects({ root, maxDepth: 3, outputDirectory: 'archscope_docs' })

    expect(result.projects).toHaveLength(2)
    expect(new Set(result.projects.map(project => project.projectKey)).size).toBe(2)
    expect(result.projects.map(project => project.projectDir)).toEqual(['group-a/service', 'group-b/service'])
    expect(result.projects.map(project => project.projectType)).toEqual(['java-project', 'node-service'])
    expect(result.projects.every(project => project.productionStatus === 'UNCONFIRMED')).toBe(true)
  })

  it('stops recursion at a discovered Git root and does not follow symlinks', async () => {
    const root = await temporaryWorkspace()
    const project = path.join(root, 'project')
    await gitRoot(project)
    await gitRoot(path.join(project, 'nested'))
    await symlink(project, path.join(root, 'project-link'))

    const result = await discoverProjects({ root, maxDepth: 4, outputDirectory: 'archscope_docs' })

    expect(result.projects.map(item => item.projectDir)).toEqual(['project'])
  })

  it('uses the workspace Git root when it is the only project', async () => {
    const root = await temporaryWorkspace()
    await gitRoot(root)

    const result = await discoverProjects({ root, maxDepth: 3, outputDirectory: 'archscope_docs' })

    expect(result.projects).toHaveLength(1)
    expect(result.projects[0]?.projectDir).toBe('.')
    expect(result.projects[0]?.projectKey).toBe(createProjectKey('.', path.basename(root)))
  })

  it('skips only the configured nested output directory, not its siblings', async () => {
    const root = await temporaryWorkspace()
    await gitRoot(path.join(root, 'reports', 'real-project'))
    await gitRoot(path.join(root, 'reports', 'generated'))

    const result = await discoverProjects({ root, maxDepth: 3, outputDirectory: 'reports/generated' })

    expect(result.projects.map(project => project.projectDir)).toEqual(['reports/real-project'])
  })
})
