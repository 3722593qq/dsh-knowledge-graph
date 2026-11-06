/**
 * Filesystem, Markdown, and naming helpers shared by the knowledge-graph host
 * plugin. Paths passed here are always relative to the knowledge root; callers
 * resolve them through KnowledgeStore before touching the disk.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

export const CATEGORIES = ['概念', '人物', '事物', '事件']
export const CATEGORY_DIRS = {
  概念: 'wiki/概念',
  人物: 'wiki/人物',
  事物: 'wiki/事物',
  事件: 'wiki/事件',
}
export const RAW_DIR = '资料'

const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/gu
const WHITESPACE = /\s+/gu

/** Trim, collapse whitespace, and drop leading Markdown punctuation. */
export function cleanText(value) {
  return String(value ?? '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

/** Return the first sentence, capped to a title-sized string. */
export function firstSentence(value, max = 40) {
  const text = cleanText(value).replace(/^#{1,6}\s+/u, '').replace(/^[-*+]\s+/u, '')
  if (text === '') return '未命名资料'
  const line = text.split('\n', 1)[0].trim()
  const match = line.match(/^(.{1,120}?[。！？!?])/u)
  const sentence = (match?.[1] ?? line).replace(/[。！？!?]\s*$/u, '').trim()
  const clipped = Array.from(sentence).slice(0, max).join('').trim()
  return clipped === '' ? '未命名资料' : clipped
}

/** Pick a compact subject title for a provisional wiki page. */
export function pageTitleFromText(value, max = 40) {
  const sentence = firstSentence(value, 80)
  const subject = sentence.match(/^(.{2,32}?)(?:是|指|属于|由|位于|成立于|发布于)/u)?.[1]?.trim()
  const candidate = subject && Array.from(subject).length >= 2 ? subject : sentence
  return Array.from(candidate).slice(0, max).join('').trim() || firstSentence(value)
}

/** Remove characters Obsidian/Windows cannot use in a file name. */
export function sanitizeName(value, max = 40) {
  const clean = String(value ?? '')
    .replace(ILLEGAL, '')
    .replace(WHITESPACE, ' ')
    .replace(/^[.\s]+|[.\s]+$/gu, '')
    .trim()
  const clipped = Array.from(clean).slice(0, max).join('').trim().replace(/[.\s]+$/u, '')
  return clipped === '' || clipped === '.' || clipped === '..' ? '未命名资料' : clipped
}

/** Resolve a unique file path inside `dir`, suffixing `-2`, `-3`, ... */
export async function uniqueFilePath(dir, base, ext = '.md') {
  const safe = sanitizeName(base)
  let candidate = path.join(dir, `${safe}${ext}`)
  try {
    await fs.access(candidate)
  } catch {
    return candidate
  }
  for (let index = 2; index < 10000; index += 1) {
    candidate = path.join(dir, `${safe}-${index}${ext}`)
    try {
      await fs.access(candidate)
    } catch {
      return candidate
    }
  }
  throw new Error(`无法为「${safe}」找到可用文件名`)
}

/** Timestamp used by frontmatter, index, and log. */
export function stamp(date = new Date()) {
  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Format a YAML-safe double-quoted scalar. */
export function yamlString(value) {
  return JSON.stringify(String(value ?? ''))
}

/** Parse the small YAML frontmatter subset this plugin writes. */
export function parseFrontmatter(source) {
  const text = String(source ?? '').replace(/\r\n?/gu, '\n')
  if (!text.startsWith('---\n')) return { data: {}, body: text }
  const end = text.indexOf('\n---\n', 4)
  if (end < 0) return { data: {}, body: text }
  const data = {}
  for (const line of text.slice(4, end).split('\n')) {
    const match = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/u)
    if (match === null) continue
    let value = match[2].trim()
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value)
      } catch {
        value = value.slice(1, -1)
      }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1).replace(/''/gu, "'")
    }
    data[match[1]] = value
  }
  return { data, body: text.slice(end + 5) }
}

/** Split a Markdown page into `##` sections (case-sensitive names). */
export function splitSections(body) {
  const sections = new Map()
  let current = ''
  let buffer = []
  const flush = () => {
    if (current !== '') sections.set(current, buffer.join('\n').trim())
    buffer = []
  }
  for (const line of String(body ?? '').split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/u)
    if (heading !== null) {
      flush()
      current = heading[1].trim()
    } else {
      buffer.push(line)
    }
  }
  flush()
  return sections
}

/** Replace one `##` section, preserving the rest of the body. */
export function replaceSection(body, name, content) {
  const text = String(body ?? '').replace(/\r\n?/gu, '\n').trimEnd()
  const marker = `## ${name}`
  const start = text.indexOf(marker)
  if (start < 0) return `${text}\n\n${marker}\n\n${content.trim()}\n`
  const after = start + marker.length
  const next = text.indexOf('\n## ', after)
  const tail = next < 0 ? '' : text.slice(next)
  return `${text.slice(0, start)}${marker}\n\n${content.trim()}\n${tail}`
}

/** Read one section without its heading; empty when absent. */
export function sectionText(body, name) {
  return splitSections(body).get(name) ?? ''
}

/** Extract wiki-link targets from Markdown. */
export function wikiLinks(source) {
  const links = []
  const regex = /\[\[([^\]\n]+)\]\]/gu
  let match
  while ((match = regex.exec(String(source ?? ''))) !== null) {
    links.push(match[1])
  }
  return links
}

/** Convert one wiki-link body (`target|alias#heading`) to a link target. */
export function linkTarget(raw) {
  const withoutAlias = String(raw ?? '').split('|', 1)[0]
  return withoutAlias.split('#', 1)[0].trim().replace(/\.md$/u, '').replace(/^\.\//u, '')
}

/** Render one wiki link relative to the Obsidian vault root. */
export function wikiLink(target, label) {
  const clean = String(target).replace(/\.md$/u, '').replace(/^wiki\/wiki\//u, 'wiki/')
  return `[[${clean}${label && label !== clean ? `|${label}` : ''}]]`
}

/** Normalize an LLM-provided relation entry. */
export function relationOf(value) {
  if (typeof value === 'string') return { target: value.trim(), label: '' }
  if (value && typeof value === 'object') {
    return {
      target: String(value.target ?? value.path ?? value.page ?? '').trim(),
      label: String(value.label ?? value.title ?? '').trim(),
    }
  }
  return null
}

/** Add a bullet to `## 关联` unless that page is already linked. */
export function ensureRelated(body, target, label) {
  const clean = linkTarget(target)
  if (clean === '') return body
  const existing = sectionText(body, '关联')
  if (wikiLinks(existing).some(link => linkTarget(link) === clean)) return body
  const bullet = `- ${wikiLink(clean, label)}`
  const next = existing.trim() === '' ? bullet : `${existing.trimEnd()}\n${bullet}`
  return replaceSection(body, '关联', next)
}

/** Ensure the source note appears under `## 资料补充` without duplicating. */
export function ensureSource(body, target, label) {
  const clean = linkTarget(target)
  if (clean === '') return body
  const existing = sectionText(body, '资料补充')
  if (wikiLinks(existing).some(link => linkTarget(link) === clean)) return body
  const bullet = `- 资料：${wikiLink(clean, label)}`
  const next = existing.trim() === '' ? bullet : `${existing.trimEnd()}\n${bullet}`
  return replaceSection(body, '资料补充', next)
}

/** Remove one target from `## 关联`, dropping a bullet that becomes empty. */
export function removeRelated(body, target) {
  const clean = linkTarget(target)
  if (clean === '') return body
  const existing = sectionText(body, '关联')
  if (existing.trim() === '') return body
  const lines = []
  for (const line of existing.split('\n')) {
    const replaced = line.replace(/\[\[([^\]\n]+)\]\]/gu, (full, inner) => (
      linkTarget(inner) === clean ? '' : full
    )).replace(/[ \t]{2,}/gu, ' ').trimEnd()
    if (/^[-*+]\s*$/u.test(replaced) || replaced === '') continue
    lines.push(replaced)
  }
  return replaceSection(body, '关联', lines.length === 0 ? '- （暂无）' : lines.join('\n'))
}

/** Replace remaining inline links to a deleted page with their visible label. */
export function stripWikiLinks(body, target) {
  const clean = linkTarget(target)
  if (clean === '') return body
  return String(body ?? '').replace(/\[\[([^\]\n]+)\]\]/gu, (full, inner) => {
    if (linkTarget(inner) !== clean) return full
    const [targetPart, labelPart] = String(inner).split('|', 2)
    return (labelPart ?? targetPart.split('#', 1)[0].split('/').at(-1) ?? clean).trim()
  })
}

/** Write a file atomically so Obsidian never observes a half-written page. */
export async function atomicWrite(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(temp, content, 'utf8')
  await fs.rename(temp, file)
}

/** Clamp a string for prompts. */
export function clip(value, max) {
  const text = String(value ?? '')
  return text.length <= max ? text : `${text.slice(0, max)}\n…（已截断）`
}

/** Strip Markdown emphasis for summaries and labels. */
export function plainText(value) {
  return String(value ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gu, (_match, target, label) => label ?? target)
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[*_`>#]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}
