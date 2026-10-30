window.__ModuleLoader__.load({
	id: "dsh-mcp-ssh",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const h = react.createElement;

		/** Sidebar row id; the same id keys this plugin's `main` panel. */
		const PANEL_ID = "ssh-panel";
		/** Where the Host plugin serves the panel's JSON endpoints. */
		const API = "/ssh-panel/api";

		const css = `
.sshPanel{box-sizing:border-box;height:100%;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base,var(--dsw-alias-bg-layer-1,#fff));font-size:13px}
.sshPanel-head{display:flex;align-items:center;gap:10px;padding:16px clamp(16px,3vw,32px) 12px;border-bottom:1px solid var(--dsw-alias-border-l4);flex:none}
.sshPanel-title{font-size:15px;font-weight:600;margin:0;white-space:nowrap}
.sshPanel-spacer{flex:1}
.sshPanel-select,.sshPanel-input,.sshPanel-textarea{font:inherit;color:inherit;background:var(--dsw-alias-bg-l2);border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);padding:6px 8px;box-sizing:border-box}
.sshPanel-select:focus-visible,.sshPanel-input:focus-visible,.sshPanel-textarea:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}
.sshPanel-button{font:inherit;cursor:pointer;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);padding:6px 14px;white-space:nowrap}
.sshPanel-button:hover{background:var(--dsw-alias-button-floating-hover)}
.sshPanel-button:disabled{opacity:.5;cursor:default}
.sshPanel-button.primary{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:#fff}
.sshPanel-tabs{display:flex;gap:4px;padding:10px clamp(16px,3vw,32px) 0;flex:none}
.sshPanel-tab{font:inherit;cursor:pointer;border:none;background:0 0;color:var(--dsw-alias-label-secondary);padding:6px 12px;border-radius:var(--dsw-radius-sm)}
.sshPanel-tab[aria-selected=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.sshPanel-body{min-height:0;flex:1;display:flex;flex-direction:column;gap:10px;padding:12px clamp(16px,3vw,32px) 20px;overflow:auto}
.sshPanel-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.sshPanel-row>.sshPanel-input{flex:1;min-width:180px}
.sshPanel-textarea{width:100%;resize:vertical;font-family:var(--dsh-font-family-code,ui-monospace,monospace);font-size:12px;line-height:1.5}
.sshPanel-out{margin:0;flex:1;min-height:160px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-family:var(--dsh-font-family-code,ui-monospace,monospace);font-size:12px;line-height:1.5;background:var(--dsw-alias-bg-l2);border:1px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);padding:10px 12px}
.sshPanel-meta{font-size:12px;color:var(--dsw-alias-label-secondary);font-family:var(--dsh-font-family-code,ui-monospace,monospace)}
.sshPanel-bad{color:var(--dsw-alias-state-error-primary);white-space:pre-wrap}
.sshPanel-note{font-size:12px;color:var(--dsw-alias-label-secondary)}
.sshPanel-empty{padding:24px;text-align:center;color:var(--dsw-alias-label-secondary)}
.sshPanel-banner{flex:none;margin:10px clamp(16px,3vw,32px) 0;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-l2);border:1px solid var(--dsw-alias-border-l4)}
.sshPanel-bar{flex:none;display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px clamp(16px,3vw,32px);border-bottom:1px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-l2)}
.sshPanel-bar>.sshPanel-input{flex:0 1 260px;min-width:160px}
.sshFiles{box-sizing:border-box;height:100%;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);font-size:13px}
.sshFiles-bar{flex:none;display:flex;gap:6px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l4)}
.sshFiles-bar>.sshPanel-input{flex:1;min-width:0;font-family:var(--dsh-font-family-code,ui-monospace,monospace);font-size:12px}
.sshFiles-bar>.sshPanel-button{padding:5px 10px}
.sshFiles-host{flex:none;padding:4px 12px;font-size:11px;color:var(--dsw-alias-label-tertiary);border-bottom:1px solid var(--dsw-alias-border-l4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sshFiles-list{flex:1;min-height:0;overflow:auto;padding:4px 6px 12px}
.sshFiles-row{box-sizing:border-box;width:100%;display:flex;align-items:center;gap:6px;padding:4px 6px;border:none;background:0 0;color:inherit;font:inherit;text-align:left;border-radius:var(--dsw-radius-sm);cursor:pointer}
.sshFiles-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.sshFiles-glyph{width:12px;flex:none;color:var(--dsw-alias-label-tertiary);text-align:center}
.sshFiles-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sshFiles-size{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;font-family:var(--dsh-font-family-code,ui-monospace,monospace)}
.sshFiles-preview{flex:0 0 auto;max-height:46%;display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l4);min-height:0}
.sshFiles-previewHead{display:flex;align-items:center;gap:8px}
.sshFiles-preview>.sshPanel-out{min-height:0;flex:1;max-height:none}
.sshFiles-title{font-size:12px}
.sshDialog-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:1000}
.sshDialog{width:560px;max-width:calc(100vw - 40px);max-height:72vh;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);box-shadow:0 12px 40px #00000040;overflow:hidden}
.sshDialog-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l4)}
.sshDialog-title{font-weight:600}
.sshDialog-sub{padding:6px 14px;font-size:12px;color:var(--dsw-alias-label-secondary);font-family:var(--dsh-font-family-code,ui-monospace,monospace);word-break:break-all}
.sshDialog-body{padding:10px 14px;display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto}
.sshDialog-row{display:flex;gap:6px;align-items:center}
.sshDialog-row>.sshPanel-input{flex:1;min-width:0}
.sshDialog-list{display:flex;flex-direction:column;gap:2px;min-height:140px;max-height:300px;overflow:auto;border:1px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);padding:4px}
.sshDialog-item{display:flex;align-items:center;gap:6px;padding:5px 6px;border:none;background:0 0;color:inherit;font:inherit;text-align:left;border-radius:var(--dsw-radius-sm);cursor:pointer}
.sshDialog-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.sshDialog-item.selected{background:var(--dsw-alias-interactive-bg-hover);outline:1px solid var(--dsw-alias-state-business-primary)}
.sshDialog-foot{display:flex;gap:8px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l4)}
.sshDialog-note{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);margin:0}
.sshDirPill{display:inline-flex;align-items:center;gap:5px;max-width:300px;min-width:0;padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px;font-family:var(--dsh-font-family-code,ui-monospace,monospace);white-space:nowrap;overflow:hidden;cursor:default}
.sshDirPill>svg{flex:none;opacity:.8}
.sshDirPillLabel{min-width:0;overflow:hidden;text-overflow:ellipsis}
.sshDirPill.remote{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-state-business-primary)}
`;

		/**
		 * Inject this plugin's stylesheet once, tagged the way the module system
		 * tags bundle-owned CSS so unloading can reclaim it.
		 *
		 * A tag left from an earlier revision is rewritten in place instead of
		 * skipped: the stylesheet is part of the bundle, so a hot-reloaded bundle
		 * must not keep painting the old rules.
		 */
		function installStyles() {
			if (typeof document === "undefined") return;
			const tagId = "@local/dsh-mcp-ssh/panel.css";
			const existing = document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]");
			if (existing !== null) {
				if (existing.textContent !== css) existing.textContent = css;
				return;
			}
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-mcp-ssh";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		/**
		 * Call one panel endpoint.
		 * @param {string} path - the endpoint suffix.
		 * @param {object} [options] - fetch options.
		 * @returns {Promise<any>} the parsed JSON body.
		 */
		async function call(path, options) {
			const response = await fetch(API + path, options);
			let payload;
			try {
				payload = await response.json();
			} catch {
				throw new Error(`HTTP ${response.status}: response was not JSON`);
			}
			if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`);
			return payload;
		}

		/**
		 * Run one command on the selected host.
		 * @param {{ host?: string, command: string, timeoutMs?: number }} request - the command.
		 * @returns {Promise<object>} the rendered result.
		 */
		function runCommand(request) {
			return call("/exec", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(request),
			});
		}

		/**
		 * Create (or reuse) the workspace bound to a host. The Host writes the
		 * binding file and the AGENTS.md that tells every session in that
		 * workspace which machine it is standing in front of.
		 * @param {{ host?: string, remoteRoot?: string }} request - the host and its root.
		 * @returns {Promise<object>} the workspace facts.
		 */
		function createWorkspace(request) {
			return call("/workspace", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(request),
			});
		}

		/** The result of a command, rendered the way the shell tools render theirs. */
		function ResultView({ result }) {
			if (result === undefined) return null;
			const markers = [];
			if (result.timedOut) markers.push("[timed out]");
			if (result.signal !== null && result.signal !== undefined) markers.push(`[signal: ${result.signal}]`);
			else if (result.exitCode !== 0 && result.exitCode !== null) markers.push(`[exit code: ${result.exitCode}]`);
			let body = result.stdout ?? "";
			if (result.stderr) {
				if (body.length > 0 && !body.endsWith("\n")) body += "\n";
				body += "[stderr]\n" + result.stderr;
			}
			if (body === "") body = "(no output)";
			return h(
				"div",
				{ style: { display: "flex", flexDirection: "column", gap: 6, minHeight: 0, flex: 1 } },
				h(
					"div",
					{ className: "sshPanel-meta" },
					`${result.label} · exit ${result.exitCode ?? "n/a"} · ${result.durationMs}ms`,
				),
				h("pre", { className: "sshPanel-out" }, body + (markers.length > 0 ? "\n" + markers.join("\n") : "")),
			);
		}

		/** Command tab: a command box, a run button, and the last result. */
		function CommandTab({ host, onError }) {
			const [command, setCommand] = react.useState("hostname; whoami; uptime");
			const [busy, setBusy] = react.useState(false);
			const [result, setResult] = react.useState(undefined);
			const run = async () => {
				if (busy || command.trim() === "") return;
				setBusy(true);
				onError(undefined);
				try {
					setResult(await runCommand({ host, command }));
				} catch (error) {
					onError(error instanceof Error ? error.message : String(error));
				} finally {
					setBusy(false);
				}
			};
			return h(
				"div",
				{ className: "sshPanel-body" },
				h("textarea", {
					className: "sshPanel-textarea",
					rows: 3,
					spellCheck: false,
					value: command,
					placeholder: "在远端执行的命令",
					onChange: (event) => setCommand(event.target.value),
					onKeyDown: (event) => {
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
							event.preventDefault();
							void run();
						}
					},
				}),
				h(
					"div",
					{ className: "sshPanel-row" },
					h("button", { className: "sshPanel-button primary", onClick: () => void run(), disabled: busy }, busy ? "执行中…" : "运行 Ctrl+Enter"),
					h("span", { className: "sshPanel-note" }, "非零退出码会以 [exit code: N] 返回，不算错误"),
				),
				h(ResultView, { result }),
			);
		}

		/** Files tab: upload a local file to the host, or pull one down. */
		function FilesTab({ host, onError, onInfo }) {
			const fileRef = react.useRef(null);
			const [remotePath, setRemotePath] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const [downloadPath, setDownloadPath] = react.useState("");

			const upload = async () => {
				const file = fileRef.current?.files?.[0];
				if (file === undefined) {
					onError("先选择一个本地文件");
					return;
				}
				setBusy(true);
				onError(undefined);
				try {
					const dataBase64 = await new Promise((resolve, reject) => {
						const reader = new FileReader();
						reader.onload = () => {
							const text = String(reader.result ?? "");
							resolve(text.slice(text.indexOf(",") + 1));
						};
						reader.onerror = () => reject(new Error("读取本地文件失败"));
						reader.readAsDataURL(file);
					});
					const target = remotePath.trim() === "" ? `/tmp/${file.name}` : remotePath.trim();
					const outcome = await call("/upload", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ host, remotePath: target, dataBase64 }),
					});
					onInfo(`已上传 ${outcome.bytes} 字节 → ${outcome.remotePath}`);
				} catch (error) {
					onError(error instanceof Error ? error.message : String(error));
				} finally {
					setBusy(false);
				}
			};

			const download = async () => {
				const target = downloadPath.trim();
				if (target === "") {
					onError("填写要下载的远端绝对路径");
					return;
				}
				// The page may be served from the desktop's own protocol, where a
				// top-level navigation to the API would replace the app; pull the
				// bytes and hand them to a blob download instead.
				const query = new URLSearchParams({ path: target });
				if (host !== undefined) query.set("host", host);
				setBusy(true);
				onError(undefined);
				try {
					const response = await fetch(`${API}/download?${query.toString()}`);
					if (!response.ok) {
						let message = `HTTP ${response.status}`;
						try {
							const payload = await response.json();
							if (payload?.error !== undefined) message = payload.error;
						} catch {
							// A non-JSON error body is already described by the status.
						}
						throw new Error(message);
					}
					const blob = await response.blob();
					const objectUrl = URL.createObjectURL(blob);
					const anchor = document.createElement("a");
					anchor.href = objectUrl;
					anchor.download = target.slice(target.lastIndexOf("/") + 1) || "download.bin";
					document.body.appendChild(anchor);
					anchor.click();
					anchor.remove();
					setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
					onInfo(`已下载 ${blob.size} 字节`);
				} catch (error) {
					onError(error instanceof Error ? error.message : String(error));
				} finally {
					setBusy(false);
				}
			};

			return h(
				"div",
				{ className: "sshPanel-body" },
				h("div", { className: "sshPanel-meta" }, "上传"),
				h(
					"div",
					{ className: "sshPanel-row" },
					h("input", {
						className: "sshPanel-input",
						type: "file",
						ref: fileRef,
						onChange: (event) => {
							const name = event.target.files?.[0]?.name;
							if (name !== undefined && remotePath.trim() === "") setRemotePath(`/tmp/${name}`);
						},
					}),
				),
				h(
					"div",
					{ className: "sshPanel-row" },
					h("input", {
						className: "sshPanel-input",
						placeholder: "远端绝对路径，例如 /tmp/app.log",
						value: remotePath,
						onChange: (event) => setRemotePath(event.target.value),
					}),
					h("button", { className: "sshPanel-button", onClick: () => void upload(), disabled: busy }, busy ? "传输中…" : "上传"),
				),
				h("div", { className: "sshPanel-meta", style: { marginTop: 10 } }, "下载"),
				h(
					"div",
					{ className: "sshPanel-row" },
					h("input", {
						className: "sshPanel-input",
						placeholder: "远端绝对路径，例如 /var/log/syslog",
						value: downloadPath,
						onChange: (event) => setDownloadPath(event.target.value),
					}),
					h("button", { className: "sshPanel-button", onClick: () => void download(), disabled: busy }, "下载"),
				),
				h("div", { className: "sshPanel-note" }, "单个文件上限 64 MB；下载交给浏览器保存到默认下载目录。"),
			);
		}

		/**
		 * One-click "open a new workspace bound to this host": creates the folder,
		 * the binding file and AGENTS.md on the Host, registers the workspace, then
		 * asks the client shell to start a session in it.
		 */
		/**
		 * One-click entry into the connect dialog: the dialog owns the password
		 * step and the directory picker, so this bar only asks for it.
		 */
		function WorkspaceBar({ host, busy, onRequest }) {
			return h(
				"div",
				{ className: "sshPanel-bar" },
				h("span", { className: "sshPanel-note" }, "远程工作区"),
				h("button", { className: "sshPanel-button primary", onClick: () => onRequest(), disabled: busy || host === undefined }, busy ? "创建中…" : "新建工作区并进入"),
				h("span", { className: "sshPanel-note" }, "先验密码（配置里已有则跳过），再选服务器目录，最后在新会话里直接操作它"),
			);
		}

		/**
		 * Ask the Host to prove a connection, optionally with a password typed
		 * here. The answer's `needsPassword` tells the dialog whether to ask.
		 * @param {string} host - host alias.
		 * @param {string} [password] - password typed by the person.
		 * @returns {Promise<object>} the connection facts.
		 */
		function connectHost(host, password) {
			return call("/connect", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(password === undefined || password === "" ? { host } : { host, password }),
			});
		}

		/**
		 * Point a bound workspace at a remote directory (binding file + AGENTS.md).
		 * @param {string} path - the local workspace directory.
		 * @param {string} remoteRoot - the chosen remote directory.
		 * @returns {Promise<object>} the updated binding facts.
		 */
		function setWorkspaceRoot(path, remoteRoot) {
			return call("/root", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ path, remoteRoot }),
			});
		}

		/**
		 * The workspace title that puts the folder first: the new-session chip and
		 * the sidebar row have room for one line, so `YF-015-Project · 10.249.188.48`
		 * survives truncation better than a full path.
		 * @param {string} host - host alias.
		 * @param {string} remoteRoot - the remote working directory.
		 * @returns {string} the title.
		 */
		function workspaceTitleFor(host, remoteRoot) {
			const trimmed = String(remoteRoot ?? "").replace(/\/+$/, "");
			const folder = trimmed === "" ? "" : trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
			return folder === "" ? String(host) : `${folder} · ${host}`;
		}

		/**
		 * The connect dialog: password step when the host has no stored
		 * credentials, then a directory picker over the live server.
		 *
		 * @param {object} props - dialog state and callbacks.
		 * @returns {object} the overlay.
		 */
		function ConnectDialog({ open, host, initialPath, title, confirmLabel, onCancel, onPick }) {
			const [step, setStep] = react.useState("connect");
			const [password, setPassword] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState(undefined);
			const [listing, setListing] = react.useState(undefined);
			const [selected, setSelected] = react.useState(undefined);
			const [draft, setDraft] = react.useState("");

			const browse = react.useCallback(
				async (target) => {
					setBusy(true);
					setError(undefined);
					try {
						const found = await listDirectory(host, target);
						setListing(found);
						setSelected(found.path);
						setDraft(found.path);
					} catch (problem) {
						setError(problem instanceof Error ? problem.message : String(problem));
					} finally {
						setBusy(false);
					}
				},
				[host],
			);

			const handshake = react.useCallback(
				async (typed) => {
					setBusy(true);
					setError(undefined);
					try {
						await connectHost(host, typed);
						setStep("browse");
						await browse(initialPath ?? "~");
					} catch (problem) {
						const message = problem instanceof Error ? problem.message : String(problem);
						const needsPassword = problem?.needsPassword === true || /需要密码|密码或密钥不正确/.test(message);
						if (needsPassword) setStep("password");
						setError(message);
					} finally {
						setBusy(false);
					}
				},
				[browse, host, initialPath],
			);

			react.useEffect(() => {
				if (!open) return;
				setStep("connect");
				setPassword("");
				setListing(undefined);
				setError(undefined);
				void handshake(undefined);
			}, [open, handshake]);

			if (!open) return null;

			const submitPassword = async () => {
				if (password === "") {
					setError("请输入密码");
					return;
				}
				await handshake(password);
			};

			const body =
				step === "password"
					? h(
							"div",
							{ className: "sshDialog-body" },
							h("p", { className: "sshDialog-note" }, "这台主机没有在配置文件里写密码或私钥，请在这里输入密码。密码只保留在本次 DSH 运行的内存里，不会落盘。"),
							h("div", { className: "sshDialog-row" },
								h("input", {
									className: "sshPanel-input",
									type: "password",
									autoFocus: true,
									placeholder: "SSH 密码",
									value: password,
									onChange: (event) => setPassword(event.target.value),
									onKeyDown: (event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											void submitPassword();
										}
									},
								}),
								h("button", { className: "sshPanel-button primary", onClick: () => void submitPassword(), disabled: busy }, busy ? "连接中…" : "连接"),
							),
						)
					: step === "browse"
						? h(
								"div",
								{ className: "sshDialog-body" },
								h("div", { className: "sshDialog-row" },
									h("button", { className: "sshPanel-button", onClick: () => listing !== undefined && void browse(listing.parent), disabled: busy }, "↑"),
									h("input", {
										className: "sshPanel-input",
										value: draft,
										spellCheck: false,
										onChange: (event) => setDraft(event.target.value),
										onKeyDown: (event) => {
											if (event.key === "Enter") {
												event.preventDefault();
												void browse(draft.trim() === "" ? "~" : draft.trim());
											}
										},
									}),
									h("button", { className: "sshPanel-button", onClick: () => void browse(draft.trim() === "" ? "~" : draft.trim()), disabled: busy }, "打开"),
								),
								h(
									"div",
									{ className: "sshDialog-list" },
									(listing?.entries ?? []).map((entry, index) =>
										entry.kind !== "directory"
											? null
											: h(
													"button",
													{
														key: entry.name,
														className: `sshDialog-item${selected === `${listing.path.replace(/\/$/, "")}/${entry.name}` ? " selected" : ""}`,
														onClick: () => {
															const target = `${listing.path.replace(/\/$/, "")}/${entry.name}`;
															setSelected(target);
															setDraft(target);
														},
														onDoubleClick: () => void browse(`${listing.path.replace(/\/$/, "")}/${entry.name}`),
													},
													h("span", { className: "sshFiles-glyph" }, "▸"),
													h("span", { className: "sshFiles-name" }, `${entry.name}/`),
												),
										),
									h("div", { className: "sshPanel-note" }, "单击选中，双击进入。只能用目录。"),
								),
							)
						: h("div", { className: "sshDialog-body" }, h("div", { className: "sshPanel-note" }, busy ? "正在连接…" : "准备中…"));

			return h(
				"div",
				{ className: "sshDialog-overlay", role: "dialog", "aria-modal": true },
				h(
					"div",
					{ className: "sshDialog" },
					h("div", { className: "sshDialog-head" },
						h("span", { className: "sshDialog-title" }, title ?? "连接到服务器"),
						h("span", { className: "sshPanel-spacer" }),
						h("button", { className: "sshPanel-button", onClick: onCancel }, "取消"),
					),
					h("div", { className: "sshDialog-sub" }, `${host}${step === "browse" && selected !== undefined ? ` · 选择目录：${selected}` : ""}`),
					error === undefined ? null : h("div", { className: "sshPanel-banner sshPanel-bad" }, error),
					body,
					step !== "browse" ? null : h("div", { className: "sshDialog-foot" },
						h("span", { className: "sshPanel-spacer" }),
						h("button", {
							className: "sshPanel-button primary",
							disabled: busy || selected === undefined,
							onClick: () => onPick(selected),
						}, confirmLabel ?? "使用此目录"),
					),
				),
			);
		}

		/** The global panel: host picker, command tab, file tab. */
		function SshPanel({ openWorkspace, workspaces }) {
			const [state, setState] = react.useState({ loading: true });
			const [tab, setTab] = react.useState("exec");
			const [host, setHost] = react.useState(undefined);
			const [error, setError] = react.useState(undefined);
			const [info, setInfo] = react.useState(undefined);
			const [dialog, setDialog] = react.useState(undefined);
			const [creating, setCreating] = react.useState(false);

			/**
			 * Finish the create flow once the dialog picked a remote directory:
			 * prepare the folder on the Host, register the workspace through the
			 * Client service, rename it, and open a session in it.
			 * @param {string} remoteRoot - the chosen remote directory.
			 */
			const createIn = async (remoteRoot) => {
				const target = dialog?.host ?? host;
				if (target === undefined) return;
				setCreating(true);
				setError(undefined);
				try {
					const prepared = await createWorkspace({ host: target, remoteRoot });
					const workspace = await workspaces.create({ path: prepared.path });
					try {
						await workspaces.rename(workspace.id, workspaceTitleFor(target, remoteRoot));
					} catch {
						// A title the shell refuses does not block opening the workspace.
					}
					setDialog(undefined);
					setInfo(`工作区已就绪：${prepared.path} → ${remoteRoot}`);
					await (openWorkspace ?? (async () => {}))(workspace.id);
				} catch (problem) {
					setError(problem instanceof Error ? problem.message : String(problem));
				} finally {
					setCreating(false);
				}
			};

			const load = react.useCallback(async () => {
				setState({ loading: true });
				try {
					const payload = await call("/hosts");
					setState({ loading: false, ...payload });
					setHost((current) => current ?? payload.defaultHost);
				} catch (problem) {
					setState({ loading: false, hosts: [], warnings: [] });
					setError(problem instanceof Error ? problem.message : String(problem));
				}
			}, []);

			react.useEffect(() => {
				void load();
			}, [load]);

			react.useEffect(() => {
				installStyles();
			}, []);

			const hosts = state.hosts ?? [];
			const current = hosts.find((entry) => entry.alias === host);
			const head = h(
				"header",
				{ className: "sshPanel-head" },
				h("h1", { className: "sshPanel-title" }, "SSH 远程"),
				h("select", {
					className: "sshPanel-select",
					value: host ?? "",
					onChange: (event) => setHost(event.target.value),
					"aria-label": "选择主机",
				}, hosts.map((entry) => h("option", { key: entry.alias, value: entry.alias }, entry.alias))),
				current === undefined
					? null
					: h("span", { className: "sshPanel-note" }, `${current.username}@${current.host}:${current.port} · ${current.auth === "key" ? "密钥" : "密码"}`),
				h("span", { className: "sshPanel-spacer" }),
				h("button", { className: "sshPanel-button", onClick: () => void load(), disabled: state.loading }, state.loading ? "加载中…" : "刷新"),
			);

			if (state.loading && hosts.length === 0) {
				return h("div", { className: "sshPanel" }, head, h("div", { className: "sshPanel-empty" }, "正在读取主机配置…"));
			}

			const body =
				hosts.length === 0
					? h(
							"div",
							{ className: "sshPanel-empty" },
							"没有可用的 SSH 主机。",
							h("br"),
							"请编辑 ~/.dsh/ssh-hosts.json 或 ~/.ssh/config 后点刷新。",
						)
					: h(
							react.Fragment,
							null,
							h(
								"div",
								{ className: "sshPanel-tabs", role: "tablist" },
								h("button", { className: "sshPanel-tab", role: "tab", "aria-selected": tab === "exec", onClick: () => setTab("exec") }, "命令"),
								h("button", { className: "sshPanel-tab", role: "tab", "aria-selected": tab === "files", onClick: () => setTab("files") }, "文件"),
							),
							tab === "exec"
								? h(CommandTab, { host, onError: setError })
								: h(FilesTab, { host, onError: setError, onInfo: setInfo }),
						);

			return h(
				"div",
				{ className: "sshPanel" },
				head,
				h(WorkspaceBar, {
					host,
					busy: creating,
					onRequest: () => {
						setError(undefined);
						setDialog({ host });
					},
				}),
				error === undefined ? null : h("div", { className: "sshPanel-banner sshPanel-bad" }, error),
				info === undefined ? null : h("div", { className: "sshPanel-banner sshPanel-note" }, info),
				body,
				h(ConnectDialog, {
					open: dialog !== undefined,
					host: dialog?.host ?? host ?? "",
					title: "新建远程工作区",
					confirmLabel: "用此目录建工作区",
					onCancel: () => setDialog(undefined),
					onPick: (remoteRoot) => void createIn(remoteRoot),
				}),
			);
		}

		/** Identity of the server-files tab type; also the slot key of its body. */
		const FILES_TAB_ID = "dsh-mcp-ssh/files";
		/** Tab kind the guide card opens. */
		const FILES_TAB_KIND = "ssh-files";

		/**
		 * Read the SSH binding of the workspace a session runs in.
		 * @param {string} directory - the session's workspace directory.
		 * @returns {Promise<{ host: string, label: string, remoteRoot: string }>} the binding.
		 */
		async function bindingFor(directory) {
			const query = new URLSearchParams({ path: directory });
			return call(`/binding?${query.toString()}`);
		}

		/**
		 * List one remote directory.
		 * @param {string} host - host alias.
		 * @param {string} path - absolute or `~`-rooted remote path.
		 * @returns {Promise<{ path: string, parent: string, entries: Array<object> }>} the listing.
		 */
		function listDirectory(host, path) {
			const query = new URLSearchParams({ host, path });
			return call(`/ls?${query.toString()}`);
		}

		/**
		 * Read one remote text file.
		 * @param {string} host - host alias.
		 * @param {string} path - absolute remote path.
		 * @returns {Promise<{ path: string, bytes: number, text: string }>} the file.
		 */
		function readFileText(host, path) {
			const query = new URLSearchParams({ host, path });
			return call(`/read?${query.toString()}`);
		}

		/** A compact "512 B / 3.4 KB / 2.1 MB" size label. */
		function sizeLabel(bytes) {
			if (!Number.isFinite(bytes) || bytes <= 0) return "";
			if (bytes < 1024) return `${bytes} B`;
			if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
			if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
			return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
		}

		/**
		 * The server-files tab: browse the SSH host bound to this workspace and
		 * preview text files, without leaving the sidebar.
		 */
		function SshFilesBody(props) {
			const { sessionId, useSessions, useTabInfo, renameWorkspace } = props;
			const session = typeof useSessions === "function" ? useSessions((state) => state.byId[sessionId]) : undefined;
			const directory = session?.cwd;
			const params = typeof useTabInfo === "function" ? useTabInfo().tab?.params : undefined;

			const [phase, setPhase] = react.useState("init");
			const [binding, setBinding] = react.useState(undefined);
			const [current, setCurrent] = react.useState(undefined);
			const [entries, setEntries] = react.useState([]);
			const [error, setError] = react.useState(undefined);
			const [selected, setSelected] = react.useState(undefined);
			const [pathDraft, setPathDraft] = react.useState("");
			const [switching, setSwitching] = react.useState(false);
			const [notice, setNotice] = react.useState(undefined);

			const navigate = react.useCallback(async (host, path) => {
				setPhase("loading");
				setError(undefined);
				try {
					const listing = await listDirectory(host, path);
					setCurrent(listing.path);
					setPathDraft(listing.path);
					setEntries(listing.entries);
					setPhase("ready");
				} catch (problem) {
					setError(problem instanceof Error ? problem.message : String(problem));
					setPhase("ready");
				}
			}, []);

			react.useEffect(() => {
				installStyles();
			}, []);

			react.useEffect(() => {
				if (directory === undefined) {
					setPhase("unbound");
					return;
				}
				if (params?.host !== undefined) {
					// Opened explicitly for a host; the workspace binding only supplies a root.
					setBinding({ host: params.host, label: params.host, remoteRoot: params.root ?? "" });
					void navigate(params.host, params.root ?? "~");
					return;
				}
				if (params?.path !== undefined) {
					void navigate(params.host, params.path);
					return;
				}
				let live = true;
				setPhase("init");
				bindingFor(directory)
					.then((found) => {
						if (!live) return;
						setBinding(found);
						// Self-healing: a workspace created before titles carried the
						// folder gets retitled the first time this tab sees it.
						if (typeof renameWorkspace === "function") {
							void renameWorkspace(sessionId, workspaceTitleFor(found.host, found.remoteRoot));
						}
						return navigate(found.host, found.remoteRoot === "" ? "~" : found.remoteRoot);
					})
					.catch((problem) => {
						if (!live) return;
						setError(problem instanceof Error ? problem.message : String(problem));
						setPhase("unbound");
					});
				return () => {
					live = false;
				};
			}, [directory, navigate, params?.host, params?.root, params?.path, renameWorkspace, sessionId]);

			const openEntry = async (entry) => {
				const target = `${current.replace(/\/$/, "")}/${entry.name}`;
				if (entry.kind === "directory") {
					await navigate(binding.host, target);
					return;
				}
				if (entry.kind !== "file") return;
				setError(undefined);
				try {
					setSelected(await readFileText(binding.host, target));
				} catch (problem) {
					setError(problem instanceof Error ? problem.message : String(problem));
				}
			};

			const goUp = () => {
				if (current === undefined || binding === undefined) return;
				const parent = current === "/" ? "/" : current.replace(/\/[^/]+\/?$/, "") || "/";
				void navigate(binding.host, parent);
			};

			if (phase === "unbound" && binding === undefined) {
				return h(
					"div",
					{ className: "sshFiles" },
					h("div", { className: "sshPanel-empty" }, "这个工作区没有绑定 SSH 主机。"),
					h("div", { className: "sshPanel-empty", style: { paddingTop: 0 } }, "在左侧栏的「SSH 远程」里点「新建工作区并进入」，再从引导页打开本页签。"),
				);
			}

			const header = h(
				"div",
				{ className: "sshFiles-bar" },
				h("button", { className: "sshPanel-button", onClick: goUp, disabled: current === undefined, title: "上级目录" }, "↑"),
				h("input", {
					className: "sshPanel-input",
					value: pathDraft,
					spellCheck: false,
					onChange: (event) => setPathDraft(event.target.value),
					onKeyDown: (event) => {
						if (event.key === "Enter" && binding !== undefined) {
							event.preventDefault();
							void navigate(binding.host, pathDraft.trim() === "" ? "~" : pathDraft.trim());
						}
					},
					"aria-label": "远程目录",
				}),
				h("button", { className: "sshPanel-button", onClick: () => binding !== undefined && void navigate(binding.host, pathDraft.trim() === "" ? "~" : pathDraft.trim()) }, "打开"),
				h("button", { className: "sshPanel-button", onClick: () => setSwitching(true), disabled: binding === undefined, title: "选择服务器目录并切换会话" }, "选择目录"),
			);

			const listing = h(
				"div",
				{ className: "sshFiles-list", role: "list" },
				phase === "loading" ? h("div", { className: "sshPanel-empty" }, "读取中…") : null,
				entries.map((entry) =>
					h(
						"button",
						{
							key: entry.name,
							className: "sshFiles-row",
							role: "listitem",
							onClick: () => void openEntry(entry),
							title: entry.kind === "directory" ? `${entry.name}/` : entry.name,
						},
						h("span", { className: "sshFiles-glyph" }, entry.kind === "directory" ? "▸" : entry.kind === "file" ? "·" : "?"),
						h("span", { className: "sshFiles-name" }, entry.kind === "directory" ? `${entry.name}/` : entry.name),
						h("span", { className: "sshFiles-size" }, sizeLabel(entry.size)),
					),
				),
				phase === "ready" && entries.length === 0 ? h("div", { className: "sshPanel-empty" }, "空目录") : null,
			);

			const preview =
				selected === undefined
					? null
					: h(
							"div",
							{ className: "sshFiles-preview" },
							h(
								"div",
								{ className: "sshFiles-previewHead" },
								h("span", { className: "sshPanel-meta" }, `${selected.path} · ${sizeLabel(selected.bytes)}`),
								h("span", { className: "sshPanel-spacer" }),
								h("button", { className: "sshPanel-button", onClick: () => setSelected(undefined) }, "关闭"),
							),
							h("pre", { className: "sshPanel-out" }, selected.text),
						);

			return h(
				"div",
				{ className: "sshFiles" },
				header,
				binding === undefined
					? null
					: h("div", { className: "sshFiles-host" }, `${binding.label} · ${current ?? ""}`),
				error === undefined ? null : h("div", { className: "sshPanel-banner sshPanel-bad" }, error),
				notice === undefined ? null : h("div", { className: "sshPanel-banner sshPanel-note" }, notice),
				preview,
				listing,
				h(ConnectDialog, {
					open: switching,
					host: binding?.host ?? "",
					initialPath: current ?? "~",
					title: "切换工作目录",
					confirmLabel: "切换到此目录",
					onCancel: () => setSwitching(false),
					onPick: (remoteRoot) => {
						setSwitching(false);
						if (directory === undefined) return;
						void (async () => {
							try {
								const updated = await setWorkspaceRoot(directory, remoteRoot);
								setBinding({ ...(binding ?? {}), ...updated });
								setNotice(`工作目录已切换到 ${updated.remoteRoot}，后续对话默认在这里操作`);
								// The workspace chip shows the folder, so the title follows
								// the switch as well.
								await renameWorkspace(sessionId, workspaceTitleFor(updated.host, updated.remoteRoot));
								// The composer pill listens for this so it follows the switch.
								window.dispatchEvent(new CustomEvent("dsh-ssh:root-changed"));
								await navigate(updated.host, updated.remoteRoot);
							} catch (problem) {
								setError(problem instanceof Error ? problem.message : String(problem));
							}
						})();
					},
				}),
			);
		}

		/**
		 * The pill under the composer: the directory the agent is actually
		 * working in — the bound remote root when the workspace has one, the
		 * local workspace directory otherwise.
		 *
		 * It refreshes on mount, on session change, and whenever the files tab
		 * announces a switch through the `dsh-ssh:root-changed` event.
		 */
		function WorkspaceDirPill(props) {
			const { sessionId, useSessions } = props;
			const session = typeof useSessions === "function" ? useSessions((state) => state.byId[sessionId]) : undefined;
			// `cwd` comes from the registration's inject; the hook is the fallback.
			const cwd = props.cwd ?? session?.cwd;
			const [remote, setRemote] = react.useState(undefined);

			react.useEffect(() => {
				if (cwd === undefined) return;
				let live = true;
				const load = () => {
					bindingFor(cwd)
						.then((found) => {
							if (live) setRemote(found);
						})
						.catch(() => {
							if (live) setRemote(null);
						});
				};
				load();
				const onChange = () => load();
				window.addEventListener("dsh-ssh:root-changed", onChange);
				return () => {
					live = false;
					window.removeEventListener("dsh-ssh:root-changed", onChange);
				};
			}, [cwd]);

			if (cwd === undefined) return null;
			const bound = remote !== null && remote !== undefined;
			const label = bound ? `${remote.host}:${remote.remoteRoot === "" ? "~" : remote.remoteRoot}` : cwd;
			return h(
				"span",
				{
					className: `sshDirPill${bound ? " remote" : ""}`,
					title: bound ? `${label}\n本地工作区：${cwd}` : `当前目录：${cwd}`,
				},
				h(
					"svg",
					{ width: 12, height: 12, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
					h("path", {
						d: "M1.8 4.2a1.4 1.4 0 0 1 1.4-1.4h3.1l1.5 1.7h4.9a1.4 1.4 0 0 1 1.4 1.4v5.7a1.4 1.4 0 0 1-1.4 1.4H3.2a1.4 1.4 0 0 1-1.4-1.4z",
						stroke: "currentColor",
						strokeWidth: 1.2,
						strokeLinejoin: "round",
					}),
				),
				h("span", { className: "sshDirPillLabel" }, label),
			);
		}

		/** The tab strip title. */
		function SshFilesTitle() {
			return h("span", { className: "sshFiles-title" }, "服务器文件");
		}

		/** The sidebar row icon: a terminal chevron. */
		function SshIcon({ size }) {
			const dimension = size ?? 16;
			return h(
				"svg",
				{ width: dimension, height: dimension, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
				h("rect", { x: 1.5, y: 2.5, width: 13, height: 11, rx: 2, stroke: "currentColor", strokeWidth: 1.3 }),
				h("path", { d: "M4.6 6.2 6.9 8 4.6 9.8", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round" }),
				h("path", { d: "M8.6 10.1h3", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round" }),
			);
		}

		/** Services this browser plugin waits for. */
		const inject = ["slots", "sessions", "uiWorkspace", "workspaces", "sidebarRightTabs"];

		/**
		 * Register the sidebar entry and the panel it selects.
		 * @param {object} ctx - the client plugin context.
		 */
		function apply(ctx) {
			installStyles();

			/**
			 * Rename the workspace owning a session, so the new-session chip and the
			 * sidebar row show the folder the agent works in. No-op when the title
			 * already matches.
			 * @param {string} sessionId - the session whose workspace to retitle.
			 * @param {string} title - the desired title.
			 * @returns {Promise<void>} resolves once the rename settles.
			 */
			const renameWorkspaceFor = async (sessionId, title) => {
				const snapshot = ctx.workspaces?.list?.getSnapshot?.();
				const item = snapshot?.items?.find(
					(workspace) => Array.isArray(workspace.sessionIds) && workspace.sessionIds.includes(sessionId),
				);
				if (item === undefined || item.title === title) return;
				try {
					await ctx.workspaces.rename(item.workspaceId, title);
				} catch {
					// A rejected title is cosmetic only.
				}
			};
			ctx.slots.inject("sidebar.panellist", () =>
				ctx.slots.register(
					{
						name: "sidebar.panellist",
						id: PANEL_ID,
						order: 15,
						label: "SSH 远程",
					},
					SshIcon,
				),
			);
			ctx.slots.inject("main", () =>
				ctx.slots.register(
					{
						name: "main",
						key: PANEL_ID,
						// `uiWorkspace.startSession` is how the shell opens a session in
						// the workspace this panel just created.
						inject: () => ({
							openWorkspace: (workspaceId) => ctx.uiWorkspace.startSession(workspaceId),
							workspaces: ctx.workspaces,
						}),
					},
					SshPanel,
				),
			);

			// A sidebar tab type of our own: the shipped "workspace files" tree is
			// bound to the session's local workspace and the Host refuses paths
			// outside it, so server directories need their own tab rather than a
			// hijack of that one.
			ctx.effect(
				() =>
					ctx.sidebarRightTabs.register({
						id: FILES_TAB_ID,
						kind: FILES_TAB_KIND,
						title: () => "服务器文件",
						guide: [
							{
								id: "ssh-files",
								order: 12,
								title: () => "服务器文件",
								description: () => "浏览 SSH 主机上的目录与文本文件",
								icon: SshIcon,
							},
						],
					}),
				"dsh-mcp-ssh: files tab type",
			);
			ctx.effect(
				() =>
					ctx.slots.inject("sidebar.right.pane.tab", () =>
						ctx.slots.register(
							{
								name: "sidebar.right.pane.tab",
								key: FILES_TAB_ID,
								// Stable identity: the tab body keeps this in an effect's
								// dependency list, so a fresh closure per render would loop.
								inject: () => ({ renameWorkspace: renameWorkspaceFor }),
							},
							SshFilesBody,
						),
					),
				"dsh-mcp-ssh: files tab body",
			);
			// The composer's dock row: where the agent is actually working.
			ctx.effect(
				() =>
					ctx.slots.inject("conversation.composer.dock", () =>
						ctx.slots.register(
							{
								name: "conversation.composer.dock",
								id: "ssh-dir",
								order: -1,
								// The dock hands the occupant its session id; the working
								// directory is read here as well so the pill does not depend
								// on the standard session toolkit being threaded through.
								inject: (sessionId) => {
									const snapshot = ctx.sessions?.list?.getSnapshot?.();
									const cwd = snapshot?.byId?.[sessionId]?.cwd;
									return { sessionId, cwd };
								},
							},
							WorkspaceDirPill,
						),
					),
				"dsh-mcp-ssh: composer dock directory",
			);
			ctx.effect(
				() =>
					ctx.slots.inject("sidebar.right.pane.tab.title", () =>
						ctx.slots.register(
							{
								name: "sidebar.right.pane.tab.title",
								key: FILES_TAB_ID,
							},
							SshFilesTitle,
						),
					),
				"dsh-mcp-ssh: files tab title",
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
