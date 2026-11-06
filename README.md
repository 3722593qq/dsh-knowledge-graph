# 知识图谱（dsh-knowledge-graph）

[![CI](https://github.com/3722593qq/dsh-knowledge-graph/actions/workflows/ci.yml/badge.svg)](https://github.com/3722593qq/dsh-knowledge-graph/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/3722593qq/dsh-knowledge-graph)](https://github.com/3722593qq/dsh-knowledge-graph/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

给 DeepSeek Harness 用的本地知识库 + Obsidian 风格 wiki + 力导向关系图。

![知识图谱面板](docs/desktop-panel.png)

上图是当前 DSH Desktop 里的实际页面（知识库为空时）。

## 它做什么

- 选中文字后出现「存入知识库」浮动按钮；右键菜单也能存。
- 每条 AI 回答下方有书形图标，一次存整条回答。
- 在「我发的消息」上右键，可直接存这条消息。
- 保存不弹窗：立刻在 `资料/` 写一条只读原始笔记，并立刻创建一个 wiki 草稿页，随后在后台用当前模型把它整理成概念 / 人物 / 事物 / 事件页面。
- 整理队列严格串行；失败会写进 `log.md` 和面板的「最近结果」，不会阻塞下一条。
- 左侧栏「知识图谱」页面：左边关系图（Markdown 文件是节点，`[[ ]]` 是边），右边正文。
- 右侧正文标题栏有删除按钮：二次确认后删除当前 wiki 页面，并清理其他页面指向它的关联；`资料/` 原文保留。
- Agent 只拿到四个只读工具；全局规则要求先读索引，再读相关页，并在回答末尾标注知识来源。

![划词保存按钮](docs/selection.png)

![消息操作](docs/chat-actions.png)

## 知识库位置

默认在 DSH 数据目录：

```text
~/.dsh/knowledge/
├── 资料/                 # 保存后不再修改的原始笔记
├── wiki/
│   ├── 概念/
│   ├── 人物/
│   ├── 事物/
│   └── 事件/
├── index.md              # 每次保存/整理后全量重写
└── log.md                # 每次整理追加一行
```

Windows 下通常是 `C:\Users\<你>\.dsh\knowledge`。用 Obsidian 直接打开这个目录即可；页面内的链接形如 `[[wiki/概念/页面]]`。

配置 `rootDir` 可以改到别的目录：

```yaml
- id: knowledge-graph
  name: dsh-knowledge-graph
  config:
    rootDir: D:/notes/knowledge   # 绝对路径，或相对 $DSH_HOME 的路径
```

也支持测试用环境变量 `DSH_KNOWLEDGE_DIR`。模型默认跟随 `agentDefaultModel.currentSelection()`，可用 `provider` / `model` 覆盖；`maxTokens` 默认 4000。

## 页面格式

```markdown
---
title: "页面标题"
category: "概念"
summary: "一句话摘要"
updated: "2026-11-06 17:42"
---
# 页面标题

## 定义
...
## 关键点
- ...
## 资料补充
- 资料：[[资料/原始笔记]]
## 关联
- [[wiki/事物/另一个页面]]

## 矛盾与不同说法
仅当资料与已有页面/资料内部存在冲突时出现。
```

宿主会在写入后补齐反向链接：A 的「关联」出现 B，B 的「关联」也会出现 A。`index.md` 每次全量重建；`log.md` 每次只追加，不重写历史。

## 左侧栏页面

![力导向关系图](docs/panel.png)

- 节点半径按连接数开方映射到 4.8–20.8px。
- 力导向逐帧计算：斥力 650、弹簧 0.28、向心 0.0011、碰撞间隙 6px、摩擦 0.85；alpha 每帧乘 0.985，降到 0.01 停止。
- 未选中时边透明度 0.3；选中/悬停时邻居亮度 0.8、第二层 0.35、更远 0.12，无关边 0.06。
- 标签固定 12px，在缩放 0.5–0.8 之间渐显，按优先级做矩形碰撞避让。
- 滚轮以光标为中心缩放；拖空白只改视图；拖节点会重启动画并让周围节点通过碰撞让位，松手后模拟到停。
- 双击空白适应窗口；搜索会高亮命中和邻居。
- 「局部」默认显示当前页周围 2 层，可调 1–5 层。
- 数据更新沿用同一个模拟：已有节点坐标和当前视图保留，不重置。

## 删除页面

正文标题右侧的垃圾桶按钮会先展开二次确认：

![删除确认](docs/delete-confirm.png)

确认后：

- 删除对应的 `wiki/<分类>/<页面>.md`。
- 扫描其他页面，从「关联」移除指向该页的链接，并把正文里的残留 `[[...]]` 替换成文字。
- 全量重建 `index.md`，向 `log.md` 追加删除记录。
- 关系图立即刷新；如果还有页面，会自动选中当前连接最多的页面。
- `资料/` 里的原始笔记不删除（原始资料是不可变输入）。
- 整理队列正在运行时拒绝删除，避免后台整理把页面重新写回来。

![删除完成](docs/delete-after.png)

### 删除报 HTTP 405

405 表示浏览器已经加载了 0.1.1 的删除按钮，但正在运行的 **host 仍是 0.1.0**，没有注册 `POST /knowledge-graph/api/delete` 路由；DSH Web Server 对未知 POST 路径返回 405。仅刷新页面或只重载 client bundle 不够，需要**完全退出 DeepSeek Harness 再重新启动**（不是关闭窗口到托盘），让宿主重新加载 `lib/index.js`。重启后删除请求会得到 200；路由不存在时才会得到 405。

## Agent 只读工具

| 工具 | 作用 |
| --- | --- |
| `knowledge_index` | 读取 `index.md` |
| `knowledge_read` | 读取一页 wiki 或索引 |
| `knowledge_search` | 搜索标题、摘要、正文 |
| `knowledge_graph` | 读取局部关系图 |

没有任何写知识库的 Agent 工具；写入只来自界面操作。

全局规则会要求模型：问题可能相关时先 `knowledge_index`，再 `knowledge_read` 相关页；回答末尾写 `知识来源：[[wiki/...]]`。

## 安装

要求：DSH `>= 0.2.0-rc.2`，Node `^22.19.0 || >=24.0.0`。插件没有构建步骤，仓库里直接包含可加载的 `lib/*.js`。

### 从 GitHub 安装（推荐）

```powershell
dsh plugin --profile <profile> add github:3722593qq/dsh-knowledge-graph
```

### 从 Release tarball 安装

```powershell
dsh plugin --profile <profile> add https://github.com/3722593qq/dsh-knowledge-graph/releases/download/v0.1.3/dsh-knowledge-graph-0.1.3.tgz
```

### 本地开发

```powershell
git clone https://github.com/3722593qq/dsh-knowledge-graph.git
dsh plugin --profile <profile> add ./dsh-knowledge-graph
```

安装后如果宿主没有立即显示左侧栏「知识图谱」，**完全退出并重新启动 DeepSeek Harness**（不是只刷新页面）。0.1.1 新增的删除接口是宿主路由，刷新只会更新浏览器 bundle，旧宿主会返回 HTTP 405。

### 发布

```powershell
npm test
npm pack
git tag v0.1.3
git push origin main --tags
```

推送 `v*` tag 会触发 `.github/workflows/release.yml`，自动创建 GitHub Release 并附带 `.tgz`。

## 自验

`docs/acceptance.json` 记录了在本机 DSH 0.2.0-rc.2 + `deepseek-account/deepseek-flash` 上的实测结果：

| 验收项 | 结果 |
| --- | --- |
| 存一条 25 秒内 wiki 有变化 | API 12–23ms 返回时草稿页已落盘；含模型整理到空闲 2.1–3.1s |
| 链接双向 | 两个页面互相出现在 `关联`，图谱边 `weight=2` |
| 连接最多的在中间 | 最高连接节点坐标约 `(0, 0)`，视图以它为中心 |
| 拖节点周围让位 | 拖拽中邻居移动 79.8px；alpha 保持、running=true；松手后 alpha 0.00995、running=false |
| 后台整理不重排 | 新数据到来时复用旧坐标与 transform；alpha 仅从 0.00995 抬到 0.85 |
| 300 个节点不卡 | 304 节点 / 601 边，120 帧平均 16.44ms、p95 16.8ms、无 >34ms 帧 |
| 选中亮度 / 半径 / 边透明度 | 0.8 / 0.35 / 0.12；4.8–20.8px；未选中边 0.3 |
| 局部图谱 | 1 层 5 节点、2 层 13 节点、5 层 53 节点（304 节点样本） |
| 删除页面 | UI 二次确认；页面文件删除、反向关联清空、`index.md` 重写、`log.md` 追加、图谱节点减少 |

复跑测试：

```powershell
node plugins/knowledge-graph/test/store-test.mjs
node plugins/knowledge-graph/test/queue-test.mjs
node plugins/knowledge-graph/test/tools-test.mjs
node plugins/knowledge-graph/test/delete-test.mjs
node plugins/knowledge-graph/test/gen-perf.mjs "$env:DSH_HOME\knowledge" 300
```

## 已知限制

- 页面分类来自模型，偶尔会把抽象插件/工具归错类；宿主会对明显的「插件/工具/系统」误判为人物/事件做一次保守纠正。无法保证所有文本都分类正确。
- 原始笔记 `资料/` 是不可变输入；页面只通过整理器写 `wiki/`，不接受 Agent 写工具。
- 关系图把 wiki 链接当无向边展示；重复链接只画一条，权重保留在数据里。

## License

[MIT](LICENSE)
