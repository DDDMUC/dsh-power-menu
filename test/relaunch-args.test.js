// 重启必须把 --user-data-dir 带回去，否则隔离 home 会抢另一个 home 的单实例锁然后秒退。
//
// 0.2.6 及以前：helper 在 main 已经被杀掉之后才去读 argv，而 argv 只存在于那个
// 已经死掉的进程里，所以只能靠用户手写 relaunch-args.json。文件不存在就静默返回
// 空数组 —— 两套 home 共用同一个 appId，重启后新实例丢了 user-data-dir，撞锁退出。
//
// 现在：由 host 在**生成 handoff 时**（main 还活着）从 WMI 读一次 CommandLine，
// 解析出这一个开关写进 handoff；helper 优先用它，文件只作老 handoff 的兼容。

import test from 'node:test'
import assert from 'node:assert/strict'

import { splitCommandLine, userDataDirFrom } from '../lib/index.js'

test('argv 拆分：引号内的空格不拆开', () => {
  assert.deepEqual(
    splitCommandLine('"C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe" --user-data-dir="C:\\Users\\me\\AppData\\Roaming"'),
    ['C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe', '--user-data-dir=C:\\Users\\me\\AppData\\Roaming'],
  )
})

test('argv 拆分：连续空格与制表符不产生空 token', () => {
  assert.deepEqual(splitCommandLine('a.exe   --x\t\t--y'), ['a.exe', '--x', '--y'])
})

test('user-data-dir：等号写法', () => {
  assert.equal(
    userDataDirFrom('C:\\apps\\dsh-desktop\\dsh-desktop.exe --user-data-dir=D:/home/userdata'),
    'D:/home/userdata',
  )
})

test('user-data-dir：空格写法，且引号内的空格属于路径', () => {
  assert.equal(
    userDataDirFrom('"C:\\x.exe" --user-data-dir "D:/my dir" --type=gpu'),
    'D:/my dir',
  )
})

test('user-data-dir：默认 profile（命令里没有这个开关）返回 undefined', () => {
  assert.equal(
    userDataDirFrom('"C:\\apps\\dsh-desktop\\dsh-desktop.exe"'),
    undefined,
  )
  assert.equal(userDataDirFrom(''), undefined)
  assert.equal(userDataDirFrom(undefined), undefined)
})

test('user-data-dir：开关后面没有值时不吞下一个开关', () => {
  assert.equal(userDataDirFrom('a.exe --user-data-dir --type=gpu'), undefined)
})

test('user-data-dir：只返回这一个开关，不夹带 Chromium 内部参数', () => {
  const argv = 'a.exe --user-data-dir=D:/home --type=renderer --field-trial-handle=123 --mojo-platform-channel-handle=456'
  assert.equal(userDataDirFrom(argv), 'D:/home')
  // 这一点是关键：把 chromiums 的内部开关replay 到新实例会带进已经失效的句柄。
  assert.equal(splitCommandLine(argv).includes('--type=renderer'), true)
})
