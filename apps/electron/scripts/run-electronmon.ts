#!/usr/bin/env bun
/**
 * 启动 electronmon，始终以本脚本所在的 apps/electron 目录作为 CWD
 * 解决 monorepo 中 CWD 不一致导致 electron 入口文件路径错误的问题
 *
 * 使用：bun run scripts/run-electronmon.ts
 * 由 dev:electron 脚本调用。
 */
import { resolve } from 'path'
import { spawn } from 'child_process'

// 脚本所在目录 = apps/electron/scripts/
// 上翻一级 = apps/electron/
const electronRoot = resolve(import.meta.dirname, '..')

// 显式 settings CWD
process.chdir(electronRoot)

// electronmon 会基于 CWD 找 electron 包 + package.json 配置
// Electron 收到 dist/main.cjs 参数，直接加载该入口文件
const child = spawn('bunx', ['electronmon', 'dist/main.cjs'], {
  cwd: electronRoot,
  stdio: 'inherit',
  shell: true,
})

child.on('exit', (code) => {
  process.exit(code ?? 0)
})
