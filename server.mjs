#!/usr/bin/env node
/**
 * `dsh-mcp-ssh` — an MCP server that gives DeepSeek Harness SSH access to the
 * hosts listed in `~/.dsh/ssh-hosts.json` (or `DSH_SSH_HOSTS`), merged with the
 * user's own `~/.ssh/config`.
 *
 * Tools are published as `mcp__ssh__<tool>` by `@deepseek-ai/dsh-mcp-client`:
 * `ssh_hosts`, `ssh_exec`, `ssh_upload`, `ssh_download`.
 *
 * Transport is MCP stdio: stdout carries protocol frames only, so every
 * diagnostic goes to stderr.
 *
 * @module dsh-mcp-ssh
 */
import { statSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { loadHosts } from './lib/config.js'
import { closeAll, downloadFile, execRemote, uploadFile } from './lib/ssh.js'

const VERSION = '0.2.0'

/**
 * Hosts are re-read when the file changes on disk, so editing host details
 * never requires restarting the harness.
 */
let cached = { at: 0, config: undefined }

/**
 * Load (or reuse) the host table.
 * @returns {ReturnType<typeof loadHosts>} the host configuration.
 */
function config() {
  const file = process.env.DSH_SSH_HOSTS
  let stamp = 0
  try {
    stamp = file === undefined ? 0 : statSync(file).mtimeMs
  } catch {
    stamp = 0
  }
  if (cached.config === undefined || stamp !== cached.at) {
    cached = { at: stamp, config: loadHosts(file) }
    for (const warning of cached.config.warnings) {
      process.stderr.write(`[dsh-mcp-ssh] ${warning}\n`)
    }
  }
  return cached.config
}

/**
 * Resolve the host a call targets, defaulting to the configured default host.
 * @param {string | undefined} alias - the alias the model named, if any.
 * @returns {object} the normalized host.
 * @throws {Error} when the alias is unknown.
 */
function hostFor(alias) {
  const { hosts, defaultHost } = config()
  const name = alias ?? defaultHost
  const host = hosts.get(name)
  if (host === undefined) {
    const available = [...hosts.keys()].join(', ')
    throw new Error(`unknown host "${name}"; configured hosts: ${available}`)
  }
  return host
}

/**
 * Render one command result the way the local shell tools render theirs:
 * output, a marked stderr section, then exit-status markers.
 * @param {string} label - the host label the command ran on.
 * @param {{ stdout: string, stderr: string, exitCode: number | null, signal: string | null, timedOut: boolean, durationMs: number }} result - the run.
 * @returns {string} model-facing text.
 */
function renderExec(label, result) {
  let body = result.stdout
  if (result.stderr.length > 0) {
    if (body.length > 0 && !body.endsWith('\n')) body += '\n'
    body += `[stderr]\n${result.stderr}`
  }
  if (body.length === 0) body = '(no output)'
  const markers = []
  if (result.timedOut) markers.push(`[timed out after ${result.durationMs}ms]`)
  if (result.signal !== null) markers.push(`[killed by signal: ${result.signal}]`)
  else if (result.exitCode !== null && result.exitCode !== 0) markers.push(`[exit code: ${result.exitCode}]`)
  const head = `[${label}] exit ${result.exitCode ?? 'n/a'} in ${result.durationMs}ms`
  return [head, body, ...markers].join('\n')
}

/**
 * Build one MCP text result.
 * @param {string} text - the payload.
 * @param {boolean} [isError] - whether the call failed.
 * @returns {{ content: Array<{ type: 'text', text: string }>, isError?: boolean }} the SDK result.
 */
function textResult(text, isError = false) {
  return isError ? { content: [{ type: 'text', text }], isError: true } : { content: [{ type: 'text', text }] }
}

/**
 * Wrap a tool body so a thrown error becomes a readable tool error rather than
 * a protocol failure.
 * @param {(args: any) => Promise<string>} body - the tool implementation.
 * @returns {(args: any) => Promise<object>} the MCP handler.
 */
function handler(body) {
  return async (args) => {
    try {
      return textResult(await body(args ?? {}))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return textResult(message, true)
    }
  }
}

const server = new McpServer(
  { name: 'dsh-ssh', version: VERSION },
  {
    instructions:
      'SSH access to the hosts configured for this machine. Use ssh_hosts first to learn the available aliases, then ssh_exec to run commands, ssh_upload to push a local file, ssh_download to fetch a remote one. Paths on the remote side are POSIX; local paths are Windows paths unless they start with ~.',
  },
)

server.registerTool(
  'ssh_hosts',
  {
    title: 'List SSH hosts',
    description:
      'List the SSH hosts this server can reach: alias, user@host:port, authentication kind, and the default host used when a call names none.',
    inputSchema: {},
  },
  handler(async () => {
    const { hosts, defaultHost, source, warnings } = config()
    const lines = [`default host: ${defaultHost}`, `hosts file: ${source}`, '']
    for (const [alias, host] of hosts) {
      const auth = host.privateKeyPath !== '' ? `key ${host.privateKeyPath}` : 'password'
      const marker = alias === defaultHost ? '*' : ' '
      lines.push(`${marker} ${alias}  ${host.username}@${host.host}:${host.port}  (${auth})`)
    }
    if (warnings.length > 0) {
      lines.push('', 'warnings:', ...warnings.map((warning) => `- ${warning}`))
    }
    return lines.join('\n')
  }),
)

server.registerTool(
  'ssh_exec',
  {
    title: 'Run a command over SSH',
    description:
      'Run a shell command on a configured SSH host and return its stdout/stderr. Each call opens a channel on the pooled connection; pass workdir instead of using cd. Non-zero exits are reported as [exit code: N] markers, not errors — read them and decide. Long output is truncated to its tail.',
    inputSchema: {
      command: z.string().min(1).describe('The shell command to run on the remote host.'),
      host: z.string().optional().describe('Host alias from ssh_hosts. Defaults to the configured default host.'),
      workdir: z.string().optional().describe('Remote directory to run in (absolute POSIX path). Defaults to the login directory.'),
      timeoutMs: z
        .number()
        .int()
        .positive()
        .max(1_800_000)
        .optional()
        .describe('Kill the remote command after this many milliseconds. Defaults to 60000.'),
    },
  },
  handler(async (args) => {
    const host = hostFor(args.host)
    const result = await execRemote(host, {
      command: args.command,
      workdir: args.workdir,
      timeoutMs: args.timeoutMs,
    })
    return renderExec(`${host.username}@${host.host}`, result)
  }),
)

server.registerTool(
  'ssh_upload',
  {
    title: 'Upload a file over SFTP',
    description:
      'Copy a local file to a configured SSH host over SFTP, creating the remote parent directory when needed. Returns the byte count and the paths used.',
    inputSchema: {
      localPath: z.string().min(1).describe('Absolute Windows path (or a ~ path) of the local file to send.'),
      remotePath: z.string().min(1).describe('Absolute POSIX path to write on the remote host.'),
      host: z.string().optional().describe('Host alias from ssh_hosts. Defaults to the configured default host.'),
    },
  },
  handler(async (args) => {
    const host = hostFor(args.host)
    const result = await uploadFile(host, { localPath: args.localPath, remotePath: args.remotePath })
    return `uploaded ${result.bytes} bytes in ${result.durationMs}ms\n  local:  ${result.localPath}\n  remote: ${host.username}@${host.host}:${result.remotePath}`
  }),
)

server.registerTool(
  'ssh_download',
  {
    title: 'Download a file over SFTP',
    description:
      'Copy a remote file from a configured SSH host to the local machine over SFTP. Returns the byte count and the paths used.',
    inputSchema: {
      remotePath: z.string().min(1).describe('Absolute POSIX path of the file to fetch.'),
      localPath: z.string().min(1).describe('Absolute Windows path (or a ~ path) to write locally.'),
      host: z.string().optional().describe('Host alias from ssh_hosts. Defaults to the configured default host.'),
    },
  },
  handler(async (args) => {
    const host = hostFor(args.host)
    const result = await downloadFile(host, { remotePath: args.remotePath, localPath: args.localPath })
    return `downloaded ${result.bytes} bytes in ${result.durationMs}ms\n  remote: ${host.username}@${host.host}:${result.remotePath}\n  local:  ${result.localPath}`
  }),
)

/** Close pooled connections and exit cleanly on either stop path. */
async function shutdown() {
  closeAll()
  await server.close().catch(() => {})
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.stdin.on('end', shutdown)

await server.connect(new StdioServerTransport())
process.stderr.write(`[dsh-mcp-ssh] ${VERSION} ready\n`)
