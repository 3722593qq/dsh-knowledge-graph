/**
 * Durable knowledge vault: raw notes under `资料/`, classified pages under
 * `wiki/<category>/`, a fully rewritten `index.md`, and an append-only
 * `log.md`. All paths are validated to stay inside one root.
 */
import { promises as fs, mkdirSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  CATEGORIES, CATEGORY_DIRS, RAW_DIR, atomicWrite, cleanText, clip, ensureRelated,
  ensureSource, firstSentence, linkTarget, pageTitleFromText, parseFrontmatter, plainText, removeRelated,
  replaceSection, sanitizeName, sectionText, stamp, stripWikiLinks, uniqueFilePath, wikiLink, wikiLinks,
  yamlString,
} from './util.js'

const INDEX = 'index.md'
const LOG = 'log.md'
const WIKI = 'wiki'

const EMPTY_INDEX = `# 知识索引

> 全量索引 · 共 0 个页面 · 更新于刚刚

## 概念

_暂无_

## 人物

_暂无_

## 事物

_暂无_

## 事件

_暂无_
`

const EMPTY_LOG = `# 知识日志

`

/** Test whether `child` is inside `parent` (case-insensitive on Windows). */
function isInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/** Normalize a relative wiki path to forward slashes and no `.md`. */
function normalizeRel(value) {
  return String(value ?? '').replace(/\\/gu, '/').replace(/^\/+/u, '').replace(/\.md$/u, '')
}

/** Map a category to its directory. */
function categoryDir(category) {
  return CATEGORY_DIRS[category] ?? CATEGORY_DIRS['概念']
}

/** Return a normalized comparison key for titles. */
function titleKey(value) {
  return plainText(value).toLocaleLowerCase().replace(/\s+/gu, '')
}

/** Guess a category from the raw text when the model has not spoken yet. */
export function guessCategory(text) {
  const value = String(text ?? '')
  if (/(出生|生于|逝世|作家|作者|教授|博士|先生|女士|总统|CEO|创始人|他|她)/u.test(value)) return '人物'
  if (/(会议|发布|发生|事故|比赛|战争|签署|召开|大会|上线|推出|去世|当选|成立|举行)/u.test(value)) return '事件'
  if (/(插件|产品|工具|模型|软件|公司|机构|项目|系统|框架|装置|作品|书|电影|平台|协议|算法)/u.test(value)) return '事物'
  return '概念'
}

/** Correct an obvious artifact/person mismatch without overriding ambiguous cases. */
function refineCategory(category, title, definition) {
  const text = `${title}\n${definition}`
  const personEvidence = /(先生|女士|教授|博士|作者|创始人|CEO|总统|他|她|出生于|逝世)/u.test(text)
  const eventEvidence = /(会议|发布|发生|事故|比赛|战争|签署|召开|大会|上线|推出|去世|当选|成立|举行)/u.test(text)
  const artifactEvidence = /(插件|工具|软件|框架|系统|模型|运行时|产品|公司|项目|平台|协议|算法|技术|库)/u.test(text)
  if ((category === '人物' || category === '事件') && artifactEvidence && !personEvidence && !eventEvidence) return '事物'
  if (category === '事物' && /^(概念|理论|方法|思想|原理|定义|术语)/u.test(title)) return '概念'
  return category
}

/** Split a paragraph into compact sentences for a provisional page. */
function sentences(value, limit = 4) {
  const text = plainText(value)
  if (text === '') return []
  return text
    .split(/(?<=[。！？!?])\s*/u)
    .map(item => item.trim())
    .filter(item => item.length >= 4)
    .slice(0, limit)
}

/** Build the canonical body for one page. */
export function composeBody(page) {
  const lines = [`# ${page.title}`, '', '## 定义', '', page.definition?.trim() || '（待补充）', '', '## 关键点', '']
  const points = (page.keyPoints ?? []).map(item => String(item).trim()).filter(Boolean)
  if (points.length === 0) lines.push('- （待补充）')
  else for (const point of points) lines.push(`- ${point.replace(/^[-*+]\s+/u, '')}`)
  lines.push('', '## 资料补充', '')
  const supplements = uniqueSupplements((page.supplements ?? []).map(item => String(item).trim()).filter(Boolean))
  if (supplements.length === 0) lines.push('- （暂无）')
  else for (const item of supplements) lines.push(item.startsWith('-') ? item : `- ${item}`)
  lines.push('', '## 关联', '')
  const relations = page.relations ?? []
  if (relations.length === 0) lines.push('- （暂无）')
  else for (const relation of relations) lines.push(`- ${wikiLink(relation.target, relation.label)}`)
  if (page.conflicts && page.conflicts.trim() !== '') {
    lines.push('', '## 矛盾与不同说法', '', page.conflicts.trim())
  }
  return `${lines.join('\n').trimEnd()}\n`
}

/** Build a complete page with frontmatter. */
export function composePage(page) {
  const head = [
    '---',
    `title: ${yamlString(page.title)}`,
    `category: ${yamlString(page.category)}`,
    `summary: ${yamlString(page.summary)}`,
    `updated: ${yamlString(stamp())}`,
    '---',
    '',
  ].join('\n')
  return `${head}${composeBody(page)}`
}

/** Parse one page body into the fields this plugin understands. */
export function parsePage(relativePath, source) {
  const { data, body } = parseFrontmatter(source)
  const title = String(data.title ?? '').trim()
    || (body.match(/^#\s+(.+)$/mu)?.[1] ?? path.basename(relativePath, '.md')).trim()
  const category = CATEGORIES.includes(data.category) ? data.category : categoryOfPath(relativePath)
  const summary = String(data.summary ?? '').trim() || clip(plainText(sectionText(body, '定义')), 120)
  const definition = sectionText(body, '定义').trim()
  const pointText = sectionText(body, '关键点').trim()
  const keyPoints = pointText.split('\n')
    .map(line => line.replace(/^[-*+]\s+/u, '').trim())
    .filter(line => line !== '' && line !== '（待补充）')
  const supplementText = sectionText(body, '资料补充').trim()
  const supplements = supplementText.split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && line !== '- （暂无）')
  const relations = wikiLinks(sectionText(body, '关联')).map(raw => ({
    target: linkTarget(raw),
    label: String(raw).includes('|') ? String(raw).split('|').slice(1).join('|').split('#')[0].trim() : '',
  })).filter(item => item.target !== '')
  const conflicts = sectionText(body, '矛盾与不同说法').trim()
  return {
    path: relativePath,
    title,
    category,
    summary,
    definition,
    keyPoints,
    supplements,
    relations,
    conflicts,
    body,
    frontmatter: data,
  }
}

function categoryOfPath(relativePath) {
  const normalized = normalizeRel(relativePath)
  for (const [category, dir] of Object.entries(CATEGORY_DIRS)) {
    if (normalized.startsWith(`${dir}/`)) return category
  }
  return '概念'
}

export class KnowledgeStore {
  constructor(root) {
    this.root = path.resolve(root)
    this.paths = {
      raw: path.join(this.root, RAW_DIR),
      wiki: path.join(this.root, WIKI),
      index: path.join(this.root, INDEX),
      log: path.join(this.root, LOG),
    }
  }

  /** Create the vault skeleton synchronously; called once during plugin apply. */
  initSync() {
    mkdirSync(this.paths.raw, { recursive: true })
    for (const dir of Object.values(CATEGORY_DIRS)) {
      mkdirSync(path.join(this.root, dir), { recursive: true })
    }
    if (!existsSync(this.paths.index)) writeFileSync(this.paths.index, EMPTY_INDEX, 'utf8')
    if (!existsSync(this.paths.log)) writeFileSync(this.paths.log, EMPTY_LOG, 'utf8')
  }

  /** Resolve a user-supplied relative path against the vault root. */
  resolve(relativePath) {
    const raw = String(relativePath ?? '')
    if (raw.includes('\0')) throw new Error('路径包含非法字符')
    const absolute = path.resolve(this.root, raw)
    if (!isInside(this.root, absolute)) throw new Error('路径超出知识库范围')
    return absolute
  }

  /** Convert an absolute path below the root to a forward-slash relative path. */
  relative(absolute) {
    return path.relative(this.root, absolute).replace(/\\/gu, '/')
  }

  async readText(relativePath) {
    const absolute = this.resolve(relativePath)
    return fs.readFile(absolute, 'utf8')
  }

  async readPage(relativePath) {
    const normalized = normalizeRel(relativePath)
    const source = await this.readText(`${normalized}.md`)
    return { ...parsePage(normalized, source), content: source }
  }

  async writePage(relativePath, source) {
    const normalized = normalizeRel(relativePath)
    if (!normalized.startsWith(`${WIKI}/`)) throw new Error('页面必须位于 wiki/ 下')
    await atomicWrite(this.resolve(`${normalized}.md`), source)
    return normalized
  }

  /** List all wiki Markdown pages, sorted by path. */
  async pagePaths() {
    const result = []
    const walk = async dir => {
      let entries
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) await walk(full)
        else if (entry.isFile() && entry.name.endsWith('.md')) result.push(this.relative(full).replace(/\.md$/u, ''))
      }
    }
    await walk(this.paths.wiki)
    return result.sort()
  }

  /** Load every page (frontmatter + links). */
  async loadPages() {
    const paths = await this.pagePaths()
    const pages = []
    for (const relativePath of paths) {
      try {
        const source = await this.readText(`${relativePath}.md`)
        pages.push(parsePage(relativePath, source))
      } catch {
        // A page removed during an Obsidian save is skipped; the next scan sees
        // the settled file rather than failing the whole graph.
      }
    }
    return pages
  }

  /** Find a page by normalized title or file stem. */
  async findPage(title) {
    const key = titleKey(title)
    if (key === '') return null
    const pages = await this.loadPages()
    return pages.find(page => titleKey(page.title) === key || titleKey(path.basename(page.path, '.md')) === key) ?? null
  }

  /** Resolve a wiki link to an existing page using path, title, or stem. */
  resolvePage(pages, target) {
    const clean = normalizeRel(linkTarget(target))
    if (clean === '') return null
    const direct = pages.find(page => normalizeRel(page.path) === clean)
    if (direct !== undefined) return direct
    const key = titleKey(clean.split('/').at(-1) ?? clean)
    return pages.find(page => titleKey(page.title) === key || titleKey(path.basename(page.path, '.md')) === key) ?? null
  }

  /**
   * Write one immutable raw note. A duplicate title receives `-2`, `-3`, ...
   * @returns the relative path of the new source note.
   */
  async saveRaw(text, meta = {}) {
    const title = firstSentence(text)
    const file = await uniqueFilePath(this.paths.raw, title)
    const relativePath = this.relative(file)
    const source = [
      '---',
      `title: ${yamlString(title)}`,
      `saved: ${yamlString(stamp())}`,
      `source: ${yamlString(meta.source ?? 'selection')}`,
      '---',
      '',
      `# ${title}`,
      '',
      cleanText(text),
      '',
    ].join('\n')
    await atomicWrite(file, source)
    return relativePath
  }

  /**
   * Create a provisional page so the wiki changes immediately, before the
   * model call. Returns the page path.
   */
  async bootstrapPage(title, text, rawPath, source) {
    const existing = await this.findPage(title)
    if (existing !== null) {
      const sourceLink = `资料：${wikiLink(rawPath, path.basename(rawPath, '.md'))}`
      const body = ensureSource(existing.body, rawPath, path.basename(rawPath, '.md'))
      const changed = body !== existing.body
        ? { ...existing, supplements: supplementList(existing, sourceLink), body }
        : null
      if (changed !== null) await this.writePage(existing.path, composePage(changed))
      return existing.path
    }
    const pageTitle = pageTitleFromText(text)
    const sameSubject = await this.findPage(pageTitle)
    if (sameSubject !== null) {
      const body = ensureSource(sameSubject.body, rawPath, path.basename(rawPath, '.md'))
      if (body !== sameSubject.body) {
        await this.writePage(sameSubject.path, composePage({
          ...sameSubject,
          supplements: supplementList(sameSubject, `资料：${wikiLink(rawPath, path.basename(rawPath, '.md'))}`),
        }))
      }
      return sameSubject.path
    }
    const category = guessCategory(text)
    const joined = cleanText(text)
    const definition = clip(sentences(joined, 2).join('') || joined, 600)
    const keyPoints = sentences(joined, 4).slice(0, 3)
    const page = {
      title: pageTitle,
      category,
      summary: clip(plainText(joined), 160),
      definition,
      keyPoints,
      supplements: [`资料：${wikiLink(rawPath, path.basename(rawPath, '.md'))}`],
      relations: [],
      conflicts: '',
    }
    const filename = sanitizeName(pageTitle)
    const dir = path.join(this.root, categoryDir(category))
    const file = await uniqueFilePath(dir, filename)
    const relativePath = this.relative(file)
    await this.writePage(relativePath, composePage(page))
    return normalizeRel(relativePath)
  }

  /** Apply a batch of model-produced page updates and reciprocal links. */
  async applyUpdates(updates, rawPath) {
    const before = await this.loadPages()
    const byTitle = new Map(before.map(page => [titleKey(page.title), page]))
    const byPath = new Map(before.map(page => [normalizeRel(page.path), page]))
    const written = []
    const rewritten = new Set()

    for (const update of updates) {
      const title = cleanText(update.title).slice(0, 80)
      if (title === '') continue
      const existing = (update.path && byPath.get(normalizeRel(update.path)))
        ?? byTitle.get(titleKey(title))
        ?? null
      let category = CATEGORIES.includes(update.category) ? update.category : existing?.category ?? guessCategory(`${title}\n${update.definition ?? ''}`)
      category = refineCategory(category, title, update.definition ?? update.summary ?? '')
      let relativePath = existing?.path ?? null
      if (relativePath === null) {
        const dir = path.join(this.root, categoryDir(category))
        const file = await uniqueFilePath(dir, sanitizeName(title))
        relativePath = this.relative(file)
      } else {
        category = categoryOfPath(relativePath)
      }
      const supplements = uniqueSupplements([
        ...(update.supplements ?? []),
        ...(rawPath ? [`资料：${wikiLink(rawPath, path.basename(rawPath, '.md'))}`] : []),
      ])
      const relations = normalizeRelations(update.relations)
      const page = {
        title,
        category,
        summary: cleanText(update.summary).slice(0, 300) || existing?.summary || '',
        definition: cleanText(update.definition) || existing?.definition || '',
        keyPoints: normalizeList(update.keyPoints),
        supplements,
        relations,
        conflicts: cleanText(update.conflicts),
      }
      await this.writePage(relativePath, composePage(page))
      written.push({ ...page, path: normalizeRel(relativePath) })
      rewritten.add(normalizeRel(relativePath))
      if (existing !== null && normalizeRel(existing.path) !== normalizeRel(relativePath)) {
        await fs.rm(this.resolve(`${normalizeRel(existing.path)}.md`), { force: true })
      }
    }

    if (written.length === 0) throw new Error('模型没有给出可写入的页面')

    // Reciprocal links are written after all updated pages exist, so a target
    // created later in the same batch is already resolvable.
    const all = await this.loadPages()
    for (const page of written) {
      for (const relation of page.relations) {
        const target = this.resolvePage(all, relation.target)
        if (target === null || normalizeRel(target.path) === normalizeRel(page.path)) continue
        const body = ensureRelated(
          rewritten.has(normalizeRel(target.path)) ? (await this.readPage(target.path)).body : target.body,
          page.path,
          page.title,
        )
        if (body !== target.body || rewritten.has(normalizeRel(target.path))) {
          await this.writePage(target.path, `${serializeFrontmatter(target, body)}`)
          rewritten.add(normalizeRel(target.path))
        }
      }
    }

    // Re-scan after reciprocal writes so index degrees and summaries are current.
    await this.rebuildIndex()
    return written
  }

  /**
   * Delete one wiki page and erase references to it from every remaining page.
   * Raw notes under 资料/ stay untouched: they are immutable inputs.
   */
  async deletePage(relativePath) {
    const normalized = normalizeRel(relativePath)
    if (!normalized.startsWith(`${WIKI}/`)) throw new Error('只能删除 wiki/ 下的页面')
    const target = await this.readPage(normalized)
    await fs.rm(this.resolve(`${normalized}.md`))
    const pages = await this.loadPages()
    let cleaned = 0
    for (const page of pages) {
      let body = removeRelated(page.body, normalized)
      body = stripWikiLinks(body, normalized)
      if (body !== page.body) {
        await this.writePage(page.path, serializeFrontmatter(page, body))
        cleaned += 1
      }
    }
    await this.rebuildIndex()
    await this.appendLog(`删除页面「${target.title}」：${normalized}（原始资料保留）`)
    return { path: normalized, title: target.title, cleaned }
  }

  /** Fully rewrite index.md from the current pages. */
  async rebuildIndex() {
    const pages = await this.loadPages()
    const groups = new Map(CATEGORIES.map(category => [category, []]))
    for (const page of pages) groups.get(page.category)?.push(page)
    const counts = CATEGORIES.map(category => `${category} ${groups.get(category).length}`).join(' · ')
    const lines = [
      '# 知识索引',
      '',
      `> 全量索引 · 共 ${pages.length} 个页面 · 更新于 ${stamp()}`,
      `> ${counts}`,
      '',
    ]
    for (const category of CATEGORIES) {
      lines.push(`## ${category}`, '')
      const items = groups.get(category)
      if (items.length === 0) {
        lines.push('_暂无_', '')
        continue
      }
      for (const page of items) {
        lines.push(`- ${wikiLink(page.path, page.title)} — ${clip(plainText(page.summary), 160) || '（无摘要）'}`)
      }
      lines.push('')
    }
    await atomicWrite(this.paths.index, `${lines.join('\n').trimEnd()}\n`)
  }

  /** Append exactly one line to log.md. */
  async appendLog(line) {
    const safe = String(line ?? '').replace(/\s+/gu, ' ').trim()
    if (safe === '') return
    let current = ''
    try {
      current = await fs.readFile(this.paths.log, 'utf8')
    } catch {
      current = EMPTY_LOG
    }
    const next = `${current.trimEnd()}\n- ${stamp()} · ${safe}\n`
    await atomicWrite(this.paths.log, next)
  }

  async readIndex() {
    const source = await fs.readFile(this.paths.index, 'utf8')
    return { path: INDEX, content: source }
  }

  /** Build the browser graph: every wiki page is a node, every wiki link an edge. */
  async buildGraph() {
    const pages = await this.loadPages()
    const nodes = pages.map(page => ({
      id: page.path,
      path: page.path,
      title: page.title,
      category: page.category,
      summary: page.summary,
      degree: 0,
    }))
    const byPath = new Map(nodes.map(node => [node.id, node]))
    const edgeMap = new Map()
    for (const page of pages) {
      const source = byPath.get(page.path)
      if (source === undefined) continue
      for (const relation of page.relations) {
        const target = this.resolvePage(pages, relation.target)
        if (target === null || target.path === page.path) continue
        source.degree += 1
        byPath.get(target.path).degree += 1
        const a = page.path < target.path ? page.path : target.path
        const b = page.path < target.path ? target.path : page.path
        const key = `${a}\0${b}`
        const edge = edgeMap.get(key)
        if (edge === undefined) edgeMap.set(key, { source: a, target: b, weight: 1 })
        else edge.weight += 1
      }
    }
    const edges = [...edgeMap.values()]
    return {
      nodes: nodes.sort((a, b) => a.title.localeCompare(b.title, 'zh')),
      edges,
      generatedAt: Date.now(),
      root: this.root,
    }
  }

  /** Read-only search over titles, summaries, and bodies. */
  async search(query, limit = 12) {
    const needle = cleanText(query).toLocaleLowerCase()
    if (needle === '') return []
    const pages = await this.loadPages()
    const scored = []
    for (const page of pages) {
      const title = page.title.toLocaleLowerCase()
      const summary = page.summary.toLocaleLowerCase()
      const body = page.body.toLocaleLowerCase()
      let score = 0
      if (title === needle) score += 100
      else if (title.includes(needle)) score += 40
      if (summary.includes(needle)) score += 15
      if (body.includes(needle)) score += 5
      if (score > 0) scored.push({ ...page, score, body: undefined })
    }
    return scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh')).slice(0, limit)
  }

  /** Choose up to `limit` existing pages to send to the model as context. */
  async retrieve(text, limit = 6) {
    const pages = await this.loadPages()
    const haystack = cleanText(text).toLocaleLowerCase()
    const tokens = tokenize(haystack)
    const scored = pages.map(page => {
      const title = page.title.toLocaleLowerCase()
      const summary = page.summary.toLocaleLowerCase()
      let score = 0
      if (haystack.includes(title)) score += 60
      if (haystack.includes(path.basename(page.path, '.md').toLocaleLowerCase())) score += 30
      for (const token of tokens) {
        if (title.includes(token)) score += 12
        if (summary.includes(token)) score += 4
      }
      return { page, score }
    }).filter(item => item.score > 0)
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, limit).map(item => item.page)
  }

  /** Compact page inventory for the model prompt. */
  async inventory() {
    const pages = await this.loadPages()
    return pages.map(page => ({
      path: page.path,
      title: page.title,
      category: page.category,
      summary: clip(plainText(page.summary), 120),
    }))
  }

  /** Read a page for the panel, with its path normalized. */
  async panelPage(relativePath) {
    const page = await this.readPage(normalizeRel(relativePath))
    return { ...page, path: normalizeRel(relativePath), content: page.content }
  }
}

/** Serialize a page keeping its original body (used when only links changed). */
function serializeFrontmatter(page, body) {
  const head = [
    '---',
    `title: ${yamlString(page.title)}`,
    `category: ${yamlString(page.category)}`,
    `summary: ${yamlString(page.summary)}`,
    `updated: ${yamlString(stamp())}`,
    '---',
    '',
  ].join('\n')
  return `${head}${body.trimEnd()}\n`
}

function supplementList(page, sourceLink) {
  return uniqueSupplements([...(page.supplements ?? []), sourceLink])
}

/** Deduplicate source bullets by the wiki target they point to, not their label. */
function uniqueSupplements(values) {
  const seen = new Set()
  const result = []
  for (const value of values) {
    const clean = String(value ?? '').trim()
    if (clean === '') continue
    const link = clean.match(/\[\[([^\]|#]+)/u)?.[1]
    const key = link === undefined ? clean : `link:${linkTarget(link)}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(clean)
  }
  return result
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  if (typeof value === 'string') {
    return value.split('\n').map(item => item.replace(/^[-*+]\s+/u, '').trim()).filter(Boolean)
  }
  return []
}

function normalizeRelations(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const result = []
  for (const item of value) {
    const target = normalizeRel(linkTarget(typeof item === 'string' ? item : item?.target ?? item?.path ?? ''))
    if (target === '' || seen.has(target)) continue
    seen.add(target)
    result.push({
      target,
      label: String(typeof item === 'string' ? '' : item?.label ?? item?.title ?? '').trim(),
    })
  }
  return result
}

function tokenize(text) {
  const tokens = new Set()
  for (const word of text.split(/[^\p{L}\p{N}]+/u)) {
    if (word.length >= 2) tokens.add(word)
  }
  const chinese = text.replace(/[^\p{Script=Han}]/gu, '')
  for (let index = 0; index + 1 < chinese.length && tokens.size < 80; index += 1) {
    tokens.add(chinese.slice(index, index + 2))
  }
  return [...tokens].slice(0, 80)
}
