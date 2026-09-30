/**
 * 工具共用的路径解析（避免任何机器相关的硬编码路径）
 * ---------------------------------------------------------------
 * 解析顺序：
 *   profile 目录：--profile <dir> > $DSH_PROFILE_DIR > $DSH_HOME/profiles/desktop
 *                 > ~/.dsh/profiles/desktop
 *   DSH_HOME    ：$DSH_HOME > $HOME/.dsh > ~/.dsh
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export function argValue(flag) {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

export function dshHome() {
  if (process.env.DSH_HOME) return resolve(process.env.DSH_HOME)
  if (process.env.HOME) return join(process.env.HOME, '.dsh')
  return join(homedir(), '.dsh')
}

/** @returns {string} profile 目录的绝对路径 */
export function profileDir(profileName = 'desktop') {
  const explicit = argValue('--profile')
  if (explicit) return resolve(explicit)
  if (process.env.DSH_PROFILE_DIR) return resolve(process.env.DSH_PROFILE_DIR)
  return join(dshHome(), 'profiles', profileName)
}

/** @returns {string} 插件仓库根目录 */
export function pluginRoot() {
  return resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
}

/** 找出桌面端 Electron userData 下的崩溃日志目录（不存在则返回候选路径）。 */
export function crashLogDir() {
  const explicit = argValue('--logs')
  if (explicit) return resolve(explicit)
  const candidates = [
    join(homedir(), 'AppData/Roaming/@deepseek-ai/dsh-desktop/logs'), // Windows
    join(homedir(), 'Library/Application Support/@deepseek-ai/dsh-desktop/logs'), // macOS
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), '@deepseek-ai/dsh-desktop/logs'), // Linux
  ]
  return candidates.find((p) => existsSync(p)) ?? candidates[0]
}
