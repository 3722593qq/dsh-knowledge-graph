import { promises as fs } from 'node:fs'
import path from 'node:path'

const origin = 'http://127.0.0.1:19400'
const token = process.argv[2]
const root = process.argv[3]
const login = await fetch(`${origin}/?token=${encodeURIComponent(token)}`, { redirect: 'manual' })
const cookie = login.headers.getSetCookie?.()[0]?.split(';', 1)[0] ?? login.headers.get('set-cookie')?.split(';', 1)[0]

async function save(text, label) {
  const started = Date.now()
  const response = await fetch(`${origin}/knowledge-graph/api/save`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, cookie },
    body: JSON.stringify({ text, source: 'selection' }),
  })
  const result = await response.json()
  const responded = Date.now() - started
  const wikiFiles = []
  for (const category of ['概念', '人物', '事物', '事件']) {
    try {
      for (const name of await fs.readdir(path.join(root, 'wiki', category))) wikiFiles.push(`wiki/${category}/${name}`)
    } catch {
      // Category directory is optional until the first page lands.
    }
  }
  const firstWikiMs = wikiFiles.length > 0 ? responded : null
  let status = null
  for (let index = 0; index < 80; index += 1) {
    const response2 = await fetch(`${origin}/knowledge-graph/api/status`, { headers: { cookie } })
    status = await response2.json()
    if (status.queue.running === null && status.queue.pending === 0) break
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return {
    label, http: response.status, result, respondedMs: responded,
    totalToIdleMs: Date.now() - started,
    wikiFiles, wikiChangedImmediately: firstWikiMs !== null,
    status,
  }
}

const first = await save('DeepSeek Harness 是一个可插拔的 Agent 运行时，由 DeepSeek 开发。它通过插件扩展工具、界面和模型能力。', 'A')
const second = await save('知识图谱是 DeepSeek Harness 的一个插件，它把资料整理成概念、人物、事物和事件页面，并通过双向链接连接这些页面。', 'B')

const graphResponse = await fetch(`${origin}/knowledge-graph/api/graph`, { headers: { cookie } })
const graph = await graphResponse.json()
const pages = {}
for (const category of ['概念', '人物', '事物', '事件']) {
  const dir = path.join(root, 'wiki', category)
  try {
    for (const name of await fs.readdir(dir)) {
      pages[`wiki/${category}/${name.replace(/\.md$/u, '')}`] = await fs.readFile(path.join(dir, name), 'utf8')
    }
  } catch {
    // No page in this category.
  }
}
const reciprocal = []
for (const [id, content] of Object.entries(pages)) {
  for (const match of content.matchAll(/\[\[([^\]|#]+)/gu)) {
    const target = match[1].replace(/\.md$/u, '')
    const targetContent = pages[target]
    if (targetContent !== undefined && targetContent.includes(`[[${id}`)) reciprocal.push([id, target])
  }
}
console.log(JSON.stringify({ first, second, graph, pages: Object.keys(pages), reciprocal }, null, 2))
