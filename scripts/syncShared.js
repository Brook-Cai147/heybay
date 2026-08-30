/**
 * 把 `cloudfunctions/_shared` 复制进每个云函数目录（M1-08 定下的共享方式）。
 *
 * 为什么必须复制：微信开发者工具上传云函数时，只打包**该函数目录内部**的文件，
 * `require('../_shared/...')` 这种跨目录引用在云端根本不存在，函数一跑就 MODULE_NOT_FOUND。
 * 三种备选里选了复制：
 *   - 软链接：Windows 下建符号链接要管理员权限或开发者模式，个人开发机上不可靠
 *   - npm `file:` 本地依赖：要在每个函数里维护 package.json 依赖 + 云端安装，链路更长更易碎
 *   - 复制：一条命令、零依赖、失败原因显而易见；代价是上传前必须记得跑一次
 *
 * 副本由 `.gitignore` 排除（忽略规则见 .gitignore 里的 cloudfunctions 副本那一条），
 * **唯一的真源是 `cloudfunctions/_shared`**。
 * 改共享代码后请务必重新执行 `npm run sync`，否则云端跑的是旧副本 —— 这是本方案最容易踩的坑。
 *
 * 用法：npm run sync
 */

const fs = require('fs')
const path = require('path')

const CLOUDFUNCTIONS_DIR = path.join(__dirname, '..', 'cloudfunctions')
const SHARED_DIR = path.join(CLOUDFUNCTIONS_DIR, '_shared')
const SHARED_NAME = '_shared'

/** 递归复制目录，逐文件写入（不用 fs.cpSync，避免依赖较新 Node 的实验性 API） */
const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true })
  let count = 0
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name)
    const dest = path.join(to, entry.name)
    if (entry.isDirectory()) {
      count += copyDir(src, dest)
    } else if (entry.isFile()) {
      fs.copyFileSync(src, dest)
      count += 1
    }
  }
  return count
}

const main = () => {
  if (!fs.existsSync(SHARED_DIR)) {
    console.error(`[sync] 找不到 ${SHARED_DIR}`)
    process.exit(1)
  }

  const targets = fs
    .readdirSync(CLOUDFUNCTIONS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== SHARED_NAME)
    .map(entry => entry.name)

  if (!targets.length) {
    console.log('[sync] 还没有云函数目录，无需同步')
    return
  }

  for (const name of targets) {
    const dest = path.join(CLOUDFUNCTIONS_DIR, name, SHARED_NAME)
    // 先删旧副本：否则真源里删掉的文件会在副本里残留，云端仍能 require 到已删除的模块
    fs.rmSync(dest, { recursive: true, force: true })
    const count = copyDir(SHARED_DIR, dest)
    console.log(`[sync] ${name}/_shared ← ${count} 个文件`)
  }

  console.log(`[sync] 完成，共 ${targets.length} 个云函数。上传前请确保刚跑过本命令。`)
}

main()
