/**
 * Host configuration: an explicit JSON file plus the user's own `~/.ssh/config`.
 *
 * Precedence, lowest first: `~/.ssh/config` global defaults, its `Host` blocks,
 * then the explicit JSON file. `${ENV_NAME}` references are expanded from the
 * server process environment so secrets can stay out of the file.
 *
 * @module dsh-mcp-ssh/config
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Home directory, used for `~` expansion. */
const HOME = homedir()

/** The JSON file this server reads unless `DSH_SSH_HOSTS` points elsewhere. */
export const DEFAULT_HOSTS_FILE = join(HOME, '.dsh', 'ssh-hosts.json')

/**
 * Expand `~`, `${ENV}` and `%ENV%` in a string value.
 * @param {unknown} value - raw configuration value.
 * @returns {unknown} the expanded value; non-strings pass through untouched.
 */
export function expand(value) {
  if (typeof value !== 'string') return value
  let out = value.replace(/^~(?=$|[\\/])/, () => HOME)
  out = out.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name) =>
    process.env[name] === undefined ? match : process.env[name],
  )
  out = out.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (match, name) =>
    process.env[name] === undefined ? match : process.env[name],
  )
  return out
}

/**
 * Parse the literal `Host` blocks of an OpenSSH client config.
 *
 * Only the directives this server needs are read; wildcard patterns, `Match`
 * and `Include` are ignored on purpose, since the explicit JSON file is the
 * supported way to describe hosts with non-trivial needs.
 * @param {string} text - the config file contents.
 * @returns {Map<string, object>} host alias to its directives.
 */
export function parseSshConfig(text) {
  const hosts = new Map()
  const defaults = {}
  let current = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const match = /^(\S+?)(?:\s*=\s*|\s+)(.*)$/.exec(line)
    if (match === null) continue
    const key = match[1].toLowerCase()
    const value = match[2].trim()
    if (key === 'host') {
      const patterns = value.split(/\s+/).filter(Boolean)
      current = patterns.length === 1 && !/[*?!]/.test(patterns[0]) ? patterns[0] : null
      if (current !== null && !hosts.has(current)) hosts.set(current, { ...defaults })
      continue
    }
    const target = current === null ? defaults : hosts.get(current)
    if (current !== null && target === undefined) continue
    if (key === 'hostname') target.host = value
    else if (key === 'user') target.username = value
    else if (key === 'port') target.port = Number.parseInt(value, 10)
    else if (key === 'identityfile') target.privateKeyPath = value
    else if (key === 'proxyjump') target.jump = value
  }
  return hosts
}

/**
 * A `${NAME}` reference whose variable is unset expands to nothing useful, so
 * it must not be passed to ssh2 as a literal password or passphrase.
 * @param {unknown} value - expanded value.
 * @returns {string} the value, or '' when it is still an unexpanded reference.
 */
function resolvedSecret(value) {
  const text = typeof value === 'string' ? value : ''
  return /^\$\{[^}]*\}$/.test(text) ? '' : text
}

/**
 * Normalize one host entry: expand values, coerce the port, and default the
 * username so a broken entry fails with a readable message at use time.
 * @param {string} alias - host alias the model will name.
 * @param {Record<string, unknown>} raw - the entry as configured.
 * @returns {object} the normalized host.
 */
function normalizeHost(alias, raw) {
  const host = {
    alias,
    host: expand(raw.host ?? alias),
    port: Number.isFinite(Number(raw.port)) ? Number(raw.port) : 22,
    username: expand(raw.username ?? raw.user ?? process.env.USERNAME ?? 'root'),
    privateKeyPath: expand(raw.privateKeyPath ?? raw.identityFile ?? ''),
    password: resolvedSecret(expand(raw.password ?? '')),
    passphrase: resolvedSecret(expand(raw.passphrase ?? '')),
    defaultWorkdir: expand(raw.defaultWorkdir ?? ''),
    strictHostKey: raw.strictHostKey === true,
    hostKeySha256: expand(raw.hostKeySha256 ?? ''),
    jump: expand(raw.jump ?? ''),
    connectTimeoutMs: Number.isFinite(Number(raw.connectTimeoutMs)) ? Number(raw.connectTimeoutMs) : 10_000,
  }
  if (host.jump !== '') {
    throw new Error(`host "${alias}": jump hosts are not supported by this server yet`)
  }
  return host
}

/**
 * Load every host this server can reach.
 * @param {string} [hostsFile] - explicit file path; defaults to `DSH_SSH_HOSTS` or `~/.dsh/ssh-hosts.json`.
 * @returns {{ hosts: Map<string, object>, defaultHost: string | undefined, source: string, warnings: string[] }}
 * @throws {Error} when the file exists but is not valid JSON, or an entry is unusable.
 */
export function loadHosts(hostsFile) {
  const file = hostsFile ?? process.env.DSH_SSH_HOSTS ?? DEFAULT_HOSTS_FILE
  const warnings = []
  const merged = new Map()

  const sshConfigPath = join(HOME, '.ssh', 'config')
  if (existsSync(sshConfigPath)) {
    try {
      for (const [alias, directives] of parseSshConfig(readFileSync(sshConfigPath, 'utf8'))) {
        merged.set(alias, { ...directives })
      }
    } catch (error) {
      warnings.push(`could not read ${sshConfigPath}: ${String(error)}`)
    }
  }

  let defaultHost
  if (existsSync(file)) {
    let parsed
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      throw new Error(`hosts file ${file} is not valid JSON: ${String(error)}`)
    }
    const entries = parsed?.hosts ?? {}
    for (const [alias, raw] of Object.entries(entries)) {
      merged.set(alias, { ...(merged.get(alias) ?? {}), ...raw })
    }
    defaultHost = parsed?.defaultHost
  } else {
    warnings.push(`hosts file not found: ${file}`)
  }

  const hosts = new Map()
  for (const [alias, raw] of merged) {
    try {
      hosts.set(alias, normalizeHost(alias, raw))
    } catch (error) {
      warnings.push(String(error instanceof Error ? error.message : error))
    }
  }
  if (hosts.size === 0) {
    throw new Error(
      `no usable SSH hosts: ${warnings.join('; ') || 'add one to ' + file}`,
    )
  }
  const resolvedDefault = defaultHost !== undefined && hosts.has(defaultHost)
    ? defaultHost
    : [...hosts.keys()][0]
  return { hosts, defaultHost: resolvedDefault, source: file, warnings }
}
