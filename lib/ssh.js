/**
 * SSH transport: a small pool of `ssh2` clients keyed by host alias, plus the
 * three operations the tools expose — run a command, upload a file, download a
 * file.
 *
 * Connections are lazy: the first call for an alias connects, later calls reuse
 * the same client until it closes. A closed or failed client is dropped from the
 * pool so the next call reconnects instead of returning a stale handle.
 *
 * @module dsh-mcp-ssh/ssh
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import ssh2 from 'ssh2'

const { Client } = ssh2

/** Output kept per stream before the tail (plus a notice) is all the model sees. */
const MAX_STREAM_CHARS = 60_000

/** One live connection per alias, shared by sequential calls. */
const pool = new Map()

/**
 * Expand a leading `~` in a path.
 * @param {string} value - configured path.
 * @returns {string} an absolute path.
 */
export function expandPath(value) {
  if (value === '') return value
  return value.replace(/^~(?=$|[\\/])/, () => homedir())
}

/**
 * Read the private key for a host, with a readable error when it is missing.
 * @param {object} host - normalized host.
 * @returns {Buffer} the key material.
 */
function readKey(host) {
  const path = expandPath(host.privateKeyPath)
  if (!existsSync(path)) {
    throw new Error(`private key for host "${host.alias}" not found: ${path}`)
  }
  return readFileSync(path)
}

/**
 * The first OpenSSH default identity that exists, so a host described only by
 * `Host`/`HostName`/`User` still connects the way `ssh` itself would.
 * @returns {string | undefined} an absolute key path, when one exists.
 */
function defaultIdentity() {
  for (const name of ['id_ed25519', 'id_rsa', 'id_ecdsa']) {
    const path = join(homedir(), '.ssh', name)
    if (existsSync(path)) return path
  }
  return undefined
}

/**
 * Passwords typed into the panel this process lifetime, keyed by alias. They
 * are never written to disk: a host without stored credentials asks each time
 * the Host starts.
 */
const runtimePasswords = new Map()

/**
 * Remember a password for the rest of this Host process.
 * @param {string} alias - host alias.
 * @param {string} password - the secret.
 * @returns {void}
 */
export function setRuntimePassword(alias, password) {
  runtimePasswords.set(alias, password)
}

/**
 * Forget a password that turned out to be wrong.
 * @param {string} alias - host alias.
 * @returns {void}
 */
export function clearRuntimePassword(alias) {
  runtimePasswords.delete(alias)
}

/**
 * Whether this host still needs a password before it can connect.
 * @param {object} host - normalized host.
 * @returns {boolean} true when nothing (key, stored password, or session password) can authenticate.
 */
export function needsPassword(host) {
  return (
    host.privateKeyPath === '' &&
    host.password === '' &&
    !runtimePasswords.has(host.alias) &&
    defaultIdentity() === undefined
  )
}

/**
 * Connect one client, resolving once the session is ready.
 * @param {object} host - normalized host.
 * @returns {Promise<import('ssh2').Client>} a ready client.
 */
async function connect(host) {
  const client = new Client()
  const options = {
    host: host.host,
    port: host.port,
    username: host.username,
    readyTimeout: host.connectTimeoutMs,
    keepaliveInterval: 15_000,
    keepaliveCountMax: 4,
  }
  const runtime = runtimePasswords.get(host.alias)
  if (host.privateKeyPath !== '') {
    options.privateKey = readKey(host)
    if (host.passphrase !== '') options.passphrase = host.passphrase
    // A key can still be refused; ssh2 falls through to the password when one
    // is offered alongside it.
    if (host.password !== '') options.password = host.password
    else if (runtime !== undefined) options.password = runtime
  } else if (host.password !== '') {
    options.password = host.password
  } else if (runtime !== undefined) {
    options.password = runtime
  } else {
    const fallback = defaultIdentity()
    if (fallback === undefined) {
      throw new Error(
        `host "${host.alias}" has no privateKeyPath and no password, and no default identity (~/.ssh/id_ed25519, id_rsa, id_ecdsa) exists`,
      )
    }
    options.privateKey = readFileSync(fallback)
  }
  options.tryKeyboard = true

  /** The fingerprint the server actually presented, for the error message. */
  let presented = ''
  options.hostVerifier = (key) => {
    const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
    presented = fingerprint
    if (host.hostKeySha256 !== '') return fingerprint === host.hostKeySha256
    // Without a pinned fingerprint the connection is accepted, but the
    // fingerprint is reported on failure so a person can pin it deliberately.
    return host.strictHostKey !== true
  }

  await new Promise((resolveReady, rejectReady) => {
    const fail = (error) => {
      client.removeAllListeners()
      try {
        client.end()
      } catch {
        // The client is already unusable; nothing to clean up.
      }
      const hint = presented === '' ? '' : ` (host key ${presented})`
      rejectReady(new Error(`SSH connect to ${host.username}@${host.host}:${host.port} failed: ${error.message}${hint}`))
    }
    client.once('ready', () => {
      client.removeListener('error', fail)
      client.on('error', () => pool.delete(host.alias))
      client.on('close', () => pool.delete(host.alias))
      resolveReady()
    })
    client.once('error', fail)
    client.connect(options)
  })
  return client
}

/**
 * Get the shared client for a host, connecting on first use.
 * @param {object} host - normalized host.
 * @returns {Promise<import('ssh2').Client>} a ready client.
 */
async function clientFor(host) {
  const live = pool.get(host.alias)
  if (live !== undefined) return live
  const connecting = connect(host)
  pool.set(host.alias, connecting)
  try {
    return await connecting
  } catch (error) {
    pool.delete(host.alias)
    throw error
  }
}

/**
 * Keep the tail of an over-long stream, marking the elision.
 * @param {string} text - accumulated output.
 * @returns {string} the text the model reads.
 */
function capStream(text) {
  if (text.length <= MAX_STREAM_CHARS) return text
  const dropped = text.length - MAX_STREAM_CHARS
  return `[${dropped} earlier characters dropped]\n${text.slice(-MAX_STREAM_CHARS)}`
}

/**
 * Run one command on a host and wait for its exit status.
 *
 * A non-zero exit is reported, not thrown: the model decides what a failure
 * means, exactly as the local shell tools do.
 * @param {object} host - normalized host.
 * @param {{ command: string, timeoutMs?: number, workdir?: string }} request - the command and its limits.
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number | null, signal: string | null, timedOut: boolean, durationMs: number }>}
 */
export async function execRemote(host, request) {
  const client = await clientFor(host)
  const timeoutMs = request.timeoutMs ?? 60_000
  const started = Date.now()
  const preamble = request.workdir !== undefined && request.workdir !== ''
    ? `cd ${JSON.stringify(request.workdir)} && `
    : ''
  const command = `${preamble}${request.command}`

  return await new Promise((resolveExec, rejectExec) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    client.exec(command, (error, stream) => {
      // ssh2 reports success with `err` undefined, not null.
      if (error) {
        rejectExec(new Error(`SSH exec failed on ${host.alias}: ${error.message}`))
        return
      }
      const timer = setTimeout(() => {
        timedOut = true
        // Ask the remote side to kill the process, then release the channel.
        try {
          stream.signal('KILL')
        } catch {
          // A channel that already closed needs no signal.
        }
        stream.close()
      }, timeoutMs)
      stream.on('data', (chunk) => {
        stdout += chunk.toString('utf8')
      })
      stream.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8')
      })
      stream.on('close', (code, signal) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolveExec({
          stdout: capStream(stdout),
          stderr: capStream(stderr),
          exitCode: typeof code === 'number' ? code : null,
          signal: signal ?? null,
          timedOut,
          durationMs: Date.now() - started,
        })
      })
    })
  })
}

/**
 * Open an SFTP channel for a host.
 * @param {import('ssh2').Client} client - a ready client.
 * @param {object} host - normalized host, for error messages.
 * @returns {Promise<import('ssh2').SFTPWrapper>} the channel.
 */
function sftpFor(client, host) {
  return new Promise((resolveSftp, rejectSftp) => {
    client.sftp((error, sftp) => {
      if (error) {
        rejectSftp(new Error(`SFTP channel on ${host.alias} failed: ${error.message}`))
        return
      }
      resolveSftp(sftp)
    })
  })
}

/**
 * Upload a local file to the remote host.
 * @param {object} host - normalized host.
 * @param {{ localPath: string, remotePath: string }} request - the two ends of the transfer.
 * @returns {Promise<{ bytes: number, durationMs: number }>} transfer facts.
 */
export async function uploadFile(host, request) {
  const localPath = resolve(expandPath(request.localPath))
  if (!existsSync(localPath) || statSync(localPath).isDirectory()) {
    throw new Error(`local path is not a readable file: ${localPath}`)
  }
  await mkdirRemote(host, dirnameOf(request.remotePath))
  const client = await clientFor(host)
  const sftp = await sftpFor(client, host)
  const started = Date.now()
  const bytes = statSync(localPath).size
  await new Promise((resolvePut, rejectPut) => {
    sftp.fastPut(localPath, request.remotePath, (error) => {
      if (error) {
        rejectPut(new Error(`upload to ${host.alias}:${request.remotePath} failed: ${error.message}`))
        return
      }
      resolvePut()
    })
  })
  sftp.end()
  return { bytes, durationMs: Date.now() - started, localPath, remotePath: request.remotePath }
}

/**
 * Download a remote file to the local machine.
 * @param {object} host - normalized host.
 * @param {{ remotePath: string, localPath: string }} request - the two ends of the transfer.
 * @returns {Promise<{ bytes: number, durationMs: number, localPath: string, remotePath: string }>} transfer facts.
 */
export async function downloadFile(host, request) {
  const localPath = resolve(expandPath(request.localPath))
  const client = await clientFor(host)
  const sftp = await sftpFor(client, host)
  const stats = await new Promise((resolveStat, rejectStat) => {
    sftp.stat(request.remotePath, (error, value) => {
      if (error) {
        rejectStat(new Error(`remote path is not readable on ${host.alias}: ${request.remotePath} (${error.message})`))
        return
      }
      resolveStat(value)
    })
  })
  const started = Date.now()
  await new Promise((resolveGet, rejectGet) => {
    sftp.fastGet(request.remotePath, localPath, (error) => {
      if (error) {
        rejectGet(new Error(`download from ${host.alias}:${request.remotePath} failed: ${error.message}`))
        return
      }
      resolveGet()
    })
  })
  sftp.end()
  return { bytes: stats.size, durationMs: Date.now() - started, localPath, remotePath: request.remotePath }
}

/**
 * The remote login directory, cached per alias for the life of the pool.
 * @param {object} host - normalized host.
 * @returns {Promise<string>} the absolute home path.
 */
const homeCache = new Map()
export async function remoteHome(host) {
  const cached = homeCache.get(host.alias)
  if (cached !== undefined) return cached
  const result = await execRemote(host, { command: 'printf %s "$HOME"', timeoutMs: 15_000 })
  const home = result.stdout.trim()
  if (home === '') throw new Error(`could not resolve $HOME on ${host.alias}: ${result.stderr.trim() || 'empty output'}`)
  homeCache.set(host.alias, home)
  return home
}

/**
 * Resolve a user-typed remote path: `~` and `~/…` expand against the login
 * directory, everything else is passed through as the absolute path it must be.
 * @param {object} host - normalized host.
 * @param {string} path - the path from a request.
 * @returns {Promise<string>} an absolute POSIX path.
 */
export async function resolveRemotePath(host, path) {
  if (path === '~') return await remoteHome(host)
  if (path.startsWith('~/')) return `${await remoteHome(host)}${path.slice(1)}`
  if (!path.startsWith('/')) throw new Error(`remote path must be absolute or start with ~: ${path}`)
  return path
}

/**
 * List one remote directory.
 * @param {object} host - normalized host.
 * @param {string} remotePath - absolute POSIX directory path.
 * @returns {Promise<Array<{ name: string, kind: 'directory' | 'file' | 'other', size: number, modifiedAt: number }>>} entries, directories first.
 */
export async function listRemote(host, remotePath) {
  const client = await clientFor(host)
  const sftp = await sftpFor(client, host)
  const entries = await new Promise((resolveList, rejectList) => {
    sftp.readdir(remotePath, (error, list) => {
      if (error) {
        rejectList(new Error(`cannot list ${host.alias}:${remotePath} (${error.message})`))
        return
      }
      resolveList(list)
    })
  })
  sftp.end()
  const rank = (kind) => (kind === 'directory' ? 0 : kind === 'file' ? 1 : 2)
  return entries
    .map((entry) => {
      const attributes = entry.attrs ?? {}
      const mode = attributes.mode ?? 0
      const isDirectory =
        typeof attributes.isDirectory === 'function' ? attributes.isDirectory() : (mode & 0o170000) === 0o040000
      const isFile = typeof attributes.isFile === 'function' ? attributes.isFile() : (mode & 0o170000) === 0o100000
      return {
        name: entry.filename,
        kind: isDirectory ? 'directory' : isFile ? 'file' : 'other',
        size: attributes.size ?? 0,
        modifiedAt: (attributes.mtime ?? 0) * 1000,
      }
    })
    .sort((left, right) => rank(left.kind) - rank(right.kind) || left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }))
}

/**
 * `stat` a remote path.
 * @param {object} host - normalized host.
 * @param {string} remotePath - absolute POSIX path.
 * @returns {Promise<{ size: number, mode: number, isDirectory: boolean }>} the entry.
 */
export async function statRemote(host, remotePath) {
  const client = await clientFor(host)
  const sftp = await sftpFor(client, host)
  const stats = await new Promise((resolveStat, rejectStat) => {
    sftp.stat(remotePath, (error, value) => {
      if (error) {
        rejectStat(new Error(`remote path is not readable on ${host.alias}: ${remotePath} (${error.message})`))
        return
      }
      resolveStat(value)
    })
  })
  sftp.end()
  return { size: stats.size, mode: stats.mode, isDirectory: stats.isDirectory() }
}

/**
 * Read a remote file into memory for an HTTP response.
 * @param {object} host - normalized host.
 * @param {string} remotePath - absolute POSIX path.
 * @param {number} maxBytes - refusal threshold, so a stray 10 GB file cannot exhaust the Host.
 * @returns {Promise<Buffer>} the file contents.
 */
export async function readRemote(host, remotePath, maxBytes) {
  const stats = await statRemote(host, remotePath)
  if (stats.isDirectory) throw new Error(`remote path is a directory: ${remotePath}`)
  if (stats.size > maxBytes) {
    throw new Error(`remote file is ${stats.size} bytes, over the ${maxBytes}-byte limit for browser downloads`)
  }
  const client = await clientFor(host)
  const sftp = await sftpFor(client, host)
  const buffer = await new Promise((resolveRead, rejectRead) => {
    sftp.readFile(remotePath, (error, data) => {
      if (error) {
        rejectRead(new Error(`read ${host.alias}:${remotePath} failed: ${error.message}`))
        return
      }
      resolveRead(data)
    })
  })
  sftp.end()
  return buffer
}

/**
 * Write bytes to a remote file from a browser upload.
 * @param {object} host - normalized host.
 * @param {string} remotePath - absolute POSIX path.
 * @param {Buffer} data - the file contents.
 * @returns {Promise<{ bytes: number }>} the written size.
 */
export async function writeRemote(host, remotePath, data) {
  await mkdirRemote(host, dirnameOf(remotePath))
  const client = await clientFor(host)
  const sftp = await sftpFor(client, host)
  await new Promise((resolveWrite, rejectWrite) => {
    sftp.writeFile(remotePath, data, (error) => {
      if (error) {
        rejectWrite(new Error(`write ${host.alias}:${remotePath} failed: ${error.message}`))
        return
      }
      resolveWrite()
    })
  })
  sftp.end()
  return { bytes: data.length }
}

/**
 * `mkdir -p` a remote directory over SFTP, ignoring "already exists".
 * @param {object} host - normalized host.
 * @param {string} directory - absolute remote directory.
 * @returns {Promise<void>} resolves once the directory exists.
 */
export async function mkdirRemote(host, directory) {
  if (directory === '' || directory === '.' || directory === '/') return
  const client = await clientFor(host)
  const sftp = await sftpFor(client, host)
  const segments = directory.split('/').filter(Boolean)
  let current = ''
  for (const segment of segments) {
    current += `/${segment}`
    await new Promise((resolveMkdir) => {
      sftp.mkdir(current, () => resolveMkdir())
    })
  }
  sftp.end()
}

/**
 * The parent directory of a POSIX path.
 * @param {string} path - a remote path.
 * @returns {string} its parent, or '' for a bare filename.
 */
function dirnameOf(path) {
  const index = path.lastIndexOf('/')
  return index <= 0 ? (index === 0 ? '/' : '') : path.slice(0, index)
}

/**
 * Close every pooled connection; used on shutdown.
 * @returns {void}
 */
export function closeAll() {
  for (const entry of pool.values()) {
    Promise.resolve(entry)
      .then((client) => client.end())
      .catch(() => {})
  }
  pool.clear()
}
