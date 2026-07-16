import { randomUUID } from 'node:crypto'
import { open, readFile, rm } from 'node:fs/promises'

const DEFAULT_LOCK_WAIT_MS = 2_000
const DEFAULT_STALE_LOCK_MS = 30_000

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function isProcessAlive(processId) {
  if (!Number.isInteger(processId) || processId <= 0) {
    return false
  }

  try {
    process.kill(processId, 0)
    return true
  } catch {
    return false
  }
}

async function readLock(lockPath) {
  try {
    const value = JSON.parse(await readFile(lockPath, 'utf8'))

    if (
      typeof value === 'object'
      && value !== null
      && Number.isInteger(value.pid)
      && typeof value.token === 'string'
      && typeof value.createdAt === 'string'
    ) {
      return value
    }
  } catch {
    return null
  }

  return null
}

async function removeStaleLock(lockPath, staleAfterMs) {
  const lock = await readLock(lockPath)
  const createdAt = lock ? Date.parse(lock.createdAt) : Number.NaN
  const staleByAge = !Number.isFinite(createdAt)
    || Date.now() - createdAt > staleAfterMs
  const staleByProcess = !lock || !isProcessAlive(lock.pid)

  if (!staleByAge && !staleByProcess) {
    return false
  }

  try {
    await rm(lockPath)
    return true
  } catch {
    return false
  }
}

async function releaseOwnedLock(lockPath, token) {
  const lock = await readLock(lockPath)

  if (lock?.token !== token) {
    return
  }

  await rm(lockPath, { force: true })
}

export async function acquireFileLock(
  lockPath,
  {
    waitMs = DEFAULT_LOCK_WAIT_MS,
    staleAfterMs = DEFAULT_STALE_LOCK_MS,
  } = {},
) {
  const deadline = Date.now() + waitMs

  while (Date.now() <= deadline) {
    const token = randomUUID()

    try {
      const handle = await open(lockPath, 'wx', 0o600)

      try {
        await handle.writeFile(JSON.stringify({
          pid: process.pid,
          token,
          createdAt: new Date().toISOString(),
        }))
        await handle.sync()
      } finally {
        await handle.close()
      }

      return () => releaseOwnedLock(lockPath, token)
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error
      }

      if (await removeStaleLock(lockPath, staleAfterMs)) {
        continue
      }

      await delay(20 + Math.floor(Math.random() * 30))
    }
  }

  throw new Error('AISideQuest 로컬 queue 잠금을 획득하지 못했습니다.')
}

export async function tryAcquireProcessLock(lockPath) {
  try {
    return await acquireFileLock(lockPath, {
      waitMs: 0,
      staleAfterMs: Number.MAX_SAFE_INTEGER,
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes('잠금을 획득')) {
      return null
    }

    throw error
  }
}
