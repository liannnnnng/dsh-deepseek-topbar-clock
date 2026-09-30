# dsh-deepseek-topbar-clock

给 **DSH 桌面端**（[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Desktop，Electron 应用，GUI 为 `http://127.0.0.1:19387`）的会话标题栏加两个小挂件：

| 挂件 | 显示 | 行为 |
| --- | --- | --- |
| 峰谷计价时钟 | `● 周三 15:24:08 高峰 ×2`（红）<br>`● 周六 19:02:31 空闲·半价 ×1`（绿） | 每秒刷新，北京时间（Asia/Shanghai，恒 UTC+8），悬停看计价说明 |
| DeepSeek 余额 | `余额 ¥23.31` | 点击强制刷新（图标旋转）；悬停看 总余额 / 赠送 / 充值 / Key 来源 / 缓存状态 / 更新时间；无 Key 或余额不可用时显示 `余额 —` 并给出原因 |

- **高峰（全价 ×2）**：周一至周五 北京时间 `09:00–12:00`、`14:00–18:00`
- **空闲（半价 ×1）**：其余时段，以及**周六 / 周日全天**

挂件注册在 `conversation.session.header.utilities` 槽位（会话标题栏右侧），主题 token 取自 `--dsw-alias-*`，浅色 / 深色主题自适应。

## 架构

DSH 原生客户端插件（bundle），不改任何编译产物：

| 半 | 文件 | 职责 |
| --- | --- | --- |
| Host（Node） | `src/index.mjs` | 注册 `GET /api/deepseek-balance`；读取 API Key 并代理请求官方余额接口（浏览器拿不到 Key，且 `api.deepseek.com` 无 CORS 头） |
| Client（浏览器） | `client.js` | 通过 `window.__ModuleLoader__.load` 注册惰性 factory，用 `ctx.slots` 往标题栏槽位挂两个 React 挂件 |

## 安装

### 方式 A：`plugin_manager`（推荐；DSH 内置 Agent 工具）

把仓库放到工作区内任意目录，然后让 Agent 执行：

```
plugin_manager  action: install_bundle
                target: <本仓库绝对路径>
```

`install_bundle` 会自己完成「装包 + 选中 bundle + 接线 profile」，**不需要**手工改 profile 的 `package.json` / `cordis.patch.yml`，也不要在 profile 目录里跑 pnpm。

### 方式 B：手工接线（桌面端 profile 由 Electron 应用独占，`dsh plugin --profile desktop` 会被拒绝）

1. 把包链接进 profile：

   ```powershell
   # Windows：junction 直连源码目录，改代码即生效，避免 pnpm 安装副本过期
   New-Item -ItemType Junction `
     -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-deepseek-topbar-clock" `
     -Target "D:\path\to\dsh-deepseek-topbar-clock"
   ```

2. 在 `%USERPROFILE%\.dsh\profiles\desktop\package.json` 里声明依赖与 bundle：

   ```json
   {
     "dependencies": {
       "dsh-deepseek-topbar-clock": "file:D:/path/to/dsh-deepseek-topbar-clock"
     },
     "dsh": { "profile": { "bundles": [ "…原有…", "dsh-deepseek-topbar-clock" ] } }
   }
   ```

3. 重启桌面端（可用仓库根目录的 `restart-desktop-and-verify.bat`：停 → 起 → 自动验证），页面按 `Ctrl+F5` 强刷一次。

## 验证

```powershell
.\tools\verify.bat          # 或 node tools/verify.mjs
```

检查桌面端 GUI 是否在监听、`GET /api/deepseek-balance` 是否返回真实余额。

离线单元测试（不需要桌面端）：

```powershell
npm test
```

- `tools/test-client.mjs`：bundle 结构、插件 `inject`、槽位未声明时的等待 / 重试、注册幂等、卸载清理
- `tools/test-host.mjs`：Key 查找、余额查询与 60 秒缓存、路由注册与卸载钩子

**客户端挂件是否渲染必须在界面里目视确认**：标题栏右侧应出现时钟与余额。挂件 DOM 带 `data-ds-peak-clock` / `data-ds-balance` 与 `data-ds-version`，便于在 DevTools 里确认页面跑的是哪一版。

## 配置

### API Key 查找顺序（宿主侧）

1. 环境变量 `DEEPSEEK_API_KEY`
2. `${DSH_HOME}/dsh-deepseek-topbar-clock/config.json` 的 `deepseekApiKey`
3. `${DSH_HOME}/.credentials.yaml` 的 `DEEPSEEK_API_KEY`（DSH 登录态自动带出，通常无需配置）

```json
{ "deepseekApiKey": "sk-..." }
```

### 计价窗口 / 缓存

- 时段：`client.js` 顶部 `PEAK_WINDOWS`（分钟阈值 `540/720/840/1080` = 09:00/12:00/14:00/18:00）与 `peakState()` 里的 `weekend` 判断
- 请求行为：`src/index.mjs` 的 `CACHE_MS`（默认 60 秒）、`TIMEOUT_MS`（默认 10 秒）

## 接口

```
GET /api/deepseek-balance            → 60 秒内存缓存
GET /api/deepseek-balance?refresh=1  → 强制刷新
```

```jsonc
// 成功
{ "ok": true, "fetchedAt": "…", "fromCache": false, "keySource": ".credentials.yaml",
  "is_available": true, "balance_infos": [ { "currency": "CNY", "total_balance": "23.31",
  "granted_balance": "3.97", "topped_up_balance": "19.34" } ] }
// 失败
{ "ok": false, "fetchedAt": "…", "error": "…", "http": 401 }
```

## 文件

| 文件 | 说明 |
| --- | --- |
| `src/index.mjs` | Host 半：注册 `/api/deepseek-balance`、Key 查找、60 秒缓存 |
| `client.js` | 浏览器半：两个挂件（`window.__ModuleLoader__.load` 惰性 factory） |
| `cordis.patch.yml` | bundle 补丁：插入宿主行 |
| `package.json` | `dsh.bundle.patch` + `dsh.client`（`platform` / `immediately` / `inject`） |
| `tools/verify.mjs`、`tools/verify.bat` | 安装后冒烟验证 |
| `tools/test-client.mjs`、`tools/test-host.mjs` | 离线单元测试（`npm test`） |
| `tools/paths.mjs` | 工具共用的路径解析（`--profile` / `$DSH_PROFILE_DIR` / `$DSH_HOME`） |
| `tools/node.cmd` | 优先用桌面端自带 Node，否则退回 PATH 里的 `node` |
| `restart-desktop-and-verify.bat` | 桌面端：停 → 起 → 自动验证（内含本机安装路径，按需修改） |

## 卸载

从桌面端 profile 的 `package.json` 里移除 `dependencies` 与 `dsh.profile.bundles` 中的 `dsh-deepseek-topbar-clock`，再删除 profile 的 `node_modules/dsh-deepseek-topbar-clock` 链接，然后重启桌面端。插件目录可自行删除。

## License

[MIT](LICENSE)
