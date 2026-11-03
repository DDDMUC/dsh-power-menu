// dsh-power-menu-win — 目标识别守卫的单元测试（node:test，无依赖）。
//
// 这个插件要杀的是"桌面版主程序"。判错了会怎样：
//
//   * 把 `dsh web` 的启动壳（cmd / powershell）当成主程序杀掉 —— 而 Windows 上没有
//     launchd / systemd 托底，进程再也不会回来，等于"重启"把应用关死了；
//   * 把插件自己 spawn 的 node.exe 当成主程序 —— 静默误杀。
//
// 判据在 `parentIsDesktopApp()` 里，纯函数，不碰进程表，所以能在任何平台上测。

import test from 'node:test'
import assert from 'node:assert/strict'

import { parentIsDesktopApp } from '../lib/index.js'

const SELF = 'C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe'

test('守卫：不是 electron 模式就不是桌面版', () => {
  assert.equal(parentIsDesktopApp({}), false)
  assert.equal(parentIsDesktopApp({ electronRunAsNode: '0' }), false)
  assert.equal(parentIsDesktopApp({ electronRunAsNode: undefined, marker: SELF }), false)
})

test('守卫：桌面版自己带的标记优先，且不必查 WMI', () => {
  // 桌面版给 host 的子进程带 DSH_DESKTOP_NODE_EXECUTABLE；父进程镜像这里故意给 null，
  // 表示"根本没查"，结论仍然必须成立。
  assert.equal(parentIsDesktopApp({ electronRunAsNode: '1', marker: SELF, parentImage: null }), true)
})

test('守卫：从 cmd / powershell 起的 dsh web 不算桌面版', () => {
  // 这是真正要防的那一类：ELECTRON_RUN_AS_NODE 同样是 1，exe 同样是主程序，
  // 只有父进程不同。认错就会杀掉启动壳且无人重启。
  for (const shell of [
    'C:\\Windows\\System32\\cmd.exe',
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    'C:\\Program Files\\nodejs\\node.exe',
  ]) {
    assert.equal(parentIsDesktopApp({ electronRunAsNode: '1', parentImage: shell, selfExe: SELF }), false, shell)
  }
})

test('守卫：父进程镜像与自身 exe 同名才算桌面版', () => {
  assert.equal(parentIsDesktopApp({ electronRunAsNode: '1', parentImage: SELF, selfExe: SELF }), true)
  // 大小写不敏感（Windows 路径大小写随安装位置变）。
  assert.equal(parentIsDesktopApp({ electronRunAsNode: '1', parentImage: SELF.toUpperCase(), selfExe: SELF }), true)
  assert.equal(
    parentIsDesktopApp({ electronRunAsNode: '1', parentImage: 'C:\\Other\\Other.exe', selfExe: SELF }),
    false,
  )
})

test('守卫：查不到父进程镜像时保持现状，不把插件废掉', () => {
  // WMI 不可用 / 被策略挡住 / 超时都会走到这里。宁可沿用老行为（认），
  // 也不要因为查不到就让整个电源菜单消失。
  assert.equal(parentIsDesktopApp({ electronRunAsNode: '1', parentImage: null, selfExe: SELF }), true)
  assert.equal(parentIsDesktopApp({ electronRunAsNode: '1', parentImage: '', selfExe: SELF }), true)
})
