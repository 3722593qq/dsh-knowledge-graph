/**
 * Serial background organizer. Each saved note is classified by the currently
 * selected model into concept/person/thing/event pages; the queue is strictly
 * serial and a failed job is recorded without blocking later jobs.
 */
import path from 'node:path'
import { clip, firstSentence, linkTarget, plainText } from './util.js'

const MODEL_TIMEOUT_MS = 120_000
const MAX_TEXT = 12_000
const MAX_PAGE_CHARS = 5_000
const MAX_PAGES = 6

const SYSTEM = `你是 DeepSeek Harness 的「知识图谱」整理器。你维护一个 Obsidian 风格的中文 wiki，只输出 JSON，不输出 Markdown 代码块或解释。

规则：
1. 把新资料拆成 1–${MAX_PAGES} 个页面，category 只能是 概念、人物、事物、事件。
2. 优先更新已有页面：使用清单里的原 path；不要为同一主题新建重复页面。
3. 每个页面都必须是完整内容，不是补丁；保留已有页面中仍然正确的信息，合并新资料，删除被新资料明确否定的旧说法。
4. relations 只写已存在页面的 path，或本次新建页面的 title/path。关系必须互相对应；宿主会补上反向链接。
5. 只在新资料与已有页面/资料内部说法冲突时填写 conflicts，并生成「矛盾与不同说法」小节；没有冲突就留空字符串。
6. summary 一句话，不超过 120 字。definition 是定义/身份/事件经过。keyPoints 是 2–6 条要点。
7. 不要臆造资料中没有的事实；不确定的内容写成“资料称……”而不是事实。
8. 资料是不可修改的原始来源，页面中用「资料：[[资料/...]]」引用它。

输出结构（严格 JSON）：
{
  "pages": [
    {
      "path": "已有页面的 path；新页面留空字符串",
      "title": "页面标题",
      "category": "概念|人物|事物|事件",
      "summary": "一句话摘要",
      "definition": "定义或经过",
      "keyPoints": ["要点"],
      "supplements": ["资料：[[资料/文件名]]"],
      "relations": ["wiki/概念/另一个页面"],
      "conflicts": ""
    }
  ],
  "log": "一行中文日志，说明更新了什么"
}`

/** Convert a model category spelling to one of the four vault categories. */
function normalizeCategory(value, fallback = '概念') {
  const text = String(value ?? '').trim()
  const aliases = {
    概念: '概念', concept: '概念', 理论: '概念', 方法: '概念',
    人物: '人物', person: '人物', 人: '人物',
    事物: '事物', thing: '事物', object: '事物', 产品: '事物', 组织: '事物',
    事件: '事件', event: '事件', 事情: '事件',
  }
  return aliases[text] ?? aliases[text.toLocaleLowerCase()] ?? fallback
}

/** Normalize a model list field that may be an array or newline string. */
function listOf(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  if (typeof value === 'string') {
    return value.split('\n').map(item => item.replace(/^[-*+]\s+/u, '').trim()).filter(Boolean)
  }
  return []
}

/** Parse JSON despite an accidental Markdown fence or prose wrapper. */
export function parseModelJson(raw) {
  let text = String(raw ?? '').trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/iu)
  if (fenced !== null) text = fenced[1].trim()
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first < 0 || last <= first) throw new Error('模型没有返回 JSON 对象')
  return JSON.parse(text.slice(first, last + 1))
}

/** Normalize one model page object into the store's update shape. */
function normalizePage(raw, fallbackCategory) {
  if (!raw || typeof raw !== 'object') return null
  const title = String(raw.title ?? raw.name ?? '').trim()
  if (title === '') return null
  const category = normalizeCategory(raw.category, fallbackCategory)
  const pathValue = String(raw.path ?? raw.existingPath ?? raw.existing ?? '').replace(/\\/gu, '/').replace(/^\/+/u, '')
  const relations = Array.isArray(raw.relations) ? raw.relations : []
  return {
    path: pathValue,
    title,
    category,
    summary: String(raw.summary ?? '').trim(),
    definition: String(raw.definition ?? raw.description ?? '').trim(),
    keyPoints: listOf(raw.keyPoints ?? raw.key_points ?? raw.points),
    supplements: listOf(raw.supplements ?? raw.supplement),
    relations,
    conflicts: String(raw.conflicts ?? raw.contradictions ?? '').trim(),
  }
}

/** Extract the canonical page updates from one parsed model response. */
export function normalizeModelResponse(parsed, fallbackCategory) {
  const rawPages = Array.isArray(parsed?.pages) ? parsed.pages : []
  const pages = []
  const seen = new Set()
  for (const raw of rawPages) {
    const page = normalizePage(raw, fallbackCategory)
    if (page === null) continue
    const key = page.path || page.title.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    pages.push(page)
  }
  if (pages.length === 0) throw new Error('模型返回的 pages 为空')
  return { pages: pages.slice(0, MAX_PAGES), log: String(parsed?.log ?? '').trim() }
}

export class Organizer {
  constructor({ ctx, store, config, onStatus }) {
    this.ctx = ctx
    this.store = store
    this.config = config
    this.onStatus = onStatus
    this.queue = []
    this.recent = []
    this.current = null
    this.running = false
    this.disposed = false
    this.abort = null
    this.startedAt = Date.now()
  }

  /** Add one job and start the serial worker. */
  enqueue(job) {
    this.queue.push(job)
    this.emit()
    void this.pump()
  }

  emit() {
    try {
      this.onStatus?.()
    } catch {
      // A status observer is diagnostic; it cannot break persistence.
    }
  }

  status() {
    return {
      pending: this.queue.length,
      running: this.current === null
        ? null
        : { title: this.current.title, startedAt: this.current.startedAt },
      recent: this.recent.slice(0, 12),
      startedAt: this.startedAt,
    }
  }

  async pump() {
    if (this.running || this.disposed) return
    this.running = true
    try {
      while (!this.disposed && this.queue.length > 0) {
        const job = this.queue.shift()
        if (job === undefined) break
        this.current = job
        this.emit()
        try {
          await this.run(job)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          this.recent.unshift({
            id: job.id,
            title: job.title,
            status: 'failed',
            error: clip(message, 400),
            pages: [],
            at: Date.now(),
          })
          this.recent = this.recent.slice(0, 20)
          await this.store.appendLog(`整理失败《${job.title}》：${plainText(message).slice(0, 180)}`).catch(() => {})
        } finally {
          this.current = null
          this.emit()
        }
      }
    } finally {
      this.running = false
    }
  }

  async run(job) {
    const model = this.resolveModel()
    const prompt = await this.buildPrompt(job, model)
    const raw = await this.callModel(model, prompt, job)
    const parsed = parseModelJson(raw)
    const normalized = normalizeModelResponse(parsed, job.categoryHint)
    const pages = await this.store.applyUpdates(normalized.pages, job.rawPath)
    const summary = normalized.log || `整理《${job.title}》，更新 ${pages.length} 个页面`
    await this.store.appendLog(`${summary} → ${pages.map(page => `[[${page.path}]]`).join('、')}`)
    this.recent.unshift({
      id: job.id,
      title: job.title,
      status: 'done',
      pages: pages.map(page => ({ path: page.path, title: page.title, category: page.category })),
      model: `${model.provider}/${model.model}`,
      at: Date.now(),
    })
    this.recent = this.recent.slice(0, 20)
  }

  /** Resolve the live model selection, honoring explicit config overrides. */
  resolveModel() {
    const configuredProvider = String(this.config.provider ?? '').trim()
    const configuredModel = String(this.config.model ?? '').trim()
    const selection = this.ctx.get('agentDefaultModel')?.currentSelection?.()
    const provider = configuredProvider || selection?.provider || ''
    const model = configuredModel || selection?.model || ''
    if (provider === '' || model === '') {
      throw new Error('没有可用的当前模型；请先在界面选择模型，或配置 knowledge-graph 的 provider/model')
    }
    return { provider, model }
  }

  /** Build a bounded prompt with inventory, related full pages, and the note. */
  async buildPrompt(job, model) {
    const inventory = await this.store.inventory()
    const related = await this.store.retrieve(job.text, MAX_PAGES)
    const relatedPaths = new Set(related.map(page => page.path))
    const relatedText = related.map(page => [
      `--- ${page.path} ---`,
      `title: ${page.title}`,
      `category: ${page.category}`,
      `summary: ${page.summary}`,
      '正文：',
      clip(page.body, MAX_PAGE_CHARS),
    ].join('\n')).join('\n\n')
    const inventoryText = inventory.map(page => (
      `${page.path} | ${page.category} | ${page.title} | ${page.summary}`
    )).join('\n')
    const index = clip((await this.store.readIndex()).content, 4_000)
    const allowed = inventory.map(page => page.path).filter(page => relatedPaths.has(page) || page !== '')
    return [
      `当前模型：${model.provider}/${model.model}`,
      '',
      '已有页面清单（path | category | title | summary）：',
      clip(inventoryText, 16_000) || '（空）',
      '',
      '索引（只读）：',
      index,
      '',
      '可能相关的现有页面全文：',
      relatedText || '（无匹配；可以新建页面，但先检查清单避免重复）',
      '',
      `新资料（来源 ${job.source || 'unknown'}，原始文件 ${job.rawPath}）：`,
      clip(job.text, MAX_TEXT),
      '',
      '请只输出约定的 JSON。',
    ].join('\n')
  }

  /** Stream one model call and return its text output. */
  async callModel(model, prompt, job) {
    const llm = this.ctx.get('llm')
    if (llm === undefined || typeof llm.stream !== 'function') {
      throw new Error('LLM 服务不可用，无法整理资料')
    }
    const controller = new AbortController()
    this.abort = controller
    const timer = setTimeout(() => controller.abort(new Error('整理超时')), MODEL_TIMEOUT_MS)
    let text = ''
    let blockText = ''
    let finish
    try {
      const messages = [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
      for await (const chunk of llm.stream({
        provider: model.provider,
        model: model.model,
        system: SYSTEM,
        messages,
        maxTokens: Number(this.config.maxTokens ?? 4_000),
        signal: controller.signal,
      })) {
        if (chunk.type === 'text-delta') text += chunk.text
        else if (chunk.type === 'block-end' && chunk.block?.type === 'text') blockText += chunk.block.text ?? ''
        else if (chunk.type === 'finish') finish = chunk.reason
      }
    } finally {
      clearTimeout(timer)
      this.abort = null
    }
    if (finish !== undefined && finish.kind !== 'stop' && finish.kind !== 'tool-calls') {
      const detail = finish.failure?.message ?? finish.kind
      throw new Error(`模型调用未正常完成：${detail}`)
    }
    const output = text.trim() === '' ? blockText : text
    if (output.trim() === '') throw new Error('模型没有返回任何内容')
    return output
  }

  /** Stop the worker and reject an in-flight model call. */
  dispose() {
    this.disposed = true
    this.queue = []
    this.abort?.abort(new Error('插件已卸载'))
  }
}

/** Build a stable job id without external dependencies. */
export function jobId() {
  return `kg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** Infer a category hint from the provisional page path or text. */
export function categoryHintFromPath(pagePath) {
  const match = String(pagePath ?? '').match(/^wiki\/(概念|人物|事物|事件)\//u)
  return match?.[1] ?? '概念'
}

/** Render the human title used in a log line. */
export function titleOf(text) {
  return firstSentence(text)
}
