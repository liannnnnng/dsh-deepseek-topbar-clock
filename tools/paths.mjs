/**
 * 工具共用的路径解析（避免机器相关的硬编码路径）
 * ---------------------------------------------------------------
 * 解析顺序：
 *   profile 目录：--profile <dir> > $DSH_PROFILE_DIR > $DSH_HOME/profiles/desktop
 *                 > ~/.dsh/profiles/desktop
 *   DSH_HOME    ：$DSH_HOME > $HOME/.dsh > ~/.dsh
 */
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

/** @returns {string} DSH 桌面端 profile 目录的绝对路径 */
export function profileDir(profileName = 'desktop') {
  const explicit = argValue('--profile')
  if (explicit) return resolve(explicit)
  if (process.env.DSH_PROFILE_DIR) return resolve(process.env.DSH_PROFILE_DIR)
  return join(dshHome(), 'profiles', profileName)
}
