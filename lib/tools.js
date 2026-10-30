/**
 * Agent-facing SSH tools, scoped to the workspace.
 *
 * The point of this module is isolation: the model never names a host. Each
 * call resolves the calling Session's working directory, reads the binding file
 * that a remote workspace carries, and talks to exactly that host. A session in
 * a workspace bound to server A therefore has no argument, no default and no
 * fallback that can reach server B — the tool surface itself cannot express it.
 *
 * (The MCP server in `server.mjs` cannot do this: `dsh-mcp-client` forwards only
 * the tool name and arguments, so the server never learns which Session called
 * it. Native tools receive `exec.agent`, which is what makes the rule possible.)
 *
 * @module dsh-mcp-ssh/tools
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadHosts } from './config.js'
import {
  downloadFile,
  execRemote,
  resolveRemotePath,
  uploadFile,
} from './ssh.js'

/** Name of the machine-readable binding a remote workspace carries. */
const BINDING_FILE = '.dsh-ssh-workspace.json'

/** Output cap for one command, matching the panel's own rendering. */
const MAX_TEXT = 60_000

/**
 * Read the binding of a workspace directory.
 * @param {string} directory - the Session's working directory.
 * @returns {Promise<{ host: string, label?: string, remoteRoot?: string } | undefined>} the binding, when present.
 */
async function readBinding(directory) {
  let raw
  try {
    raw = await readFile(join(directory, BINDING_FILE), 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed?.host === 'string' && parsed.host !== '' ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve the one host this call may reach.
 *
 * Throws instead of falling back to any other host: an unbound workspace has no
 * SSH access at all, which is the isolation guarantee.
 * @param {object} ctx - the plugin context (needs `workingDirectory`).
 * @param {object} exec - the tool execution context.
 * @returns {Promise<{ host: object, directory: string, binding: object }>} the resolved host.
 */
async function boundHost(ctx, exec) {
  if (exec.agent === undefined) {
    throw new Error('ssh tools need an agent session: no Session is attached to this call')
  }
  const directory = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
  const binding = await readBinding(directory)
  if (binding === undefined) {
    throw new Error(
      `当前工作区没有绑定 SSH 主机（${directory} 下缺少 ${BINDING_FILE}）。` +
        '请先在左侧栏「SSH 远程」里连接服务器并创建远程工作区；未绑定的会话不能访问任何服务器。',
    )
  }
  const { hosts } = loadHosts(process.env.DSH_SSH_HOSTS)
  const host = hosts.get(binding.host)
  if (host === undefined) {
    throw new Error(`工作区绑定的主机 "${binding.host}" 不在当前 ssh-hosts.json 里，请检查配置`)
  }
  return { host, directory, binding }
}

/**
 * Render one finished command the way the shell tools render theirs.
 * @param {object} host - normalized host.
 * @param {{ stdout: string, stderr: string, exitCode: number | null, signal: string | null, timedOut: boolean, durationMs: number }} result - the run.
 * @returns {string} model-facing text.
 */
function renderExec(host, result) {
  let body = result.stdout
  if (result.stderr.length > 0) {
    if (body.length > 0 && !body.endsWith('\n')) body += '\n'
    body += `[stderr]\n${result.stderr}`
  }
  if (body.length === 0) body = '(no output)'
  if (body.length > MAX_TEXT) body = `[${body.length - MAX_TEXT} earlier characters dropped]\n${body.slice(-MAX_TEXT)}`
  const markers = []
  if (result.timedOut) markers.push(`[timed out after ${result.durationMs}ms]`)
  if (result.signal !== null) markers.push(`[killed by signal: ${result.signal}]`)
  else if (result.exitCode !== null && result.exitCode !== 0) markers.push(`[exit code: ${result.exitCode}]`)
  const head = `[${host.username}@${host.host}] exit ${result.exitCode ?? 'n/a'} in ${result.durationMs}ms`
  return [head, body, ...markers].join('\n')
}

/**
 * One tool's text result.
 * @param {string} text - the payload.
 * @returns {{ type: 'text', text: string }[]} the content block list.
 */
function text(text) {
  return [{ type: 'text', text }]
}

/**
 * Build the four workspace-scoped tools.
 * @param {object} ctx - plugin context.
 * @returns {object[]} tool definitions for `ctx.tools.register`.
 */
export function buildTools(ctx) {
  return [
    {
      name: 'ssh_exec',
      description:
        'Run a shell command on the SSH host bound to this workspace. The host is fixed by the workspace binding — there is no host argument, and a workspace without a binding cannot reach any server. Non-zero exits are reported as [exit code: N] markers, not errors. Long output is truncated to its tail.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run on the bound host.' },
          workdir: { type: 'string', description: 'Remote directory to run in (absolute POSIX path). Defaults to the login directory.' },
          timeoutMs: { type: 'number', description: 'Kill the remote command after this many milliseconds. Defaults to 60000.' },
        },
        required: ['command'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => text(String(value)),
      },
      async execute(args, exec) {
        const command = typeof args.command === 'string' ? args.command.trim() : ''
        if (command === '') throw new Error('command must be a non-empty string')
        const { host } = await boundHost(ctx, exec)
        const result = await execRemote(host, {
          command,
          workdir: typeof args.workdir === 'string' && args.workdir !== '' ? args.workdir : undefined,
          timeoutMs: Number.isFinite(Number(args.timeoutMs)) ? Number(args.timeoutMs) : 60_000,
        })
        return renderExec(host, result)
      },
    },
    {
      name: 'ssh_upload',
      description:
        'Copy a local file to the SSH host bound to this workspace over SFTP, creating the remote parent directory when needed. The host is fixed by the workspace binding.',
      parameters: {
        type: 'object',
        properties: {
          localPath: { type: 'string', description: 'Absolute local path (or a ~ path) of the file to send.' },
          remotePath: { type: 'string', description: 'Absolute POSIX path to write on the bound host.' },
        },
        required: ['localPath', 'remotePath'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => text(String(value)),
      },
      async execute(args, exec) {
        if (typeof args.localPath !== 'string' || args.localPath === '') throw new Error('localPath must be a non-empty string')
        if (typeof args.remotePath !== 'string' || !args.remotePath.startsWith('/')) {
          throw new Error('remotePath must be an absolute POSIX path')
        }
        const { host } = await boundHost(ctx, exec)
        const result = await uploadFile(host, { localPath: args.localPath, remotePath: args.remotePath })
        return `uploaded ${result.bytes} bytes in ${result.durationMs}ms\n  local:  ${result.localPath}\n  remote: ${host.username}@${host.host}:${result.remotePath}`
      },
    },
    {
      name: 'ssh_download',
      description:
        'Copy a file from the SSH host bound to this workspace to the local machine over SFTP. The host is fixed by the workspace binding.',
      parameters: {
        type: 'object',
        properties: {
          remotePath: { type: 'string', description: 'Absolute POSIX path of the file to fetch.' },
          localPath: { type: 'string', description: 'Absolute local path (or a ~ path) to write.' },
        },
        required: ['remotePath', 'localPath'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => text(String(value)),
      },
      async execute(args, exec) {
        if (typeof args.remotePath !== 'string' || !args.remotePath.startsWith('/')) {
          throw new Error('remotePath must be an absolute POSIX path')
        }
        if (typeof args.localPath !== 'string' || args.localPath === '') throw new Error('localPath must be a non-empty string')
        const { host } = await boundHost(ctx, exec)
        const result = await downloadFile(host, { remotePath: args.remotePath, localPath: args.localPath })
        return `downloaded ${result.bytes} bytes in ${result.durationMs}ms\n  remote: ${host.username}@${host.host}:${result.remotePath}\n  local:  ${result.localPath}`
      },
    },
    {
      name: 'ssh_workspace',
      description:
        'Describe the SSH binding of this workspace: the bound host, its login directory and the remote working directory. Reports that the workspace is unbound when it has no binding.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => text(String(value)),
      },
      async execute(_args, exec) {
        const { host, binding, directory } = await boundHost(ctx, exec)
        const remoteRoot = typeof binding.remoteRoot === 'string' && binding.remoteRoot !== '' ? binding.remoteRoot : '~'
        const home = await resolveRemotePath(host, '~')
        return [
          `bound host: ${host.alias} (${host.username}@${host.host}:${host.port})`,
          `remote working directory: ${remoteRoot}`,
          `login directory: ${home}`,
          `local workspace: ${directory}`,
        ].join('\n')
      },
    },
  ]
}

/**
 * Register the workspace-scoped tools on the Host tool registry.
 * @param {object} ctx - plugin context carrying `tools` and `workingDirectory`.
 * @returns {void}
 */
export function registerTools(ctx) {
  const tools = buildTools(ctx)
  for (const tool of tools) ctx.tools.register(tool)
  ctx.logger.info(`ssh-panel: workspace-scoped tools registered (${tools.map((tool) => tool.name).join(', ')})`)
}
