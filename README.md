# dsh-plugin-ssh

[![GitHub stars](https://img.shields.io/github/stars/JeremyLyc/dsh-plugin-ssh?style=social)](https://github.com/JeremyLyc/dsh-plugin-ssh/stargazers)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)

**把一台远端 Linux 服务器变成 DeepSeek Harness 里的"工作区"**：agent 用对话操作服务器，你在侧栏里浏览它的目录、传文件、切换工作目录。

> SSH remote workspaces for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). One plugin gives you
> agent tools (`mcp__ssh__*`), a sidebar panel, a server-files tab, a workspace bound to a remote
> directory, and a composer pill showing where the agent is actually working.

---

## 这个插件做什么

DSH 的工作区必须是一个**真实存在的本地目录**，而 agent 真正要干活的是远端服务器。这个插件在两者之间架一座桥：

```
          ┌─────────────────────────── DSH Host 进程 ───────────────────────────┐
          │                                                                     │
  浏览器  │  lib/index.js  ── HTTP /ssh-panel/api/* ──►  lib/ssh.js  ── ssh2 ──► 服务器
 （面板） │       │                                         ▲                    │
          │       └─ 写绑定 + AGENTS.md                      │                    │
          │                                                 │                    │
          │  server.mjs（MCP stdio）── mcp__ssh__* 工具 ────┘                    │
          └─────────────────────────────────────────────────────────────────────┘
```

- **会话工具**：`mcp__ssh__ssh_exec` / `ssh_upload` / `ssh_download` / `ssh_hosts`，模型直接调用。
- **左侧栏 `SSH 远程` 面板**：选主机、跑命令、传文件、一键建远程工作区。
- **右侧栏「服务器文件」页签**：浏览服务器任意目录、预览文本、切换工作目录。
- **远程工作区**：本地占位目录 + `.dsh-ssh-workspace.json` 绑定 + 自动生成的 `AGENTS.md`，
  该工作区里的每个会话都确切知道"我在哪台机器、在哪个目录、用哪个工具"。
- **密码弹窗**：主机没有预置密钥/密码时才问，密码只活在 Host 进程内存里。
- **输入框下方的当前目录 pill**：`prod:/srv/app` 或本地工作区路径，切目录即时跟随。

## 截图

![在 DSH 里用对话操作服务器：右侧是服务器文件页签，输入框下方是状态栏](docs/screenshots/session.png)

## 安装

前置：DSH 桌面版（profile 目录 `~/.dsh/profiles/desktop`）、Node.js 20+。

```bash
# 1. 放进插件目录
git clone https://github.com/JeremyLyc/dsh-plugin-ssh ~/.dsh/plugins/dsh-plugin-ssh
cd ~/.dsh/plugins/dsh-plugin-ssh && npm install --omit=dev

# 2. 让 profile 能解析这个包
cd ~/.dsh/profiles/desktop
pnpm add "link:$HOME/.dsh/plugins/dsh-plugin-ssh" --ignore-scripts
```

3. 面板部分走包自带的 bundle 补丁：把包名加进 `dsh.profile.bundles`（`package.json` 里的
   `dsh.bundle.patch` 指向 `cordis.patch.yml`，它会插入 `ssh-panel` 条目）：

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-plugin-ssh"]
    }
  }
}
```

4. 会话工具需要一条显式条目（要绝对路径指向 `server.mjs`），追加到
   `~/.dsh/profiles/desktop/cordis.patch.yml`：

```yaml
- insert:
    - id: mcp-ssh                      # 会话工具：MCP stdio 服务器
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: ssh
        transport: stdio
        command: node
        args:
          - '<插件目录>/server.mjs'
        env:
          DSH_SSH_HOSTS: '<你的 ssh-hosts.json>'
        toolCallTimeoutMs: 300000
        failOnStartupError: false
```

保存即热加载；日志出现 `ssh-panel: endpoints registered at /ssh-panel/api` 就绪。客户端 bundle
改动需要刷新窗口。

## 配置主机

`~/.dsh/ssh-hosts.json`（可用 `DSH_SSH_HOSTS` 指定路径），会与你的 `~/.ssh/config` 合并：

```json
{
  "defaultHost": "prod",
  "hosts": {
    "prod": {
      "host": "10.0.0.10",
      "port": 22,
      "username": "deploy",
      "privateKeyPath": "~/.ssh/id_ed25519",
      "remoteRoot": "/srv/app"
    },
    "legacy": {
      "host": "10.0.0.11",
      "username": "ops",
      "password": "${LEGACY_SSH_PASSWORD}"
    }
  }
}
```

| 字段 | 说明 |
|---|---|
| `host` / `port` / `username` | 连接目标，`username` 也可写 `user` |
| `privateKeyPath` | 私钥路径，支持 `~`；不填且没密码时回退 `id_ed25519` → `id_rsa` → `id_ecdsa` |
| `password` / `passphrase` | 密码 / 私钥口令；支持 `${ENV}`，未设置的环境变量按"没有"处理 |
| `hostKeySha256` | 钉住主机指纹（`SHA256:...`），填了就严格校验 |
| `strictHostKey` | `true` 时拒绝未钉住指纹的主机 |
| `connectTimeoutMs` | 连接超时，默认 10000 |

**密码策略**：配置里有密钥或密码 → 连接时不再询问；都没有 → 面板弹密码框，密码只存在
Host 进程内存（`setRuntimePassword`），**不写任何文件**，DSH 重启后重新问。

## 工具

| 工具 | 作用 |
|---|---|
| `mcp__ssh__ssh_hosts` | 列主机、默认主机、认证方式 |
| `mcp__ssh__ssh_exec` | 执行命令，返回 stdout/stderr/退出码，`workdir`/`timeoutMs` 可选 |
| `mcp__ssh__ssh_upload` | 本地文件 → 远端（SFTP，自动建父目录） |
| `mcp__ssh__ssh_download` | 远端文件 → 本地（SFTP） |

非零退出码以 `[exit code: N]` 返回，不算工具错误；超时会向远端发 `KILL` 并标 `[timed out after Nms]`。

## HTTP 端点

全部 `kind: exact`，只接受本机/渲染进程请求，且拒绝来自非回环地址的调用：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/ssh-panel/api/hosts` | 主机列表与告警 |
| POST | `/ssh-panel/api/connect` | `{host, password?}` → 验连；缺凭据回 `needsPassword` |
| POST | `/ssh-panel/api/exec` | 执行命令 |
| POST | `/ssh-panel/api/upload` | base64 上传 |
| GET | `/ssh-panel/api/download` | 下载（≤64 MB） |
| POST | `/ssh-panel/api/workspace` | 建绑定目录 + `AGENTS.md` |
| GET | `/ssh-panel/api/binding` | 读工作区绑定 |
| POST | `/ssh-panel/api/root` | 切换远端工作目录（改写绑定与 `AGENTS.md`） |
| GET | `/ssh-panel/api/ls` | 列一层目录（目录优先） |
| GET | `/ssh-panel/api/read` | 读文本（≤512 KB，二进制拒绝） |

## 远程工作区是怎么"绑定"的

创建时在本地目录写两份文件，`AGENTS.md` 里用标记包住工作目录块：

```md
<!-- dsh-ssh:root -->
远端工作目录：`/srv/app`。所有远端命令都以它为工作目录，`mcp__ssh__ssh_exec` 请显式传 `workdir: "/srv/app"`。
<!-- /dsh-ssh:root -->
```

切换目录只替换标记内的内容，不重复追加，也不动你手写的其它说明。

## 开发

```bash
npm install
# 需要一台已配置在 ~/.dsh/ssh-hosts.json 里的主机
DSH_SSH_TEST_HOST=prod node test/host-api.mjs
DSH_SSH_TEST_HOST=prod DSH_SSH_TEST_PASSWORD_HOST=legacy node test/host-api.mjs
node test/smoke.mjs   # MCP stdio 全链路：握手 → tools/list → 执行 → 上传下载往返
```

`lib/client.js` 是**手写**的浏览器 bundle（DSH 的模块格式：`window.__ModuleLoader__.load({id, factory})`），
没有构建步骤；改完刷新窗口即可。`lib/index.js` 是 Host 半侧，改动会随插件条目重新加载。

## 安全说明

- 面板能执行任意命令，请把它当成 `ssh` 本身：**只在本机使用**，端点拒绝非回环来源。
- 密码不落盘；`ssh-hosts.json` 里若写密码，注意该文件的权限。
- 命令输出与文件内容会进入模型上下文，敏感数据请自行判断。
- 上传/下载上限：64 MB（下载）/ 96 MB（请求体）。

## 兼容性

在 DSH Desktop `0.2.1-rc.3`（`dsh-mcp-client`、`sidebar.panellist`、`conversation.composer.dock` 等
slot 均有）上验证；依赖 `ssh2`、`@modelcontextprotocol/sdk`、`zod`。

## License

[MIT](LICENSE) © 2026 JeremyLyc
