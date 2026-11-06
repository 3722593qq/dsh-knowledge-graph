import { mkdtemp, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../lib/index.js'

const root = await mkdtemp(path.join(os.tmpdir(), 'kg-tools-'))
const tools = new Map()
let section = null
const ctx = {
  effect(fn) {
    const dispose = fn()
    return () => { if (typeof dispose === 'function') dispose() }
  },
  tools: {
    register(definition) {
      tools.set(definition.name, definition)
      return () => tools.delete(definition.name)
    },
  },
  systemPrompt: { section: value => { section = value; return () => {} } },
  get(name) {
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'p', model: 'm' }) }
    if (name === 'llm') return { stream: async function* () { yield { type: 'text-delta', index: 0, text: '{"pages":[]}' }; yield { type: 'finish', reason: { kind: 'stop' } } } }
    return undefined
  },
  inject(_services, callback) { callback({ effect: fn => fn(), webServer: { register: () => () => {} } }) },
}

apply(ctx, { rootDir: root })
console.log('tools', [...tools.keys()].map(name => ({ name, description: tools.get(name).description.slice(0, 50) })))
console.log('section', section.name, section.order, section.text.includes('knowledge_index'), section.text.includes('知识来源'))
const index = await tools.get('knowledge_index').execute({}, { signal: new AbortController().signal })
console.log('index', index.path, index.content.slice(0, 20))
const save = await tools.get('knowledge_search').execute({ query: '不存在' }, { signal: new AbortController().signal })
console.log('search', save)
const graph = await tools.get('knowledge_graph').execute({ depth: 2 }, { signal: new AbortController().signal })
console.log('graph', graph)
const read = await tools.get('knowledge_read').execute({ path: 'index.md' }, { signal: new AbortController().signal })
console.log('read', read.title, read.content.slice(0, 20))
console.log('raw exists', await readFile(path.join(root, 'index.md'), 'utf8').then(() => true))
await rm(root, { recursive: true, force: true })
