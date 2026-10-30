/**
 * Isolation contract for the agent-facing tools.
 *
 * The model cannot name a host: `ssh_exec` / `ssh_upload` / `ssh_download` take
 * no `host` argument, and the host comes from the calling Session's workspace
 * binding. This test proves the three branches — unbound, bound to an unknown
 * host, bound to a real host — and that no tool schema exposes a host knob.
 *
 * Run with: node test/tools-isolation.mjs
 * A live branch runs only when a host is configured in ssh-hosts.json.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildTools } from '../lib/tools.js'
import { loadHosts } from '../lib/config.js'

const root = mkdtempSync(join(tmpdir(), 'ssh-tools-'))
let currentDir = root
const registered = []
const ctx = {
  workingDirectory: {
    async ensure() {
      return currentDir
    },
  },
  logger: { info() {}, warn() {} },
  tools: {
    register(tool) {
      registered.push(tool)
      return () => {}
    },
  },
}

const tools = buildTools(ctx)
const byName = new Map(tools.map((tool) => [tool.name, tool]))
const exec = { agent: {}, signal: new AbortController().signal }

console.log('tools:', tools.map((tool) => tool.name).join(', '))
if (!['ssh_exec', 'ssh_upload', 'ssh_download', 'ssh_workspace'].every((name) => byName.has(name))) {
  throw new Error('expected the four workspace-scoped tools')
}

// 1. No tool schema mentions a host: isolation starts at the surface.
for (const tool of tools) {
  const properties = tool.parameters?.properties ?? {}
  if (Object.hasOwn(properties, 'host')) throw new Error(`${tool.name} exposes a host argument, which breaks isolation`)
  if (JSON.stringify(tool.parameters).includes('"host"')) throw new Error(`${tool.name} mentions host in its schema`)
}
console.log('OK: no tool exposes a host argument')

// 2. An unbound workspace cannot reach any server.
currentDir = join(root, 'plain-workspace')
const { mkdirSync } = await import('node:fs')
mkdirSync(currentDir, { recursive: true })
try {
  await byName.get('ssh_exec').execute({ command: 'hostname' }, exec)
  throw new Error('an unbound workspace should have been refused')
} catch (error) {
  const message = String(error.message)
  console.log('unbound ->', message.slice(0, 80))
  if (!message.includes('没有绑定 SSH 主机')) throw new Error(`unexpected refusal: ${message}`)
}

// 3. A binding that names an unknown host is refused instead of falling back.
currentDir = join(root, 'stale-workspace')
mkdirSync(currentDir, { recursive: true })
writeFileSync(join(currentDir, '.dsh-ssh-workspace.json'), JSON.stringify({ version: 1, host: 'no-such-host' }))
try {
  await byName.get('ssh_exec').execute({ command: 'hostname' }, exec)
  throw new Error('an unknown bound host should have been refused')
} catch (error) {
  const message = String(error.message)
  console.log('unknown host ->', message.slice(0, 80))
  if (!message.includes('不在当前 ssh-hosts.json')) throw new Error(`unexpected refusal: ${message}`)
}

// 4. A real host works through the binding, and only through it.
const { hosts } = loadHosts(process.env.DSH_SSH_HOSTS)
const alias = process.env.DSH_SSH_TEST_HOST ?? hosts.keys().next().value
const host = hosts.get(alias)
if (host === undefined) {
  console.log('\nskip live branch: no usable host configured')
  process.exit(0)
}
currentDir = join(root, 'bound-workspace')
mkdirSync(currentDir, { recursive: true })
writeFileSync(join(currentDir, '.dsh-ssh-workspace.json'), JSON.stringify({ version: 1, host: alias, remoteRoot: '/' }))
const info = await byName.get('ssh_workspace').execute({}, exec)
console.log('\nssh_workspace ->\n' + info)
if (!info.includes(alias)) throw new Error('ssh_workspace did not report the bound host')

const run = await byName.get('ssh_exec').execute({ command: 'hostname; echo bound-to-' + alias }, exec)
console.log('\nssh_exec ->\n' + run.split('\n').slice(0, 3).join('\n'))
if (!run.includes(`bound-to-${alias}`)) throw new Error('ssh_exec did not run on the bound host')
if (run.includes('exit 255')) throw new Error('ssh_exec failed to connect')

console.log('\nOK: SSH access is workspace-scoped and cannot address another server')
