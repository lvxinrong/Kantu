import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import type { ProjectType } from '../contracts/system-scan.js'

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

async function readPackageJson(root: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function packageNames(pkg: Record<string, unknown>): Set<string> {
  const names = new Set<string>()
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const value = pkg[field]
    if (typeof value !== 'object' || value === null) continue
    for (const name of Object.keys(value)) names.add(name)
  }
  return names
}

export interface ProjectClassification {
  type: ProjectType
  evidence: string[]
}

export async function classifyProject(root: string): Promise<ProjectClassification> {
  const markers: Array<[string, ProjectType]> = [
    ['project.config.json', 'wechat-miniprogram'],
    ['AndroidManifest.xml', 'android-app'],
    ['pubspec.yaml', 'flutter-app'],
    ['go.mod', 'go-project'],
    ['pyproject.toml', 'python-project'],
    ['requirements.txt', 'python-project'],
    ['manage.py', 'python-project'],
    ['pom.xml', 'java-project'],
    ['build.gradle', 'java-project'],
    ['build.gradle.kts', 'java-project'],
  ]

  for (const [marker, type] of markers) {
    if (await exists(path.join(root, marker))) return { type, evidence: [marker] }
  }

  const entries = await Promise.all([
    exists(path.join(root, 'Podfile')),
    exists(path.join(root, 'Info.plist')),
    exists(path.join(root, 'Dockerfile')),
    exists(path.join(root, 'docker-compose.yml')),
    exists(path.join(root, 'Jenkinsfile')),
  ])
  if (entries[0] || entries[1]) {
    return { type: 'ios-app', evidence: entries[0] ? ['Podfile'] : ['Info.plist'] }
  }

  const pkg = await readPackageJson(root)
  if (pkg !== undefined) {
    const names = packageNames(pkg)
    if (names.has('react-native') || names.has('expo')) {
      return { type: 'react-native-app', evidence: ['package.json'] }
    }
    if (['next', 'nuxt', 'react', 'vue', '@angular/core', 'vite'].some(name => names.has(name))) {
      return { type: 'web-frontend', evidence: ['package.json'] }
    }
    if (['express', '@nestjs/core', 'koa', 'fastify', 'hono'].some(name => names.has(name))) {
      return { type: 'node-service', evidence: ['package.json'] }
    }
    return { type: 'unknown', evidence: ['package.json'] }
  }

  if (entries[2] || entries[3] || entries[4]) {
    const evidence = ['Dockerfile', 'docker-compose.yml', 'Jenkinsfile'].filter((_name, index) => entries[index + 2])
    return { type: 'deployment-config', evidence }
  }

  if (await exists(path.join(root, 'index.html'))) {
    return { type: 'web-frontend', evidence: ['index.html'] }
  }

  return { type: 'unknown', evidence: [] }
}
