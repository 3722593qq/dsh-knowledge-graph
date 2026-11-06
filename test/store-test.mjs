import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { KnowledgeStore } from '../lib/store.js'

const root = await mkdtemp(path.join(os.tmpdir(), 'kg-test-'))
const store = new KnowledgeStore(root)
store.initSync()
console.log('root', root)
const raw = await store.saveRaw('DeepSeek Harness 是一个可插拔的 Agent 运行时。它支持插件和工具。', { source: 'selection' })
console.log('raw', raw)
let page = await store.bootstrapPage('DeepSeek Harness 是一个可插拔的 Agent 运行时', 'DeepSeek Harness 是一个可插拔的 Agent 运行时。它支持插件和工具。', raw, 'selection')
console.log('page', page)
await store.applyUpdates([
  {
    title: 'DeepSeek Harness', category: '事物', summary: '可插拔的 Agent 运行时。',
    definition: 'DeepSeek Harness 是一个可插拔的 Agent 运行时。',
    keyPoints: ['支持插件', '支持工具'], supplements: [], relations: ['wiki/概念/Agent 运行时'],
  },
  {
    title: 'Agent 运行时', category: '概念', summary: '承载 Agent 循环的运行时。',
    definition: 'Agent 运行时负责模型、工具与会话的生命周期。',
    keyPoints: ['会话'], supplements: [], relations: ['wiki/事物/DeepSeek Harness'],
  },
], raw)
console.log('index\n' + await readFile(path.join(root, 'index.md'), 'utf8'))
const graph = await store.buildGraph()
console.log('graph', JSON.stringify(graph, null, 2))
const pages = await store.loadPages()
for (const page of pages) console.log('\n---', page.path, '\n', page.body)
await rm(root, { recursive: true, force: true })
