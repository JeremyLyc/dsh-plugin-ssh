/**
 * Exercise the Host half's route handlers without the web server: register into
 * a fake `ctx.webServer`, then invoke each handler with a fake request/response.
 *
 * This is the layer between the browser and ssh2, so a green run means the panel
 * has a working backend even before the page is opened.
 *
 * The remote checks need a host alias from your own `~/.dsh/ssh-hosts.json`:
 *
 *   DSH_SSH_TEST_HOST=my-server node test/host-api.mjs
 *   DSH_SSH_TEST_PASSWORD_HOST=my-password-host node test/host-api.mjs
 *
 * Without them the script only prints the guidance and exits 0.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { closeAll } from '../lib/ssh.js'

const HOST = process.env.DSH_SSH_TEST_HOST ?? ''
const PASSWORD_HOST = process.env.DSH_SSH_TEST_PASSWORD_HOST ?? ''
if (HOST === '') {
  console.log('skip: set DSH_SSH_TEST_HOST to a configured host alias, e.g. DSH_SSH_TEST_HOST=my-server node test/host-api.mjs')
  process.exit(0)
}
const hostQuery = encodeURIComponent(HOST)

/** Workspaces live under a temp root in this test, not under the person's Documents. */
process.env.DSH_SSH_WORKSPACE_ROOT = mkdtempSync(join(tmpdir(), 'ssh-panel-ws-'))

const routes = new Map()
const fakeCtx = {
  webServer: {
    register(route) {
      routes.set(`${route.kind} ${route.path}`, route)
      return () => routes.delete(`${route.kind} ${route.path}`)
    },
  },
  effect(fn) {
    fn()
  },
  logger: { info() {}, warn() {}, error() {} },
  // These tests drive the HTTP routes only; the tool registry is stubbed so the
  // plugin's apply() can register its workspace-scoped tools harmlessly.
  tools: { register() { return () => {} } },
  workingDirectory: { async ensure() { return process.cwd() } },
}

apply(fakeCtx)
console.log('routes:', [...routes.keys()].join('\n        '))

/** Minimal `IncomingMessage` stand-in: method, url, loopback socket, JSON body. */
function request(method, url, body) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  return {
    method,
    url,
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      yield* payload
    },
  }
}

/** Minimal `ServerResponse` stand-in that records status, headers and body. */
function response() {
  const captured = { status: 0, headers: {}, body: undefined }
  return {
    captured,
    writeHead(status, headers) {
      captured.status = status
      captured.headers = headers ?? {}
    },
    end(body) {
      captured.body = body
    },
  }
}

/** Call one route and decode its JSON answer; the query string stays on the request URL. */
async function invoke(kind, path, method, body) {
  const route = routes.get(`${kind} ${path.split('?')[0]}`)
  if (route === undefined) throw new Error(`route not registered: ${kind} ${path}`)
  const res = response()
  await route.handler(request(method, path, body), res)
  const text =
    typeof res.captured.body === 'string'
      ? res.captured.body
      : Buffer.isBuffer(res.captured.body)
        ? res.captured.body.toString('utf8')
        : String(res.captured.body)
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = text
  }
  return { status: res.captured.status, parsed }
}

const hosts = await invoke('exact', '/ssh-panel/api/hosts', 'GET')
console.log('\nGET /hosts ->', hosts.status, JSON.stringify(hosts.parsed).slice(0, 300))

const exec = await invoke('exact', '/ssh-panel/api/exec', 'POST', { host: HOST, command: 'hostname; whoami; echo $((6*7))' })
console.log('\nPOST /exec ->', exec.status)
console.log(exec.parsed.stdout ?? exec.parsed.error, '| exit', exec.parsed.exitCode, '|', exec.parsed.durationMs, 'ms')

const denied = await invoke('exact', '/ssh-panel/api/exec', 'GET')
console.log('\nGET /exec (wrong method) ->', denied.status, JSON.stringify(denied.parsed))

const unknown = await invoke('exact', '/ssh-panel/api/exec', 'POST', { command: 'hostname', host: 'no-such-host' })
console.log('POST /exec unknown host ->', unknown.status, JSON.stringify(unknown.parsed).slice(0, 160))

const upload = await invoke('exact', '/ssh-panel/api/upload', 'POST', {
  host: HOST,
  remotePath: '/tmp/ssh-panel-api-test.txt',
  dataBase64: Buffer.from('panel upload works\n', 'utf8').toString('base64'),
})
console.log('\nPOST /upload ->', upload.status, JSON.stringify(upload.parsed))

const verify = await invoke('exact', '/ssh-panel/api/exec', 'POST', {
  host: HOST,
  command: 'cat /tmp/ssh-panel-api-test.txt; rm -f /tmp/ssh-panel-api-test.txt',
})
console.log('verify upload ->', verify.parsed.stdout?.trim(), '| exit', verify.parsed.exitCode)

if (exec.status !== 200 || upload.status !== 200 || denied.status !== 405) throw new Error('unexpected status')

// --- workspace binding + files endpoints ---------------------------------
const workspace = await invoke('exact', '/ssh-panel/api/workspace', 'POST', { host: HOST, remoteRoot: '/' })
console.log('\nPOST /workspace ->', workspace.status, JSON.stringify(workspace.parsed))
if (workspace.status !== 200) throw new Error('workspace creation failed')
const bindingPath = join(workspace.parsed.path, '.dsh-ssh-workspace.json')
const instructionsPath = join(workspace.parsed.path, 'AGENTS.md')
if (!existsSync(bindingPath) || !existsSync(instructionsPath)) throw new Error('binding files missing')
const binding = JSON.parse(readFileSync(bindingPath, 'utf8'))
const instructions = readFileSync(instructionsPath, 'utf8')
console.log('binding ->', JSON.stringify(binding))
console.log('AGENTS.md ->', instructions.split('\n').length, 'lines; names the host:', instructions.includes(HOST))
if (binding.host !== HOST || !instructions.includes('ssh_exec') || instructions.includes('mcp__ssh__')) throw new Error('binding content wrong')

// A workspace written by the MCP-era plugin carries instructions that name the
// retired mcp__ssh__* tools; reading the binding must heal them.
writeFileSync(instructionsPath, '# 远程工作区\n\n跑命令：`mcp__ssh__ssh_exec` 并传 `host`\n', 'utf8')
const healed = await invoke('exact', `/ssh-panel/api/binding?path=${encodeURIComponent(workspace.parsed.path)}`, 'GET')
const healedText = readFileSync(instructionsPath, 'utf8')
console.log('\nstale instructions healed:', !healedText.includes('mcp__ssh__'), '| mentions ssh_exec:', healedText.includes('ssh_exec'))
if (healed.status !== 200) throw new Error('binding read failed during the migration check')
if (healedText.includes('mcp__ssh__')) throw new Error('stale instructions were not refreshed')

const bound = await invoke('exact', `/ssh-panel/api/binding?path=${encodeURIComponent(workspace.parsed.path)}`, 'GET')
console.log('\nGET /binding ->', bound.status, JSON.stringify(bound.parsed))
if (bound.parsed.host !== HOST) throw new Error('binding did not resolve the host')

const unbound = await invoke('exact', `/ssh-panel/api/binding?path=${encodeURIComponent(tmpdir())}`, 'GET')
console.log('GET /binding (unbound dir) ->', unbound.status, JSON.stringify(unbound.parsed).slice(0, 120))
if (unbound.status !== 400) throw new Error('unbound directory should be rejected')

const home = await invoke('exact', `/ssh-panel/api/ls?host=${hostQuery}&path=~`, 'GET')
console.log('\nGET /ls ~ ->', home.status, home.parsed.path, 'entries:', home.parsed.entries?.length)
if (home.status !== 200 || !Array.isArray(home.parsed.entries)) throw new Error('ls failed')
if (!String(home.parsed.path).startsWith('/')) throw new Error('~ was not expanded to an absolute path')

const etc = await invoke('exact', `/ssh-panel/api/ls?host=${hostQuery}&path=/etc`, 'GET')
const entries = etc.parsed.entries ?? []
const firstFile = entries.findIndex((entry) => entry.kind !== 'directory')
const dirsFirst = entries.slice(0, Math.max(firstFile, 0)).every((entry) => entry.kind === 'directory')
console.log('GET /ls /etc ->', etc.status, 'entries:', entries.length, 'dirs first:', dirsFirst)
if (!dirsFirst) throw new Error('directories are not listed first')

const text = await invoke('exact', `/ssh-panel/api/read?host=${hostQuery}&path=/etc/os-release`, 'GET')
console.log('\nGET /read /etc/os-release ->', text.status, text.parsed.bytes, 'bytes')
console.log('first line:', String(text.parsed.text ?? '').split('\n')[0])
if (text.status !== 200 || !String(text.parsed.text).includes('PRETTY_NAME')) throw new Error('read did not return the file')

const binary = await invoke('exact', `/ssh-panel/api/read?host=${hostQuery}&path=/bin/ls`, 'GET')
console.log('GET /read /bin/ls ->', binary.status, JSON.stringify(binary.parsed).slice(0, 120))
if (binary.status !== 400) throw new Error('binary read should be rejected')

// --- connection: stored credentials skip the password, missing ones ask ----
const keyConnect = await invoke('exact', '/ssh-panel/api/connect', 'POST', { host: HOST })
console.log('\nPOST /connect (configured host) ->', keyConnect.status, JSON.stringify(keyConnect.parsed))
if (keyConnect.status !== 200 || keyConnect.parsed.ok !== true) {
  throw new Error('a host with stored credentials should connect without a password')
}

if (PASSWORD_HOST !== '') {
  const needsPassword = await invoke('exact', '/ssh-panel/api/connect', 'POST', { host: PASSWORD_HOST })
  console.log('POST /connect (no credentials) ->', needsPassword.status, JSON.stringify(needsPassword.parsed))
  if (needsPassword.status !== 400 || needsPassword.parsed.needsPassword !== true) {
    throw new Error('a host without stored credentials should ask for a password')
  }
  const wrongPassword = await invoke('exact', '/ssh-panel/api/connect', 'POST', { host: PASSWORD_HOST, password: 'not-the-password' })
  console.log('POST /connect (wrong password) ->', wrongPassword.status, JSON.stringify(wrongPassword.parsed))
  if (wrongPassword.status !== 400 || wrongPassword.parsed.needsPassword !== true) {
    throw new Error('a rejected password should keep asking')
  }
}

// --- switching the working directory -------------------------------------
const switched = await invoke('exact', '/ssh-panel/api/root', 'POST', { path: workspace.parsed.path, remoteRoot: '/var/log' })
console.log('\nPOST /root ->', switched.status, JSON.stringify(switched.parsed))
if (switched.status !== 200 || switched.parsed.remoteRoot !== '/var/log') throw new Error('root switch failed')

const rebound = JSON.parse(readFileSync(bindingPath, 'utf8'))
if (rebound.remoteRoot !== '/var/log') throw new Error('binding file did not follow the switch')

const instructionsAfter = readFileSync(instructionsPath, 'utf8')
const blocks = instructionsAfter.split('<!-- dsh-ssh:root -->').length - 1
console.log('AGENTS.md root blocks:', blocks, '| mentions /var/log:', instructionsAfter.includes('/var/log'))
if (blocks !== 1) throw new Error('the root block should appear exactly once')

await invoke('exact', '/ssh-panel/api/root', 'POST', { path: workspace.parsed.path, remoteRoot: '/var/tmp' })
const twice = readFileSync(instructionsPath, 'utf8')
const blocksTwice = twice.split('<!-- dsh-ssh:root -->').length - 1
console.log('after second switch -> blocks:', blocksTwice, '| /var/log left:', twice.includes('/var/log'), '| /var/tmp:', twice.includes('/var/tmp'))
if (blocksTwice !== 1) throw new Error('repeated switches should replace, not append')
if (twice.includes('/var/log')) throw new Error('the previous root should be gone')

closeAll()
console.log('\nOK: host endpoints behave')
