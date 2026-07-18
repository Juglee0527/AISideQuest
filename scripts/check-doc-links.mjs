import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const EXCLUDED_DIRECTORIES = new Set([
  '.git', '.idea', '.pnpm-store', 'dist', 'node_modules',
  'playwright-report', 'server/dist', 'server/dist-test', 'test-results',
])

async function collectMarkdownFiles(root, directory = root) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const key = relative(root, path).replaceAll('\\', '/')
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name) && !EXCLUDED_DIRECTORIES.has(key)) {
        files.push(...await collectMarkdownFiles(root, path))
      }
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
      files.push(path)
    }
  }
  return files
}

function linkTarget(rawTarget) {
  const trimmed = rawTarget.trim()
  if (trimmed.startsWith('<')) return trimmed.slice(1, trimmed.indexOf('>'))
  return trimmed.split(/\s+["']/u, 1)[0]
}

export async function checkDocumentation(rootDirectory) {
  const root = resolve(rootDirectory)
  const files = await collectMarkdownFiles(root)
  const problems = []

  for (const file of files) {
    const source = await readFile(file, 'utf8')
    const pattern = /!?\[[^\]]*\]\(([^)]+)\)/gu
    for (const match of source.matchAll(pattern)) {
      const target = linkTarget(match[1])
      if (!target || target.startsWith('#') || /^(?:https?:|mailto:|data:)/iu.test(target)) continue
      let decoded
      try {
        decoded = decodeURIComponent(target.split('#', 1)[0].split('?', 1)[0])
      } catch {
        problems.push(`${relative(root, file)}: invalid URL encoding in ${target}`)
        continue
      }
      const resolved = resolve(dirname(file), decoded)
      if (!resolved.startsWith(root)) {
        problems.push(`${relative(root, file)}: link escapes repository: ${target}`)
        continue
      }
      try {
        await stat(resolved)
      } catch {
        problems.push(`${relative(root, file)}: missing link target ${target}`)
      }
    }
  }

  const docsRoot = join(root, 'docs')
  for (const entry of await readdir(docsRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md') && !/[가-힣]/u.test(entry.name)) {
      problems.push(`docs/${entry.name}: human-facing docs must use a Korean filename`)
    }
  }

  return { filesChecked: files.length, problems }
}

async function main() {
  const root = process.argv[2] ?? process.cwd()
  const result = await checkDocumentation(root)
  if (result.problems.length > 0) {
    throw new Error(`documentation check failed:\n- ${result.problems.join('\n- ')}`)
  }
  process.stdout.write(`documentation links are valid (${result.filesChecked} Markdown files)\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
