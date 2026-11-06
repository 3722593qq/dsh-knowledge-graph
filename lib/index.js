/**
 * Host half of the knowledge-graph plugin: durable vault, background model
 * organizer, read-only Agent tools, and the same-origin HTTP face used by the
 * browser panel.
 */
import os from 'node:os'
import path from 'node:path'
import { firstSentence } from './util.js'
import { KnowledgeStore } from './store.js'
import { Organizer, categoryHintFromPath, jobId } from './organizer.js'

export const name = 'knowledge-graph'
export const inject = ['tools', 'systemPrompt']

const API = '/knowledge-graph/api'
const MAX_BODY = 1024 * 1024
const MAX_TEXT = 500_000

const RULES = `## 知识图谱

当前部署有一个共享的 Obsidian 风格知识库（DeepSeek Harness 数据目录下的 knowledge/）。
- 当用户的问题可能与已存知识相关时，先调用 knowledge_index 读取 index.md，再调用 knowledge_read 打开相关页面；不要凭记忆猜。
- 需要定位页面时用 knowledge_search，需要看局部关系时用 knowledge_graph。
- 回答末尾必须标注实际使用的页面：知识来源：[[wiki/...]]；没有使用知识库时不要标注。
- 你不能写知识库；写入只由用户在界面上执行。`

/** Resolve the vault root from config, environment, or the DSH data home. */
function vaultRoot(config) {
  const configured = String(config?.rootDir ?? '').trim()
  if (configured !== '') {
    const home = process.env.DSH_HOME?.trim() || path.join(os.homedir(), '.dsh')
    return path.isAbsolute(configured) ? configured : path.join(home, configured)
  }
  const fromEnvironment = String(process.env.DSH_KNOWLEDGE_DIR ?? '').trim()
  if (fromEnvironment !== '') return path.resolve(fromEnvironment)
  const home = process.env.DSH_HOME?.trim() || path.join(os.homedir(), '.dsh')
  return path.join(home, 'knowledge')
}

/** Send one JSON response with no-store caching. */
function sendJson(res, status, value) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(value))
}

/** Reject a request using the composition's Host/Origin/login-token fence. */
function rejected(ctx, req, res) {
  const connection = ctx.get('connection')
  if (connection === undefined || typeof connection.requestRejection !== 'function') return false
  const status = connection.requestRejection(req)
  if (status === undefined) return false
  res.statusCode = status
  res.end()
  return true
}

/** Read a JSON body with a hard byte cap. */
async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (total === 0) throw new Error('请求体为空')
  const essence = String(req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase()
  if (essence !== 'application/json') throw new Error('content-type 必须是 application/json')
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Validate one save request. */
function parseSave(body) {
  const text = String(body?.text ?? '').replace(/\r\n?/gu, '\n').trim()
  if (text === '') throw new Error('没有可保存的文字')
  if (text.length > MAX_TEXT) throw new Error('文字过长')
  const source = ['selection', 'assistant', 'user'].includes(body?.source) ? body.source : 'selection'
  return { text, source }
}

/** Build a compact graph around one center with a bounded BFS depth. */
async function localGraph(store, center, depth) {
  const graph = await store.buildGraph()
  const ids = new Set(graph.nodes.map(node => node.id))
  const root = center && ids.has(center) ? center : graph.nodes.slice().sort((a, b) => b.degree - a.degree)[0]?.id
  if (root === undefined) return { nodes: [], edges: [], center: null }
  const adjacency = new Map(graph.nodes.map(node => [node.id, new Set()]))
  for (const edge of graph.edges) {
    adjacency.get(edge.source)?.add(edge.target)
    adjacency.get(edge.target)?.add(edge.source)
  }
  const levels = new Map([[root, 0]])
  const queue = [root]
  while (queue.length > 0) {
    const current = queue.shift()
    const level = levels.get(current) ?? 0
    if (level >= depth) continue
    for (const next of adjacency.get(current) ?? []) {
      if (levels.has(next)) continue
      levels.set(next, level + 1)
      queue.push(next)
    }
  }
  return {
    nodes: graph.nodes.filter(node => levels.has(node.id)),
    edges: graph.edges.filter(edge => levels.has(edge.source) && levels.has(edge.target)),
    center: root,
    depth,
  }
}

/** Register the read-only model tools. */
function registerTools(ctx, store) {
  const register = definition => {
    const dispose = ctx.tools.register(definition)
    ctx.effect(() => dispose, `knowledge-graph: tool ${definition.name}`)
  }

  register({
    name: 'knowledge_index',
    description: '读取知识库的全量索引 index.md。问题可能与已存知识相关时，先调用这个工具。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: value.content }],
    },
    async execute(_args, exec) {
      if (exec.signal.aborted) throw new Error('已取消')
      const index = await store.readIndex()
      return { path: index.path, content: index.content }
    },
  })

  register({
    name: 'knowledge_read',
    description: '读取知识库中的一页 wiki 页面或索引。路径来自 index.md 或 knowledge_search 的返回。',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: '知识库相对路径，例如 wiki/概念/示例.md' } },
      required: ['path'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          title: { type: 'string' },
          category: { type: 'string' },
          summary: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'title', 'category', 'summary', 'content'],
        additionalProperties: false,
      },
      render: (_args, value) => [{
        type: 'text',
        text: `# ${value.title}\n\n分类：${value.category}\n摘要：${value.summary}\n路径：${value.path}\n\n${value.content}`,
      }],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) throw new Error('已取消')
      const raw = String(args?.path ?? '').trim()
      if (raw === '') throw new Error('path 不能为空')
      if (raw === 'index.md' || raw === 'log.md') {
        const content = await store.readText(raw)
        return { path: raw, title: raw === 'index.md' ? '知识索引' : '知识日志', category: '索引', summary: '', content }
      }
      const page = await store.readPage(raw)
      return { path: page.path, title: page.title, category: page.category, summary: page.summary, content: page.content }
    },
  })

  register({
    name: 'knowledge_search',
    description: '在知识库中搜索标题、摘要和正文，返回最相关的页面路径。只读。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索词' },
        limit: { type: 'number', description: '最多返回几页，默认 8' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                title: { type: 'string' },
                category: { type: 'string' },
                summary: { type: 'string' },
              },
              required: ['path', 'title', 'category', 'summary'],
              additionalProperties: false,
            },
          },
        },
        required: ['query', 'results'],
        additionalProperties: false,
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.results.length === 0
          ? `没有找到与「${value.query}」相关的页面。`
          : value.results.map(page => `- ${page.path} · ${page.title} — ${page.summary}`).join('\n'),
      }],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) throw new Error('已取消')
      const query = String(args?.query ?? '').trim()
      if (query === '') throw new Error('query 不能为空')
      const limit = Math.max(1, Math.min(30, Number(args?.limit ?? 8) || 8))
      const results = await store.search(query, limit)
      return {
        query,
        results: results.map(page => ({
          path: page.path,
          title: page.title,
          category: page.category,
          summary: page.summary,
        })),
      }
    },
  })

  register({
    name: 'knowledge_graph',
    description: '读取知识图谱的局部关系。path 是中心页面，depth 是 1–5 层邻居，默认 2。只读。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '中心页面的知识库相对路径；省略时从连接最多的页面开始' },
        depth: { type: 'number', description: '邻居层数 1–5，默认 2' },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          center: { type: 'string', description: '中心页面路径；空图时为空字符串' },
          depth: { type: 'number' },
          nodes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                category: { type: 'string' },
                degree: { type: 'number' },
              },
              required: ['id', 'title', 'category', 'degree'],
              additionalProperties: false,
            },
          },
          edges: {
            type: 'array',
            items: {
              type: 'object',
              properties: { source: { type: 'string' }, target: { type: 'string' } },
              required: ['source', 'target'],
              additionalProperties: false,
            },
          },
        },
        required: ['center', 'depth', 'nodes', 'edges'],
        additionalProperties: false,
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `中心：${value.center || '（空图）'} · ${value.depth} 层 · ${value.nodes.length} 个节点`,
          ...value.nodes.map(node => `- ${node.id} · ${node.title}（${node.category}，连接 ${node.degree}）`),
        ].join('\n'),
      }],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) throw new Error('已取消')
      const depth = Math.max(1, Math.min(5, Number(args?.depth ?? 2) || 2))
      const graph = await localGraph(store, String(args?.path ?? '').trim(), depth)
      return {
        center: graph.center ?? '',
        depth,
        nodes: graph.nodes.map(node => ({
          id: node.id, title: node.title, category: node.category, degree: node.degree,
        })),
        edges: graph.edges.map(edge => ({ source: edge.source, target: edge.target })),
      }
    },
  })
}

/** Register HTTP routes on the Web composition when available. */
function registerRoutes(ctx, store, organizer) {
  ctx.inject(['webServer'], webCtx => {
    const route = (pathName, handler) => {
      webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: pathName, handler }), `knowledge-graph: ${pathName}`)
    }

    route(`${API}/status`, async (req, res) => {
      if (rejected(ctx, req, res)) return
      if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
      try {
        const graph = await store.buildGraph()
        const counts = { 概念: 0, 人物: 0, 事物: 0, 事件: 0 }
        for (const node of graph.nodes) counts[node.category] = (counts[node.category] ?? 0) + 1
        let model = null
        try {
          const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
          model = selection === undefined ? null : { provider: selection.provider, model: selection.model }
        } catch {
          model = null
        }
        sendJson(res, 200, {
          ok: true,
          root: store.root,
          stats: { pages: graph.nodes.length, links: graph.edges.length, ...counts },
          queue: organizer.status(),
          model,
        })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    })

    route(`${API}/graph`, async (req, res) => {
      if (rejected(ctx, req, res)) return
      if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
      try {
        const graph = await store.buildGraph()
        sendJson(res, 200, { ok: true, ...graph })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    })

    route(`${API}/page`, async (req, res) => {
      if (rejected(ctx, req, res)) return
      if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
      try {
        const url = new URL(String(req.url ?? ''), 'http://localhost')
        const relativePath = url.searchParams.get('path') ?? ''
        if (relativePath.trim() === '') return sendJson(res, 400, { ok: false, error: 'path 不能为空' })
        const page = await store.panelPage(relativePath)
        sendJson(res, 200, { ok: true, ...page })
      } catch (error) {
        sendJson(res, 404, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    })

    route(`${API}/save`, async (req, res) => {
      if (rejected(ctx, req, res)) return
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
      try {
        const body = await readJsonBody(req)
        const { text, source } = parseSave(body)
        const title = firstSentence(text)
        const rawPath = await store.saveRaw(text, { source })
        const wikiPath = await store.bootstrapPage(title, text, rawPath, source)
        await store.rebuildIndex()
        const job = {
          id: jobId(),
          title,
          text,
          rawPath,
          source,
          categoryHint: categoryHintFromPath(wikiPath),
          createdAt: Date.now(),
          startedAt: Date.now(),
        }
        organizer.enqueue(job)
        sendJson(res, 200, {
          ok: true,
          title,
          rawPath,
          wikiPath,
          queued: organizer.status().pending,
        })
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    })

    route(`${API}/delete`, async (req, res) => {
      if (rejected(ctx, req, res)) return
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
      try {
        const body = await readJsonBody(req)
        const relativePath = String(body?.path ?? '').trim()
        if (relativePath === '') return sendJson(res, 400, { ok: false, error: 'path 不能为空' })
        const queue = organizer.status()
        if (queue.running !== null || queue.pending > 0) {
          return sendJson(res, 409, { ok: false, error: '整理队列正在工作，请等它空闲后再删除' })
        }
        const result = await store.deletePage(relativePath)
        sendJson(res, 200, { ok: true, ...result })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        sendJson(res, message.includes('ENOENT') ? 404 : 400, { ok: false, error: message })
      }
    })
  })
}

/** Cordis plugin entry. */
export function apply(ctx, config = {}) {
  const store = new KnowledgeStore(vaultRoot(config))
  store.initSync()
  const organizer = new Organizer({ ctx, store, config, onStatus: () => {} })

  ctx.effect(() => () => organizer.dispose(), 'knowledge-graph: organizer')

  registerTools(ctx, store)
  registerRoutes(ctx, store, organizer)

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'knowledge-graph/rules',
    order: 160,
    text: RULES,
  }), 'knowledge-graph: system rules')
}
