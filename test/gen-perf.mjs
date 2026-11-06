import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const root = process.argv[2] ?? path.join(os.homedir(), '.dsh', 'knowledge')
const count = Number(process.argv[3] ?? 300)
const dir = path.join(root, 'wiki', '概念')
await fs.mkdir(dir, { recursive: true })
for (let index = 0; index < count; index += 1) {
  const id = String(index + 1).padStart(3, '0')
  const next = String(((index + 1) % count) + 1).padStart(3, '0')
  const next2 = String(((index + 7) % count) + 1).padStart(3, '0')
  const content = [
    '---',
    `title: "性能节点 ${id}"`,
    'category: "概念"',
    `summary: "用于 300 节点性能验收的第 ${id} 个页面。"`,
    'updated: "2026-11-06 17:00"',
    '---',
    `# 性能节点 ${id}`,
    '',
    '## 定义',
    '',
    `第 ${id} 个性能测试节点。`,
    '',
    '## 关键点',
    '',
    '- 力导向布局',
    '- 300 节点',
    '',
    '## 资料补充',
    '',
    '- （暂无）',
    '',
    '## 关联',
    '',
    `- [[wiki/概念/性能节点 ${next}]]`,
    `- [[wiki/概念/性能节点 ${next2}]]`,
    '',
  ].join('\n')
  await fs.writeFile(path.join(dir, `性能节点 ${id}.md`), content, 'utf8')
}
console.log(`wrote ${count} pages to ${dir}`)
