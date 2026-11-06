import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { KnowledgeStore } from '../lib/store.js'

const root = await mkdtemp(path.join(os.tmpdir(), 'kg-delete-'))
const store = new KnowledgeStore(root)
store.initSync()
await store.applyUpdates([
  {
    title: '删除测试 A', category: '概念', summary: 'A', definition: 'A',
    keyPoints: ['a'], supplements: [], relations: ['wiki/概念/删除测试 B'], conflicts: '',
  },
  {
    title: '删除测试 B', category: '概念', summary: 'B', definition: 'B',
    keyPoints: ['b'], supplements: [], relations: ['wiki/概念/删除测试 A'], conflicts: '',
  },
], null)
const before = await store.buildGraph()
const result = await store.deletePage('wiki/概念/删除测试 B')
const after = await store.buildGraph()
const a = await store.readPage('wiki/概念/删除测试 A')
let missing = false
try {
  await store.readPage('wiki/概念/删除测试 B')
} catch {
  missing = true
}
let rejected = false
try {
  await store.deletePage('index.md')
} catch {
  rejected = true
}
const index = await store.readIndex()
const log = await store.readText('log.md')
console.log(JSON.stringify({
  before: { nodes: before.nodes.length, edges: before.edges.length },
  result,
  after: { nodes: after.nodes.length, edges: after.edges.length },
  pageRemoved: missing,
  reciprocalRemoved: !a.body.includes('删除测试 B'),
  indexCountLine: index.content.split('\n').find(line => line.includes('共 ')),
  logged: log.includes('删除页面「删除测试 B」'),
  nonWikiRejected: rejected,
}, null, 2))
await rm(root, { recursive: true, force: true })
