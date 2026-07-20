import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'

function processExists(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function acquireProcessLock(path) {
  try {
    await mkdir(path)
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error

    let owner
    try {
      owner = JSON.parse(await readFile(`${path}/owner.json`, 'utf8'))
    } catch {
      owner = null
    }

    if (processExists(owner?.pid)) return null
    await rm(path, { recursive: true, force: true })
    await mkdir(path)
  }

  await writeFile(`${path}/owner.json`, JSON.stringify({ pid: process.pid }), 'utf8')
  return async () => rm(path, { recursive: true, force: true })
}
