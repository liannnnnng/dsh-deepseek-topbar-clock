# dsh-deepseek-topbar-clock

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）顶部栏加两个小挂件：

| 挂件 | 显示 | 行为 |
| --- | --- | --- |
| 峰谷计价时钟 | `● 周三 15:24:08 高峰 ×2`（红）<br>`● 周六 19:02:31 空闲·半价 ×1`（绿） | 每秒刷新，北京时间（Asia/Shanghai，恒 UTC+8），悬停看计价说明 |
| DeepSeek 余额 | `余额 ¥23.31` | 点击强制刷新（图标旋转）；悬停看 总余额 / 赠送 / 充值 / Key 来源 / 缓存状态 / 更新时间；无 Key 或余额不可用时显示 `余额 —` 并给出原因 |

- **高峰（全价 ×2）**：周一至周五 北京时间 `09:00–12:00`、`14:00–18:00`
- **空闲（半价 ×1）**：其余时段，以及**周六 / 周日全天**

挂件注册在 DSH 的 `conversation.session.header.utilities` 槽位（会话标题栏右侧），主题 token 取自 `--dsw-alias-*`，浅色 / 深色主题自适应。

## 安装

### 方式 A：`plugin_manager`（推荐；DSH 内置 Agent 工具）

把仓库放到工作区内任意目录，然后让 Agent 执行：

```
plugin_manager  action: install_bundle
                target: <本仓库绝对路径>
```

`install_bundle` 会自己完成「装包 + 选中 bundle + 接线 profile」，**不需要**手工改 profile 的 `package.json` / `cordis.patch.yml`，也不要在 profile 目录里跑 pnpm。

### 方式 B：手工接线（profile 被应用独占时，例如 Desktop）

> 只有在你没有 `plugin_manager` 可用、且 profile 由 Electron 应用独占（`dsh plugin --profile <name>` 会被拒绝）时才需要这么做。**请先读完下面的「踩坑记录」**，否则很容易让整个应用起不来。

1. 把包链接进 profile：

   ```powershell
   # Windows：junction 直连源码目录，改代码即生效，避免安装副本过期
   New-Item -ItemType Junction `
     -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-deepseek-topbar-clock" `
     -Target "D:\path\to\dsh-deepseek-topbar-clock"
   ```

2. 在 profile 的 `package.json` 里声明依赖与 bundle：

   ```json
   {
     "dependencies": {
       "dsh-deepseek-topbar-clock": "file:D:/path/to/dsh-deepseek-topbar-clock"
     },
     "dsh": { "profile": { "bundles": [ "…原有…", "dsh-deepseek-topbar-clock" ] } }
   }
   ```

3. 重启应用（Desktop 用仓库根目录的 `restart-desktop-and-verify.bat`：停 → 起 → 自动验证）。

## 验证

```powershell
# 重启后（或热加载后）跑
.\tools\verify.bat
```

检查 GUI 是否在监听、宿主接口是否返回真实余额、以及有没有本插件引发的新致命崩溃。

离线单元测试（无需桌面端）：

```powershell
npm test
```

- `tools/test-client.mjs`：bundle 结构、插件 inject、**槽位未声明时的等待 / 重试**、注册幂等、卸载清理，并回归"不得使用 0.2.x 不存在的 `slots.inject()`"
- `tools/test-host.mjs`：Key 查找、余额查询与 60 秒缓存、路由注册与卸载钩子

客户端是否真的渲染**必须在界面里目视确认**：标题栏右侧应出现时钟与余额。挂件 DOM 带 `data-ds-peak-clock` / `data-ds-balance` 与 `data-ds-version` 属性，便于在 DevTools 里确认页面跑的是哪一版。

## 配置

### API Key 查找顺序（宿主侧，浏览器拿不到 Key）

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
| `tools/verify.mjs`、`tools/verify.bat` | 安装后验证（HTTP 探测 + 崩溃日志复查） |
| `tools/test-client.mjs`、`tools/test-host.mjs` | 离线单元测试（`npm test`） |
| `tools/paths.mjs` | 各工具共用的路径解析（`--profile` / `$DSH_PROFILE_DIR` / `$DSH_HOME`） |
| `tools/rollback.mjs` | 一键回滚 profile（依赖 + bundle 行） |
| `tools/restore-profile-config.mjs` | 合并恢复被应用清掉的 profile 用户配置行 |
| `tools/node.cmd` | 优先用 DSH Desktop 自带 Node，否则退回 PATH 里的 `node` |
| `restart-desktop-and-verify.bat` | Desktop：停 → 起 → 自动验证（内含本机 DSH 安装路径，按需修改） |

## 踩坑记录（写 DSH 插件的人建议都看一眼）

这三点是实际把桌面端起不来之后挖出来的，官方开发文档（`cordis-plugin-development` 技能）里都已写明：

1. **Host 插件必须用函数导出。** `export function apply(ctx, config)` + `export const inject = [...]`，**不要**写 `export default { inject, apply }` —— 带 `inject` 的非函数声明会被 Cordis 判定为激活失败。

2. **`ctx.slots.inject(ownerKey, cb)` 在 DSH 0.2.x 的 slots 服务上并不存在**（它是 0.1.x 文档 / 模板里的写法）。调用它直接抛错 → 客户端 entry 激活失败。**桌面端把"web boot entry 未激活"当致命错误**：弹崩溃并触发应用自带的原生致命恢复 `sanitizeProfile()`，把 `cordis.patch.yml` 备份改名并重写成默认文件——**你的 provider / 主题 / 模型配置会一起被清掉**。
   正确做法是自己等槽位声明：

   ```js
   // 槽位未声明时 slots.register 会抛 "slot ... is not declared"
   // slots.subscribe 允许在声明前先订阅，声明发生时回调
   const off = ctx.slots.subscribe(SLOT, () => {
     try { slots.register({ name: SLOT, id: 'my-widget' }, Widget) } catch { /* 还没声明，等下次 */ }
   })
   ```

3. **客户端 bundle 要 `immediately: true`**（`dsh.client`），否则它可能一直不被求值，被启动审计判为"未激活"。同时 `dsh.client.inject` 与 bundle 内插件对象的 `inject` 要保持一致。

另外两条工程经验：

- 手工接线时用 **junction / 软链**指向源码目录，不要依赖 pnpm 的 `file:` 安装副本 —— 副本会过期，而 `pnpm install` 在锁定未变时不会刷新它（实测会出现"改了没生效"的假象）。
- 桌面端前端走 `dsh-app://` 自有载体，客户端 bundle 由 `fetchBundle()` 分发，**不是** `dsh web` 那套 HTTP `/plugins/<id>/client.js` 路由；在那上面探测该路径必然 404，别据此判断插件没加载。

## 卸载

```powershell
node tools/rollback.mjs --apply   # 解绑 profile（依赖 + bundle 行）
```

然后重启应用。插件目录可自行删除。

## License

[MIT](LICENSE)
