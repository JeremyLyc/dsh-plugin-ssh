/**
 * End-to-end smoke test: start the server exactly as dsh-mcp-client would
 * (stdio child process), handshake, list tools, then call each one against the
 * configured default host.
 *
 * Run with: node test/smoke.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [new URL('../server.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
  stderr: 'inherit',
})

const client = new Client({ name: 'smoke', version: '0.0.0' })
await client.connect(transport)

const { tools } = await client.listTools()
console.log('tools:', tools.map((tool) => tool.name).join(', '))

const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args })
  const text = result.content.map((block) => block.text ?? '').join('\n')
  console.log(`\n--- ${name} ${JSON.stringify(args)} ---`)
  console.log(text)
  return result
}

await call('ssh_hosts', {})
await call('ssh_exec', { command: 'hostname; whoami; uname -sr; pwd' })
await call('ssh_exec', { command: 'echo hello > /tmp/dsh-ssh-smoke.txt && cat /tmp/dsh-ssh-smoke.txt' })
await call('ssh_exec', { command: 'ls /definitely-not-a-directory' })
await call('ssh_exec', { command: 'sleep 5', timeoutMs: 1500 })

const localFile = `${process.env.TEMP ?? '/tmp'}\\dsh-ssh-smoke-local.txt`
const remoteFile = '/tmp/dsh-ssh-smoke-local.txt'
const roundTrip = `${process.env.TEMP ?? '/tmp'}\\dsh-ssh-smoke-roundtrip.txt`
writeFileSync(localFile, `round-trip ${new Date().toISOString()}\n`)
await call('ssh_upload', { localPath: localFile, remotePath: remoteFile })
await call('ssh_exec', { command: `wc -c ${remoteFile}; cat ${remoteFile}` })
await call('ssh_download', { remotePath: remoteFile, localPath: roundTrip })
console.log(`\nround-trip matches: ${readFileSync(localFile, 'utf8') === readFileSync(roundTrip, 'utf8')}`)
await call('ssh_exec', { command: `rm -f ${remoteFile}` })
await client.close()
process.exit(0)
