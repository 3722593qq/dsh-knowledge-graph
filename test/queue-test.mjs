import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { KnowledgeStore } from '../lib/store.js'
import { Organizer } from '../lib/organizer.js'

const root = await mkdtemp(path.join(os.tmpdir(), 'kg-queue-'))
const store = new KnowledgeStore(root)
store.initSync()
let active = 0
let maxActive = 0
const ctx = {
  get(name) {
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'p', model: 'm' }) }
    if (name === 'llm') {
      return {
        async *stream(options) {
          active += 1
          maxActive = Math.max(maxActive, active)
          try {
            const prompt = options.messages[0].content[0].text
            await new Promise(resolve => setTimeout(resolve, 40))
            if (prompt.includes('FAIL')) throw new Error('synthetic failure')
            const payload = {
              pages: [{
                path: '', title: prompt.includes('B') ? '队列 B' : '队列 A', category: '概念',
                summary: '串行测试页面', definition: '测试', keyPoints: ['一'], supplements: [],
                relations: [], conflicts: '',
              }],
              log: '串行整理',
            }
            yield { type: 'text-delta', index: 0, text: JSON.stringify(payload) }
            yield { type: 'finish', reason: { kind: 'stop' } }
          } finally {
            active -= 1
          }
        },
      }
    }
    return undefined
  },
}

const organizer = new Organizer({ ctx, store, config: {}, onStatus: () => {} })
const job = (title, text) => ({
  id: title, title, text, rawPath: `资料/${title}.md`, source: 'selection',
  categoryHint: '概念', createdAt: Date.now(), startedAt: Date.now(),
})
organizer.enqueue(job('A', 'A 的资料'))
organizer.enqueue(job('FAIL', 'FAIL 的资料'))
organizer.enqueue(job('B', 'B 的资料'))
const started = Date.now()
while (organizer.running || organizer.queue.length > 0 || organizer.current !== null) {
  await new Promise(resolve => setTimeout(resolve, 30))
  if (Date.now() - started > 10000) throw new Error('queue timeout')
}
console.log(JSON.stringify({
  maxActive,
  recent: organizer.recent.map(item => ({ title: item.title, status: item.status, error: item.error ?? null })),
  pages: (await store.loadPages()).map(page => page.title),
  log: await store.readPage('../log.md').catch(() => null),
}, null, 2))
console.log((await store.readText('log.md')).trim())
await rm(root, { recursive: true, force: true })
