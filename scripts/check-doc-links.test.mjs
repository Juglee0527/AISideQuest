import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { checkDocumentation } from './check-doc-links.mjs'

test('all repository Markdown links resolve and human docs use Korean filenames', async () => {
  const result = await checkDocumentation(fileURLToPath(new URL('..', import.meta.url)))
  assert.deepEqual(result.problems, [])
  assert.ok(result.filesChecked >= 20)
})
