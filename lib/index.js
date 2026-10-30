/**
 * Host half of the SSH panel: the HTTP endpoints the browser panel calls.
 *
 * The panel is a client plugin, so it cannot open a socket itself; this half
 * runs inside the Host process, reuses the same `~/.dsh/ssh-hosts.json` reader
 * and the same pooled `ssh2` transport as the MCP tools, and exposes
 * loopback-only JSON endpoints under `/ssh-panel/api`.
 *
 * It also owns the "remote workspace" flow: a DSH workspace must be a real
 * local directory, so `/workspace` creates one, writes the binding file and an
 * `AGENTS.md` that tells every session in it which host it is standing in
 * front of and how to reach it.
 *
 * @module dsh-mcp-ssh/host
 */
import { statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { DEFAULT_HOSTS_FILE, loadHosts } from './config.js'
import { registerTools } from './tools.js'
import {
  clearRuntimePassword,
  closeAll,
  execRemote,
  listRemote,
  needsPassword,
  readRemote,
  resolveRemotePath,
  setRuntimePassword,
  statRemote,
  writeRemote,
} from './ssh.js'

/** Loader entry name, and the namespace the HTTP routes live under. */
export const name = 'ssh-panel'

/** The Host services this plugin uses: the web server, the tool registry and the Session working directory. */
export const inject = ['webServer', 'tools', 'workingDirectory']

/** Route prefix; the panel fetches `${API}/hosts`, `${API}/exec`, … */
const API = '/ssh-panel/api'

/** Largest remote file this panel will hand to a browser, in bytes. */
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024

/** Largest text file the files tab will show inline. */
const MAX_PREVIEW_BYTES = 512 * 1024

/** Largest upload body accepted, in bytes (base64 inflates ~4/3). */
const MAX_UPLOAD_BODY = 96 * 1024 * 1024

/**
 * Hosts are re-read when the file changes, so editing host details needs no
 * Host restart.
 */
let cached = { stamp: '', config: undefined }

/**
 * Load the shared host table, reusing it while the file is unchanged.
 * @returns {ReturnType<typeof loadHosts>} the normalized hosts.
 */
function hosts() {
  const file = process.env.DSH_SSH_HOSTS ?? DEFAULT_HOSTS_FILE
  let stamp = 'missing'
  try {
    const stats = statSync(file)
    stamp = `${stats.mtimeMs}:${stats.size}`
  } catch {
    stamp = 'missing'
  }
  if (cached.config === undefined || stamp !== cached.stamp) {
    cached = { stamp, config: loadHosts(process.env.DSH_SSH_HOSTS) }
  }
  return cached.config
}

/**
 * Resolve the host a request targets.
 * @param {string | undefined} alias - requested alias.
 * @returns {object} the normalized host.
 * @throws {Error} when the alias is unknown.
 */
function hostFor(alias) {
  const { hosts: table, defaultHost } = hosts()
  const target = alias === undefined || alias === '' ? defaultHost : alias
  const host = table.get(target)
  if (host === undefined) {
    throw new Error(`unknown host "${target}"; configured hosts: ${[...table.keys()].join(', ')}`)
  }
  return host
}

/** Name of the machine-readable binding dropped into a remote workspace. */
const BINDING_FILE = '.dsh-ssh-workspace.json'

/** Name of the instruction file DSH loads for every session in a workspace. */
const INSTRUCTIONS_FILE = 'AGENTS.md'

/**
 * Directory-safe spelling of a host alias, used as the workspace folder name.
 * @param {string} alias - host alias, e.g. `10.249.188.48`.
 * @returns {string} a folder name such as `ssh-10.249.188.48`.
 */
function workspaceSlug(alias) {
  return `ssh-${alias.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')}`
}

/**
 * The directory new remote workspaces are created under: an explicit override,
 * else the folder holding the person's existing workspaces, else Documents.
 * @param {import('@deepseek-ai/cordis').Context} ctx - loader context.
 * @returns {string} an absolute directory.
 */
function workspaceParent(ctx) {
  const configured = process.env.DSH_SSH_WORKSPACE_ROOT
  if (configured !== undefined && configured !== '') return configured
  const registry = ctx.get('workspaceRegistry')
  const known = registry?.list?.() ?? []
  const local = known.map((workspace) => workspace.path).find((path) => typeof path === 'string' && path !== '')
  if (local !== undefined) return dirname(local)
  return join(homedir(), 'Documents')
}

/** Markers around the working-directory block, so switching a root rewrites only that block. */
const ROOT_START = '<!-- dsh-ssh:root -->'
const ROOT_END = '<!-- /dsh-ssh:root -->'

/**
 * The working-directory block of a workspace's AGENTS.md.
 * @param {string} remoteRoot - absolute remote directory, or '' when unspecified.
 * @returns {string} the marked block.
 */
function rootBlock(remoteRoot) {
  const line =
    remoteRoot === ''
      ? '远端工作目录：**未指定**，默认落在登录目录（`~`）。'
      : `远端工作目录：\`${remoteRoot}\`。所有远端命令都以它为工作目录，\`ssh_exec\` 请显式传 \`workdir: "${remoteRoot}"\`。`
  return `${ROOT_START}\n${line}\n${ROOT_END}`
}

/**
 * Replace (or append) the working-directory block of an instructions file.
 * @param {string} text - existing markdown.
 * @param {string} remoteRoot - the new directory, or '' for none.
 * @returns {string} the updated markdown.
 */
function withRoot(text, remoteRoot) {
  const block = rootBlock(remoteRoot)
  const start = text.indexOf(ROOT_START)
  const end = text.indexOf(ROOT_END)
  if (start !== -1 && end !== -1 && end > start) {
    return `${text.slice(0, start)}${block}${text.slice(end + ROOT_END.length)}`
  }
  return `${text.trimEnd()}\n\n${block}\n`
}

/**
 * The instruction file written into a remote workspace.
 *
 * This is the whole reason the workspace exists: DSH loads it into every
 * session started there, so the agent knows the local folder is a placeholder
 * and that the real machine is one SSH call away.
 * @param {{ host: string, label: string, remoteRoot: string }} binding - the host binding.
 * @returns {string} markdown instructions.
 */
function instructionsFor(binding) {
  return `# 远程工作区：${binding.label}

这个目录**不是**服务器上的代码副本，只是本机的工作区占位与草稿区。
真正的工作对象是 SSH 主机 \`${binding.host}\`（${binding.label}）。

${rootBlock(binding.remoteRoot)}

## 铁律

1. 服务器操作只走工作区自带的 SSH 工具，**目标主机由本工作区绑定决定，不需要也不能指定 host**：
   - 跑命令：\`ssh_exec\`（\`command\` 必填，可带 \`workdir\`、\`timeoutMs\`）
   - 上传：\`ssh_upload\`（本地路径 → 远端绝对路径）
   - 下载：\`ssh_download\`（远端绝对路径 → 本地路径）
   - 查绑定：\`ssh_workspace\`
   这些工具只会连 \`${binding.host}\`；别的服务器对你不可见，也不要尝试绕过。
2. 读远端文件用 \`ssh_exec\` 里的 \`cat\`/\`sed -n\`/\`head\`/\`tail\`；写远端文件用 \`ssh_exec\` 里的 \`tee\`/\`sed -i\`/\`cat > file <<'EOF'\`。涉及大文件或二进制时改用上传/下载。
3. 本机目录里的文件不代表服务器状态。要对照时，先 \`ssh_exec\` 看远端，再决定。
4. 动手前先确认环境：\`ssh_exec\` 跑 \`hostname; whoami; pwd\`，确认连的是对的主机。
5. 破坏性操作（\`rm -rf\`、\`systemctl restart\`、\`kill\`、数据库写入、改动 \`/etc\`）先说清影响，等用户确认再执行。
6. 远端路径是 POSIX 绝对路径；本地路径是 Windows 路径。别把两者混用。

## 常用起点

\`\`\`bash
hostname; whoami; uname -a
df -h; free -g; nproc
ls -la ~
\`\`\`

绑定信息同时写在 \`${BINDING_FILE}\` 里，可被工具读取。
`
}

/**
 * Answer with JSON.
 * @param {import('node:http').ServerResponse} res - response.
 * @param {number} status - HTTP status.
 * @param {unknown} body - JSON body.
 * @returns {void}
 */
function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

/**
 * Read and parse a JSON request body.
 * @param {import('node:http').IncomingMessage} req - request.
 * @param {number} limit - largest body accepted, in bytes.
 * @returns {Promise<Record<string, unknown>>} the parsed body.
 * @throws {Error} on an oversized, non-JSON, or non-object body.
 */
async function readJson(req, limit) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > limit) throw new Error(`request body exceeds ${limit} bytes`)
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  let parsed
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error) {
    throw new Error(`request body is not valid JSON: ${String(error)}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('request body must be a JSON object')
  }
  return parsed
}

/**
 * Refuse requests that did not come from this machine.
 *
 * The panel runs SSH commands, so reachability is not authorization: a Host
 * bound to a LAN address would otherwise let any peer with the URL run commands
 * as the configured user.
 * @param {import('node:http').IncomingMessage} req - request.
 * @returns {boolean} whether the caller is local.
 */
function isLocal(req) {
  const address = req.socket?.remoteAddress
  if (address === undefined || address === null) return true
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/**
 * Wrap a JSON endpoint: method check, local-only, error mapping.
 * @param {'GET' | 'POST'} method - the accepted method.
 * @param {(req: import('node:http').IncomingMessage) => Promise<unknown>} body - the endpoint.
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>} the route handler.
 */
function endpoint(method, body) {
  return async (req, res) => {
    if (!isLocal(req)) {
      json(res, 403, { error: 'ssh-panel only answers requests from this machine' })
      return
    }
    if (req.method !== method) {
      json(res, 405, { error: `use ${method}` })
      return
    }
    try {
      json(res, 200, await body(req))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // `needsPassword` lets the panel switch to its password step instead of
      // showing a dead end.
      const extra = error?.needsPassword === true ? { needsPassword: true } : {}
      json(res, 400, { error: message, ...extra })
    }
  }
}

/**
 * Register the panel's endpoints on the Host web server.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the loader entry's context.
 * @returns {void}
 */
export function apply(ctx) {
  const disposers = [
    ctx.webServer.register({
      kind: 'exact',
      path: `${API}/hosts`,
      handler: endpoint('GET', async () => {
        const { hosts: table, defaultHost, source, warnings } = hosts()
        return {
          defaultHost,
          source,
          warnings,
          hosts: [...table.entries()].map(([alias, host]) => ({
            alias,
            host: host.host,
            port: host.port,
            username: host.username,
            auth: host.privateKeyPath === '' ? 'password' : 'key',
            isDefault: alias === defaultHost,
          })),
        }
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${API}/connect`,
      handler: endpoint('POST', async (req) => {
        const body = await readJson(req, 16 * 1024)
        const host = hostFor(typeof body.host === 'string' ? body.host : undefined)
        const typed = typeof body.password === 'string' ? body.password : ''
        if (typed !== '') setRuntimePassword(host.alias, typed)

        if (typed === '' && needsPassword(host)) {
          throw Object.assign(new Error(`主机 ${host.alias} 既没有配置私钥也没有配置密码`), { needsPassword: true })
        }
        const stored = host.privateKeyPath !== '' || host.password !== ''
        try {
          const probe = await execRemote(host, { command: 'printf %s "$USER"', timeoutMs: 8000 })
          if (probe.exitCode !== 0) throw new Error(probe.stderr.trim() || `exit code ${probe.exitCode}`)
          return {
            ok: true,
            host: host.alias,
            label: `${host.username}@${host.host}:${host.port}`,
            user: probe.stdout.trim(),
            method: typed !== '' ? 'session-password' : stored ? (host.privateKeyPath !== '' ? 'key' : 'password') : 'session-password',
          }
        } catch (error) {
          if (typed !== '') clearRuntimePassword(host.alias)
          const message = error instanceof Error ? error.message : String(error)
          const rejected = /authentication methods failed|permission denied|authentication/i.test(message)
          if (rejected) {
            throw Object.assign(
              new Error(typed === '' ? '需要密码才能连接这台主机' : '密码或密钥不正确'),
              { needsPassword: true },
            )
          }
          throw error
        }
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${API}/root`,
      handler: endpoint('POST', async (req) => {
        const body = await readJson(req, 64 * 1024)
        const directory = typeof body.path === 'string' ? body.path : ''
        if (!/^[A-Za-z]:[\\/]/.test(directory)) throw new Error('path must be an absolute Windows workspace directory')
        const remoteRoot = typeof body.remoteRoot === 'string' ? body.remoteRoot.trim() : ''
        if (remoteRoot === '' || !remoteRoot.startsWith('/')) throw new Error('remoteRoot must be an absolute POSIX path')

        let binding
        try {
          binding = JSON.parse(await readFile(join(directory, BINDING_FILE), 'utf8'))
        } catch {
          throw Object.assign(new Error(`workspace is not bound to an SSH host (no ${BINDING_FILE} in ${directory})`), {
            needsPassword: false,
          })
        }
        const host = hostFor(typeof binding.host === 'string' ? binding.host : undefined)
        binding.remoteRoot = remoteRoot
        await writeFile(join(directory, BINDING_FILE), `${JSON.stringify(binding, null, 2)}\n`, 'utf8')

        const instructionsPath = join(directory, INSTRUCTIONS_FILE)
        let instructions = ''
        try {
          instructions = await readFile(instructionsPath, 'utf8')
        } catch {
          instructions = ''
        }
        const next = instructions === '' ? instructionsFor(binding) : withRoot(instructions, remoteRoot)
        await writeFile(instructionsPath, next, 'utf8')
        ctx.logger.info(`ssh-panel: workspace ${directory} now works in ${host.alias}:${remoteRoot}`)
        return {
          host: host.alias,
          label: `${host.username}@${host.host}:${host.port}`,
          remoteRoot,
          path: directory,
        }
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${API}/exec`,
      handler: endpoint('POST', async (req) => {
        const body = await readJson(req, 2 * 1024 * 1024)
        const command = typeof body.command === 'string' ? body.command.trim() : ''
        if (command === '') throw new Error('command must be a non-empty string')
        const host = hostFor(typeof body.host === 'string' ? body.host : undefined)
        const started = Date.now()
        const result = await execRemote(host, {
          command,
          workdir: typeof body.workdir === 'string' && body.workdir !== '' ? body.workdir : undefined,
          timeoutMs: Number.isFinite(Number(body.timeoutMs)) ? Number(body.timeoutMs) : 60_000,
        })
        return {
          host: host.alias,
          label: `${host.username}@${host.host}`,
          durationMs: result.durationMs,
          startedAt: started,
          exitCode: result.exitCode,
          signal: result.signal,
          timedOut: result.timedOut,
          stdout: result.stdout,
          stderr: result.stderr,
        }
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${API}/upload`,
      handler: endpoint('POST', async (req) => {
        const body = await readJson(req, MAX_UPLOAD_BODY)
        const remotePath = typeof body.remotePath === 'string' ? body.remotePath : ''
        if (!remotePath.startsWith('/')) throw new Error('remotePath must be an absolute POSIX path')
        const encoded = typeof body.dataBase64 === 'string' ? body.dataBase64 : ''
        if (encoded === '') throw new Error('dataBase64 must carry the file bytes')
        const host = hostFor(typeof body.host === 'string' ? body.host : undefined)
        const data = Buffer.from(encoded, 'base64')
        const written = await writeRemote(host, remotePath, data)
        return { host: host.alias, remotePath, bytes: written.bytes }
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${API}/download`,
      handler: async (req, res) => {
        if (!isLocal(req)) {
          json(res, 403, { error: 'ssh-panel only answers requests from this machine' })
          return
        }
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const remotePath = url.searchParams.get('path') ?? ''
          if (!remotePath.startsWith('/')) throw new Error('path must be an absolute POSIX path')
          const host = hostFor(url.searchParams.get('host') ?? undefined)
          const stats = await statRemote(host, remotePath)
          const data = await readRemote(host, remotePath, MAX_DOWNLOAD_BYTES)
          res.writeHead(200, {
            'content-type': 'application/octet-stream',
            'content-length': data.length,
            'content-disposition': `attachment; filename="${basename(remotePath).replace(/"/g, '')}"`,
            'cache-control': 'no-store',
          })
          res.end(data)
          ctx.logger.info(`ssh-panel: downloaded ${stats.size} bytes from ${host.alias}:${remotePath}`)
        } catch (error) {
          json(res, 400, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${API}/binding`,
      handler: endpoint('GET', async (req) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const directory = url.searchParams.get('path') ?? ''
        if (!/^[A-Za-z]:[\\/]/.test(directory)) throw new Error('path must be an absolute Windows workspace directory')
        let raw
        try {
          raw = await readFile(join(directory, BINDING_FILE), 'utf8')
        } catch {
          throw new Error(`workspace is not bound to an SSH host (no ${BINDING_FILE} in ${directory})`)
        }
        const binding = JSON.parse(raw)
        const host = hostFor(typeof binding.host === 'string' ? binding.host : undefined)
        // Self-healing: workspaces created before the tools were renamed still
        // carry instructions that name the retired mcp__ssh__* tools. The files
        // tab reads this endpoint on mount, so a stale file is rewritten here
        // rather than left to mislead the model.
        try {
          const instructionsPath = join(directory, INSTRUCTIONS_FILE)
          const stale = await readFile(instructionsPath, 'utf8')
          if (stale.includes('mcp__ssh__')) {
            await writeFile(instructionsPath, instructionsFor({
              host: host.alias,
              label: `${host.username}@${host.host}:${host.port}`,
              remoteRoot: typeof binding.remoteRoot === 'string' ? binding.remoteRoot : '',
            }), 'utf8')
            ctx.logger.info(`ssh-panel: refreshed stale instructions in ${directory}`)
          }
        } catch {
          // A missing or unreadable AGENTS.md is not this endpoint's problem.
        }
        return {
          host: host.alias,
          label: `${host.username}@${host.host}:${host.port}`,
          remoteRoot: typeof binding.remoteRoot === 'string' ? binding.remoteRoot : '',
        }
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${API}/ls`,
      handler: endpoint('GET', async (req) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const host = hostFor(url.searchParams.get('host') ?? undefined)
        const requested = url.searchParams.get('path') ?? '~'
        const absolute = await resolveRemotePath(host, requested)
        const entries = await listRemote(host, absolute)
        const parent = absolute === '/' ? '/' : absolute.replace(/\/[^/]+\/?$/, '') || '/'
        return { host: host.alias, path: absolute, parent, entries }
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${API}/read`,
      handler: endpoint('GET', async (req) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const host = hostFor(url.searchParams.get('host') ?? undefined)
        const requested = url.searchParams.get('path') ?? ''
        const absolute = await resolveRemotePath(host, requested)
        const data = await readRemote(host, absolute, MAX_PREVIEW_BYTES)
        if (data.includes(0)) throw new Error(`binary file, ${data.length} bytes — use download instead`)
        return { host: host.alias, path: absolute, bytes: data.length, text: data.toString('utf8') }
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${API}/workspace`,
      handler: endpoint('POST', async (req) => {
        const body = await readJson(req, 64 * 1024)
        const host = hostFor(typeof body.host === 'string' ? body.host : undefined)
        const requestedRoot = typeof body.remoteRoot === 'string' ? body.remoteRoot.trim() : ''
        if (requestedRoot !== '' && !requestedRoot.startsWith('/')) {
          throw new Error('remoteRoot must be an absolute POSIX path, e.g. /home/yicheng')
        }
        const directory = join(workspaceParent(ctx), workspaceSlug(host.alias))
        await mkdir(directory, { recursive: true })

        // Re-clicking the button without typing a root must not wipe the root a
        // previous click recorded.
        let previousRoot = ''
        try {
          const previous = JSON.parse(await readFile(join(directory, BINDING_FILE), 'utf8'))
          if (typeof previous.remoteRoot === 'string') previousRoot = previous.remoteRoot
        } catch {
          previousRoot = ''
        }

        const binding = {
          version: 1,
          host: host.alias,
          label: `${host.username}@${host.host}:${host.port}`,
          remoteRoot: requestedRoot !== '' ? requestedRoot : previousRoot,
          createdAt: new Date().toISOString(),
        }
        await writeFile(join(directory, BINDING_FILE), `${JSON.stringify(binding, null, 2)}\n`, 'utf8')
        const instructionsPath = join(directory, INSTRUCTIONS_FILE)
        let instructions = 'created'
        try {
          await readFile(instructionsPath, 'utf8')
          instructions = 'kept'
        } catch {
          await writeFile(instructionsPath, instructionsFor(binding), 'utf8')
        }

        // The registry call is deliberately left to the client: it owns the
        // Workspace snapshot, and a registration made behind its back would not
        // reach the sidebar until a page reload.
        ctx.logger.info(`ssh-panel: prepared remote workspace ${directory} for ${host.alias}`)
        return {
          path: directory,
          title: `${host.alias} (SSH)`,
          host: host.alias,
          label: binding.label,
          instructions,
        }
      }),
    }),
  ]
  for (const dispose of disposers) ctx.effect(() => dispose, 'ssh-panel: route')
  // The pooled ssh2 sessions outlive a tab; close them when the Host unloads
  // the entry so a reload does not leave connections behind.
  ctx.effect(() => closeAll, 'ssh-panel: connections')
  // Workspace-scoped tools: the model cannot name a host, so a Session can only
  // reach the server its workspace is bound to. A registration failure must not
  // take the panel down with it, so it is logged instead of thrown.
  try {
    registerTools(ctx)
  } catch (error) {
    ctx.logger.error?.(`ssh-panel: workspace-scoped tool registration failed, the panel keeps working: ${String(error)}`)
  }
  ctx.logger.info(`ssh-panel: endpoints registered at ${API} (v6, workspace-scoped tools)`)
}
