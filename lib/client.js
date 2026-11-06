window.__ModuleLoader__.load({
  id: 'dsh-knowledge-graph',
  factory: (require) => {
    const React = require('react')
    const { jsx, jsxs, Fragment } = require('react/jsx-runtime')
    const {
      useCallback, useEffect, useMemo, useRef, useState,
    } = React

    const h = React.createElement
    const API = 'knowledge-graph/api'
    const SIDEBAR_ID = 'knowledge-graph'
    const CATEGORY_COLOR = {
      概念: '#5b8def',
      人物: '#d99545',
      事物: '#39a67a',
      事件: '#b56bd6',
    }
    const API_SOURCE_LABEL = {
      selection: '划词',
      assistant: '整条回答',
      user: '我的消息',
    }

    function apiUrl(path, query) {
      const url = new URL(`${API}/${path}`, document.baseURI)
      if (window.location.search !== '') url.search = window.location.search
      if (query) {
        for (const [key, value] of Object.entries(query)) {
          if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
        }
      }
      return url.pathname + url.search
    }

    async function api(path, options = {}, query) {
      const response = await fetch(apiUrl(path, query), {
        cache: 'no-store',
        ...options,
        headers: {
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(options.headers ?? {}),
        },
      })
      let body
      try {
        body = await response.json()
      } catch {
        throw new Error(`请求失败（HTTP ${response.status}）`)
      }
      if (!response.ok || body?.ok === false) throw new Error(body?.error ?? `请求失败（HTTP ${response.status}）`)
      return body
    }

    function useToast() {
      const [toast, setToast] = useState(null)
      const timer = useRef(0)
      const show = useCallback((message, kind = 'ok') => {
        window.clearTimeout(timer.current)
        setToast({ message, kind, id: Date.now() })
        timer.current = window.setTimeout(() => { setToast(null) }, kind === 'error' ? 6000 : 2600)
      }, [])
      useEffect(() => () => { window.clearTimeout(timer.current) }, [])
      return [toast, show]
    }

    function Toast({ toast }) {
      if (toast === null) return null
      return jsx('div', {
        className: `kg-toast ${toast.kind === 'error' ? 'kg-toast-error' : ''}`,
        role: toast.kind === 'error' ? 'alert' : 'status',
        children: toast.message,
      })
    }

    function BookIcon({ size = 16 }) {
      return jsxs('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
        children: [
          jsx('path', { d: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5A2.5 2.5 0 0 1 17.5 21H6.5A2.5 2.5 0 0 1 4 18.5z', key: 'a' }),
          jsx('path', { d: 'M4 17.5A2.5 2.5 0 0 1 6.5 15H20', key: 'b' }),
          jsx('path', { d: 'M8 7h8', key: 'c' }),
        ],
      })
    }

    function TrashIcon({ size = 15 }) {
      return jsxs('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
        children: [
          jsx('path', { d: 'M4 7h16', key: 'a' }),
          jsx('path', { d: 'M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7', key: 'b' }),
          jsx('path', { d: 'M6.5 7l.8 12.1A2 2 0 0 0 9.3 21h5.4a2 2 0 0 0 2-1.9L17.5 7', key: 'c' }),
          jsx('path', { d: 'M10 11v6M14 11v6', key: 'd' }),
        ],
      })
    }

    function GraphIcon({ size = 18 }) {
      return jsxs('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round',
        'aria-hidden': 'true',
        children: [
          jsx('circle', { cx: 6, cy: 7, r: 2.4, key: 'a' }),
          jsx('circle', { cx: 18, cy: 6, r: 2.2, key: 'b' }),
          jsx('circle', { cx: 13, cy: 18, r: 2.5, key: 'c' }),
          jsx('path', { d: 'M8.2 8.3 15.7 6.8M7.1 9.2l4.5 6.9M16.7 7.8l-2.6 7.6', key: 'd' }),
        ],
      })
    }

    function errorText(error) {
      return error instanceof Error ? error.message : String(error)
    }

    /* ------------------------------------------------------------------ */
    /* Force graph                                                         */
    /* ------------------------------------------------------------------ */

    const REPULSION = 650
    const SPRING = 0.28
    const CENTER = 0.0011
    const COLLISION_GAP = 6
    const FRICTION = 0.85
    const ALPHA_DECAY = 0.985
    const ALPHA_MIN = 0.01
    const RADIUS_MIN = 4.8
    const RADIUS_MAX = 20.8

    function nodeRadius(degree, maxDegree) {
      if (maxDegree <= 0) return RADIUS_MIN
      const ratio = Math.max(0, Math.min(1, Math.sqrt(degree / maxDegree)))
      return RADIUS_MIN + ratio * (RADIUS_MAX - RADIUS_MIN)
    }

    function labelBackground() {
      const body = document.body
      const color = getComputedStyle(body).backgroundColor || ''
      const match = color.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/u)
      if (match !== null) {
        const [r, g, b] = match.slice(1).map(Number)
        return (r * 0.299 + g * 0.587 + b * 0.114) < 128 ? '#171a20' : '#ffffff'
      }
      return body.hasAttribute('data-ds-dark-theme') ? '#171a20' : '#ffffff'
    }

    class GraphEngine {
      constructor(canvas, callbacks) {
        this.canvas = canvas
        this.ctx = canvas.getContext('2d')
        this.callbacks = callbacks
        this.nodes = new Map()
        this.edges = []
        this.maxDegree = 1
        this.hub = null
        this.transform = { x: 0, y: 0, k: 1 }
        this.alpha = 0
        this.running = false
        this.drawOnly = false
        this.raf = 0
        this.drag = null
        this.pan = null
        this.hover = null
        this.selected = null
        this.query = ''
        this.searchHits = new Set()
        this.local = false
        this.localRoot = null
        this.depth = 2
        this.w = 0
        this.h = 0
        this.dpr = 1
        this.hasFit = false
        this.autoFitPending = false
        this.labelBg = labelBackground()
        this.frame = this.frame.bind(this)
        this.resizeObserver = new ResizeObserver(() => this.resize())
        this.resizeObserver.observe(canvas)
        this.resize()
        canvas.addEventListener('wheel', event => this.onWheel(event), { passive: false })
        canvas.addEventListener('pointerdown', event => this.onPointerDown(event))
        canvas.addEventListener('pointermove', event => this.onPointerMove(event))
        canvas.addEventListener('pointerup', event => this.onPointerUp(event))
        canvas.addEventListener('pointercancel', event => this.onPointerUp(event))
        canvas.addEventListener('pointerleave', event => this.onPointerLeave(event))
        canvas.addEventListener('dblclick', event => this.onDoubleClick(event))
        canvas.addEventListener('contextmenu', event => event.preventDefault())
      }

      destroy() {
        cancelAnimationFrame(this.raf)
        this.running = false
        this.resizeObserver.disconnect()
      }

      resize() {
        const rect = this.canvas.getBoundingClientRect()
        const width = Math.max(1, Math.floor(rect.width))
        const height = Math.max(1, Math.floor(rect.height))
        if (width === this.w && height === this.h) return
        const old = { w: this.w, h: this.h }
        this.w = width
        this.h = height
        this.dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1))
        this.canvas.width = Math.floor(width * this.dpr)
        this.canvas.height = Math.floor(height * this.dpr)
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
        if (old.w === 0) {
          this.transform.x = width / 2
          this.transform.y = height / 2
        } else {
          this.transform.x += (width - old.w) / 2
          this.transform.y += (height - old.h) / 2
        }
        this.labelBg = labelBackground()
        if (!this.hasFit && this.nodes.size > 0) this.fitView()
        this.requestDraw()
      }

      visibleNodes() {
        if (!this.local) return [...this.nodes.values()]
        if (this.localRoot === null || !this.nodes.has(this.localRoot)) return [...this.nodes.values()]
        const level = new Map([[this.localRoot, 0]])
        const queue = [this.localRoot]
        while (queue.length > 0) {
          const id = queue.shift()
          const current = level.get(id)
          if (current >= this.depth) continue
          for (const edge of this.edges) {
            const next = edge.source === id ? edge.target : edge.target === id ? edge.source : null
            if (next === null || level.has(next)) continue
            level.set(next, current + 1)
            queue.push(next)
          }
        }
        return [...this.nodes.values()].filter(node => level.has(node.id))
      }

      visibleIds() {
        return new Set(this.visibleNodes().map(node => node.id))
      }

      setData(graph) {
        const signature = (graph?.nodes ?? []).map(node => `${node.id}\0${node.title}\0${node.degree}\0${node.category}\0${node.summary ?? ''}`).join('\u0001')
          + '\u0002'
          + (graph?.edges ?? []).map(edge => `${edge.source}\0${edge.target}`).join('\u0001')
        if (this.signature === signature && this.nodes.size > 0) return
        this.signature = signature
        const previous = this.nodes
        const nodes = new Map()
        const sorted = [...(graph?.nodes ?? [])].sort((a, b) => b.degree - a.degree)
        this.maxDegree = Math.max(1, ...sorted.map(node => node.degree))
        this.hub = sorted[0]?.id ?? null
        let index = 0
        for (const raw of graph?.nodes ?? []) {
          const old = previous.get(raw.id)
          const radius = nodeRadius(raw.degree, this.maxDegree)
          const angle = index * 2.399963229728653
          const ring = 42 + Math.sqrt(index + 1) * 34
          const node = {
            id: raw.id,
            title: raw.title,
            category: raw.category,
            summary: raw.summary,
            degree: raw.degree,
            r: radius,
            x: old?.x ?? (raw.id === this.hub ? 0 : Math.cos(angle) * ring),
            y: old?.y ?? (raw.id === this.hub ? 0 : Math.sin(angle) * ring),
            vx: old?.vx ?? 0,
            vy: old?.vy ?? 0,
            labelWidth: 0,
          }
          nodes.set(node.id, node)
          index += 1
        }
        this.nodes = nodes
        this.edges = (graph?.edges ?? []).filter(edge => nodes.has(edge.source) && nodes.has(edge.target))
        this.alpha = Math.max(this.alpha, 0.85)
        this.drawOnly = false
        this.start()
        if (!this.hasFit && this.nodes.size > 0) {
          this.fitView()
          this.autoFitPending = true
        }
        this.requestDraw()
      }

      setSelection(id) {
        this.selected = this.nodes.has(id) ? id : null
        this.requestDraw()
      }

      setNumberedSelection(id) {
        this.selected = id
        this.requestDraw()
      }

      setQuery(query) {
        this.query = String(query ?? '').trim().toLocaleLowerCase()
        this.searchHits = new Set()
        if (this.query !== '') {
          for (const node of this.nodes.values()) {
            const haystack = `${node.title} ${node.summary} ${node.id}`.toLocaleLowerCase()
            if (haystack.includes(this.query)) this.searchHits.add(node.id)
          }
        }
        this.requestDraw()
      }

      setLocal(enabled, root, depth) {
        const nextRoot = root ?? null
        const nextDepth = depth ?? 2
        if (this.local === enabled && this.localRoot === nextRoot && this.depth === nextDepth) return
        this.local = enabled
        this.localRoot = nextRoot
        this.depth = nextDepth
        this.alpha = Math.max(this.alpha, 0.3)
        this.start()
      }

      activeNode() {
        return this.hover !== null && this.nodes.has(this.hover) ? this.hover : this.selected
      }

      levelsFrom(roots) {
        if (roots.length === 0) return new Map()
        const level = new Map(roots.map(id => [id, 0]))
        const queue = [...roots]
        while (queue.length > 0) {
          const id = queue.shift()
          const current = level.get(id)
          if (current >= 3) continue
          for (const edge of this.edges) {
            const next = edge.source === id ? edge.target : edge.target === id ? edge.source : null
            if (next === null || level.has(next)) continue
            level.set(next, current + 1)
            queue.push(next)
          }
        }
        return level
      }

      highlightLevels() {
        const active = this.activeNode()
        const merged = new Map()
        const merge = levels => {
          for (const [id, level] of levels) {
            const current = merged.get(id)
            if (current === undefined || level < current) merged.set(id, level)
          }
        }
        if (active !== null) merge(this.levelsFrom([active]))
        if (this.searchHits.size > 0) merge(this.levelsFrom([...this.searchHits]))
        return merged
      }

      brightness(id, levels) {
        if (levels.size === 0) return 1
        const level = levels.get(id)
        if (level === undefined) return 0.12
        if (level === 0) return 1
        if (level === 1) return 0.8
        if (level === 2) return 0.35
        return 0.12
      }

      edgeAlpha(edge, levels) {
        if (levels.size === 0) return 0.3
        const a = levels.get(edge.source)
        const b = levels.get(edge.target)
        if (a === 0 || b === 0) return 0.8
        if ((a !== undefined && a <= 2) || (b !== undefined && b <= 2)) return 0.35
        return 0.06
      }

      start() {
        if (this.running) return
        this.running = true
        this.raf = requestAnimationFrame(this.frame)
      }

      requestDraw() {
        this.drawOnly = true
        this.start()
      }

      frame() {
        this.running = false
        if (this.alpha > ALPHA_MIN || this.drag !== null) {
          this.step()
          this.alpha *= ALPHA_DECAY
        }
        this.draw()
        this.drawOnly = false
        if (this.autoFitPending && this.alpha <= 0.06 && this.drag === null) {
          this.autoFitPending = false
          this.fitView()
        }
        if (this.alpha > ALPHA_MIN || this.drag !== null) this.start()
      }

      step() {
        const visible = this.visibleNodes()
        if (visible.length === 0) return
        const alpha = Math.max(this.alpha, 0.03)
        const count = visible.length
        for (let i = 0; i < count; i += 1) {
          const node = visible[i]
          node.vx *= FRICTION
          node.vy *= FRICTION
        }
        for (let i = 0; i < count; i += 1) {
          const a = visible[i]
          for (let j = i + 1; j < count; j += 1) {
            const b = visible[j]
            let dx = b.x - a.x
            let dy = b.y - a.y
            let dist2 = dx * dx + dy * dy
            if (dist2 < 0.01) {
              const angle = (i * 31 + j * 17) * 0.61803398875
              dx = Math.cos(angle) * 0.5
              dy = Math.sin(angle) * 0.5
              dist2 = 0.25
            }
            const dist = Math.sqrt(dist2)
            const force = (REPULSION / Math.max(dist2, 9)) * alpha
            const ux = dx / dist
            const uy = dy / dist
            a.vx -= ux * force
            a.vy -= uy * force
            b.vx += ux * force
            b.vy += uy * force
            const min = a.r + b.r + COLLISION_GAP
            if (dist < min) {
              const overlap = (min - dist) / dist
              const aFixed = this.drag?.node === a
              const bFixed = this.drag?.node === b
              if (aFixed && !bFixed) {
                b.x += ux * overlap
                b.y += uy * overlap
              } else if (bFixed && !aFixed) {
                a.x -= ux * overlap
                a.y -= uy * overlap
              } else {
                a.x -= ux * overlap * 0.5
                a.y -= uy * overlap * 0.5
                b.x += ux * overlap * 0.5
                b.y += uy * overlap * 0.5
              }
            }
          }
        }
        const visibleSet = new Set(visible.map(node => node.id))
        for (const edge of this.edges) {
          if (!visibleSet.has(edge.source) || !visibleSet.has(edge.target)) continue
          const a = this.nodes.get(edge.source)
          const b = this.nodes.get(edge.target)
          const dx = b.x - a.x
          const dy = b.y - a.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.01
          const rest = 66 + a.r + b.r
          const force = SPRING * (dist - rest) * 0.045 * alpha
          const ux = dx / dist
          const uy = dy / dist
          a.vx += ux * force
          a.vy += uy * force
          b.vx -= ux * force
          b.vy -= uy * force
        }
        for (const node of visible) {
          const ratio = node.degree / this.maxDegree
          const pull = CENTER * (1 + 2.4 * ratio * ratio + 8 * Math.pow(ratio, 6)) * alpha
          node.vx += (0 - node.x) * pull
          node.vy += (0 - node.y) * pull
          if (node.id === this.hub && this.drag?.node !== node) {
            // The strongest hub stays visibly in the middle; the tiny center
            // force alone is not enough against 300-way repulsion.
            node.x *= 0.975
            node.y *= 0.975
            node.vx *= 0.55
            node.vy *= 0.55
          }
          if (this.drag?.node === node) continue
          const speed = Math.hypot(node.vx, node.vy)
          if (speed > 12) {
            node.vx = (node.vx / speed) * 12
            node.vy = (node.vy / speed) * 12
          }
          node.x += node.vx
          node.y += node.vy
          node.x = Math.max(-5000, Math.min(5000, node.x))
          node.y = Math.max(-5000, Math.min(5000, node.y))
        }
      }

      screen(node) {
        return {
          x: node.x * this.transform.k + this.transform.x,
          y: node.y * this.transform.k + this.transform.y,
          r: Math.max(2.5, node.r * this.transform.k),
        }
      }

      draw() {
        const ctx = this.ctx
        ctx.clearRect(0, 0, this.w, this.h)
        if (this.nodes.size === 0) return
        const visible = this.visibleNodes()
        const ids = new Set(visible.map(node => node.id))
        const levels = this.highlightLevels()
        const active = this.activeNode()
        const dark = this.labelBg === '#171a20'
        ctx.lineCap = 'round'

        // Dot grid gives the canvas depth without owning a background color.
        ctx.fillStyle = dark ? 'rgba(255,255,255,0.055)' : 'rgba(31,35,40,0.075)'
        const step = 28 * this.transform.k
        if (step >= 14 && step <= 60) {
          const startX = this.transform.x % step
          const startY = this.transform.y % step
          for (let x = startX; x < this.w; x += step) {
            for (let y = startY; y < this.h; y += step) {
              ctx.fillRect(x, y, 1, 1)
            }
          }
        }

        for (const edge of this.edges) {
          if (!ids.has(edge.source) || !ids.has(edge.target)) continue
          const a = this.nodes.get(edge.source)
          const b = this.nodes.get(edge.target)
          const pa = this.screen(a)
          const pb = this.screen(b)
          const alpha = this.edgeAlpha(edge, levels)
          ctx.globalAlpha = alpha
          ctx.strokeStyle = dark ? '#b8c6df' : '#48566d'
          ctx.lineWidth = levels.size > 0 && alpha >= 0.8 ? 2 : 1.4
          ctx.beginPath()
          ctx.moveTo(pa.x, pa.y)
          ctx.lineTo(pb.x, pb.y)
          ctx.stroke()
        }
        ctx.globalAlpha = 1

        for (const node of visible) {
          const p = this.screen(node)
          const brightness = this.brightness(node.id, levels)
          ctx.globalAlpha = brightness
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
          ctx.fillStyle = CATEGORY_COLOR[node.category] ?? '#7d8aa5'
          ctx.fill()
          if (node.id === active || node.id === this.selected) {
            ctx.lineWidth = 2.4
            ctx.strokeStyle = dark ? '#ffffff' : '#1f2328'
            ctx.stroke()
          } else if (node.id === this.hover) {
            ctx.lineWidth = 1.6
            ctx.strokeStyle = dark ? 'rgba(255,255,255,0.8)' : 'rgba(31,35,40,0.7)'
            ctx.stroke()
          } else {
            ctx.lineWidth = 1
            ctx.strokeStyle = dark ? 'rgba(255,255,255,0.18)' : 'rgba(31,35,40,0.16)'
            ctx.stroke()
          }
          if (this.searchHits.has(node.id)) {
            ctx.beginPath()
            ctx.arc(p.x, p.y, p.r + 3.5, 0, Math.PI * 2)
            ctx.setLineDash([3, 3])
            ctx.lineWidth = 1.6
            ctx.strokeStyle = '#e2a93b'
            ctx.stroke()
            ctx.setLineDash([])
          }
        }
        ctx.globalAlpha = 1
        this.drawLabels(visible, levels, active, dark)
      }

      drawLabels(visible, levels, active, dark) {
        const k = this.transform.k
        if (k < 0.5) return
        const fade = Math.max(0, Math.min(1, (k - 0.5) / 0.3))
        const ctx = this.ctx
        const sizes = []
        const occupied = []
        for (const node of visible) {
          const p = this.screen(node)
          sizes.push({
            node,
            p,
            priority: (node.id === active ? 1000 : 0) + (this.searchHits.has(node.id) ? 500 : 0) + node.degree,
            alpha: fade * (node.id === active || this.searchHits.has(node.id) ? 1 : 0.86),
          })
          occupied.push({ x: p.x - p.r - 1, y: p.y - p.r - 1, w: p.r * 2 + 2, h: p.r * 2 + 2 })
        }
        sizes.sort((a, b) => b.priority - a.priority)
        ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        const limit = 220
        let drawn = 0
        for (const entry of sizes) {
          if (drawn >= limit) break
          const { node, p } = entry
          if (node.labelWidth === 0) {
            node.labelWidth = Math.ceil(ctx.measureText(node.title).width)
          }
          const width = Math.min(node.labelWidth, 220)
          const x = Math.max(8, Math.min(this.w - width - 8, p.x - width / 2))
          const y = p.y + p.r + 4
          const box = { x: x - 3, y: y - 1, w: width + 6, h: 17 }
          if (box.y + box.h > this.h - 4 || box.x < 2 || box.x + box.w > this.w - 2) continue
          let overlaps = false
          for (const other of occupied) {
            if (box.x < other.x + other.w && box.x + box.w > other.x && box.y < other.y + other.h && box.y + box.h > other.y) {
              overlaps = true
              break
            }
          }
          if (overlaps) continue
          occupied.push(box)
          drawn += 1
          ctx.globalAlpha = entry.alpha
          ctx.fillStyle = this.labelBg
          ctx.fillRect(box.x, box.y, box.w, box.h)
          ctx.fillStyle = dark ? '#f2f4f8' : '#1f2328'
          const clipped = node.title.length > 34 ? `${node.title.slice(0, 33)}…` : node.title
          ctx.fillText(clipped, x + width / 2, y + 1, width)
        }
        ctx.globalAlpha = 1
        ctx.textAlign = 'left'
      }

      hitTest(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect()
        const x = clientX - rect.left
        const y = clientY - rect.top
        let best = null
        let bestDistance = Infinity
        for (const node of this.visibleNodes()) {
          const p = this.screen(node)
          const distance = Math.hypot(x - p.x, y - p.y)
          if (distance <= Math.max(9, p.r + 2) && distance < bestDistance) {
            best = node
            bestDistance = distance
          }
        }
        return best
      }

      onWheel(event) {
        event.preventDefault()
        this.autoFitPending = false
        const rect = this.canvas.getBoundingClientRect()
        const px = event.clientX - rect.left
        const py = event.clientY - rect.top
        const factor = Math.exp(-event.deltaY * 0.0015)
        const next = Math.max(0.12, Math.min(4, this.transform.k * factor))
        if (next === this.transform.k) return
        const worldX = (px - this.transform.x) / this.transform.k
        const worldY = (py - this.transform.y) / this.transform.k
        this.transform.k = next
        this.transform.x = px - worldX * next
        this.transform.y = py - worldY * next
        this.requestDraw()
      }

      onPointerDown(event) {
        if (event.button !== 0) return
        this.autoFitPending = false
        this.canvas.setPointerCapture(event.pointerId)
        const node = this.hitTest(event.clientX, event.clientY)
        if (node !== null) {
          this.drag = { node, moved: false }
          this.alpha = 1
          this.start()
        } else {
          this.pan = { x: event.clientX, y: event.clientY, tx: this.transform.x, ty: this.transform.y }
        }
      }

      onPointerMove(event) {
        if (this.drag !== null) {
          const rect = this.canvas.getBoundingClientRect()
          const worldX = (event.clientX - rect.left - this.transform.x) / this.transform.k
          const worldY = (event.clientY - rect.top - this.transform.y) / this.transform.k
          const dx = worldX - this.drag.node.x
          const dy = worldY - this.drag.node.y
          if (Math.abs(dx) + Math.abs(dy) > 0.8) this.drag.moved = true
          this.drag.node.x = worldX
          this.drag.node.y = worldY
          this.drag.node.vx = 0
          this.drag.node.vy = 0
          this.alpha = 1
          this.start()
          return
        }
        if (this.pan !== null) {
          this.transform.x = this.pan.tx + event.clientX - this.pan.x
          this.transform.y = this.pan.ty + event.clientY - this.pan.y
          this.requestDraw()
          return
        }
        const node = this.hitTest(event.clientX, event.clientY)
        const next = node?.id ?? null
        if (next !== this.hover) {
          this.hover = next
          this.callbacks.onHover(node, event.clientX, event.clientY)
          this.requestDraw()
        } else if (node !== null) {
          this.callbacks.onHover(node, event.clientX, event.clientY)
        }
        this.canvas.style.cursor = node === null ? 'grab' : 'pointer'
      }

      onPointerUp(event) {
        if (this.drag !== null) {
          const moved = this.drag.moved
          const node = this.drag.node
          this.drag = null
          this.alpha = 1
          this.start()
          if (!moved) this.callbacks.onSelect(node.id)
        } else if (this.pan !== null) {
          this.pan = null
        }
        try {
          this.canvas.releasePointerCapture(event.pointerId)
        } catch {
          // Pointer capture already ended; releasing again is harmless.
        }
      }

      onPointerLeave() {
        if (this.hover !== null) {
          this.hover = null
          this.callbacks.onHover(null, 0, 0)
          this.requestDraw()
        }
      }

      onDoubleClick(event) {
        const node = this.hitTest(event.clientX, event.clientY)
        if (node === null) this.fitView()
        else this.callbacks.onSelect(node.id)
      }

      fitView() {
        const visible = this.visibleNodes()
        if (visible.length === 0) return
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const node of visible) {
          minX = Math.min(minX, node.x - node.r)
          minY = Math.min(minY, node.y - node.r)
          maxX = Math.max(maxX, node.x + node.r)
          maxY = Math.max(maxY, node.y + node.r)
        }
        const pad = 54
        const focus = this.nodes.get(this.local && this.localRoot !== null ? this.localRoot : this.hub)
        const centerX = focus?.x ?? (minX + maxX) / 2
        const centerY = focus?.y ?? (minY + maxY) / 2
        let reach = 1
        for (const node of visible) {
          reach = Math.max(reach, Math.hypot(node.x - centerX, node.y - centerY) + node.r)
        }
        const k = Math.max(0.12, Math.min(2.4, Math.min(this.w, this.h) / Math.max(1, (reach + pad) * 2)))
        this.transform.k = k
        this.transform.x = this.w / 2 - centerX * k
        this.transform.y = this.h / 2 - centerY * k
        this.hasFit = true
        this.requestDraw()
      }
    }

    function GraphView({ graph, selectedId, onSelect, query, local, localRoot, depth }) {
      const canvasRef = useRef(null)
      const engineRef = useRef(null)
      const selectRef = useRef(onSelect)
      selectRef.current = onSelect
      const [hover, setHover] = useState(null)
      const [tooltip, setTooltip] = useState(null)

      useEffect(() => {
        const canvas = canvasRef.current
        if (canvas === null) return undefined
        const engine = new GraphEngine(canvas, {
          onSelect: id => selectRef.current?.(id),
          onHover: (node, x, y) => {
            setHover(node)
            if (node === null) {
              setTooltip(null)
              return
            }
            const rect = canvas.getBoundingClientRect()
            setTooltip({
              x: Math.max(8, Math.min(window.innerWidth - 280, x + 14)),
              y: Math.max(8, Math.min(window.innerHeight - 150, y + 14)),
              node,
              screen: { left: rect.left, top: rect.top },
            })
          },
        })
        engineRef.current = engine
        window.__knowledgeGraphEngine = engine
        return () => {
          if (window.__knowledgeGraphEngine === engine) delete window.__knowledgeGraphEngine
          engine.destroy()
          engineRef.current = null
        }
      }, [])

      useEffect(() => {
        engineRef.current?.setData(graph)
      }, [graph])

      useEffect(() => {
        engineRef.current?.setSelection(selectedId)
      }, [selectedId])

      useEffect(() => {
        engineRef.current?.setQuery(query)
      }, [query])

      useEffect(() => {
        engineRef.current?.setLocal(local, localRoot, depth)
      }, [local, localRoot, depth])

      const style = hover === null ? undefined : { boxShadow: `0 0 0 2px ${CATEGORY_COLOR[hover.category] ?? '#7d8aa5'}` }

      return jsxs('div', {
        className: 'kg-graph-wrap',
        children: [
          jsx('canvas', { ref: canvasRef, className: 'kg-canvas', style, 'aria-label': '知识图谱关系图' }),
          tooltip !== null && jsxs('div', {
            className: 'kg-tooltip',
            style: { left: tooltip.x, top: tooltip.y },
            children: [
              jsx('strong', { children: tooltip.node.title }),
              jsxs('span', { className: 'kg-tooltip-meta', children: [
                `${tooltip.node.category} · 连接 ${tooltip.node.degree}`,
              ] }),
              tooltip.node.summary !== '' && jsx('p', { children: tooltip.node.summary }),
            ],
          }),
          jsx('div', { className: 'kg-graph-hint', children: '滚轮缩放 · 拖空白平移 · 拖节点让位 · 双击空白适应' }),
        ],
      })
    }

    /* ------------------------------------------------------------------ */
    /* Markdown viewer                                                     */
    /* ------------------------------------------------------------------ */

    function parseFrontmatter(source) {
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
          try { value = JSON.parse(value) } catch { value = value.slice(1, -1) }
        }
        data[match[1]] = value
      }
      return { data, body: text.slice(end + 5) }
    }

    function inlineMarkdown(text, onWiki) {
      const nodes = []
      const regex = /\[\[([^\]\n]+)\]\]|\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/gu
      let last = 0
      let match
      let key = 0
      while ((match = regex.exec(text)) !== null) {
        if (match.index > last) nodes.push(text.slice(last, match.index))
        if (match[1] !== undefined) {
          const raw = match[1]
          const [targetPart, labelPart] = raw.split('|', 2)
          const target = targetPart.split('#', 1)[0].replace(/\.md$/u, '').trim()
          nodes.push(jsx('button', {
            type: 'button',
            className: 'kg-wikilink',
            onClick: () => onWiki(target),
            title: target,
            children: labelPart ?? target.split('/').at(-1),
            key: `w${key++}`,
          }))
        } else if (match[2] !== undefined) {
          nodes.push(jsx('strong', { children: match[2], key: `b${key++}` }))
        } else if (match[3] !== undefined) {
          nodes.push(jsx('code', { children: match[3], key: `c${key++}` }))
        } else if (match[4] !== undefined) {
          nodes.push(jsx('a', {
            href: match[5], target: '_blank', rel: 'noreferrer',
            children: match[4], key: `a${key++}`,
          }))
        }
        last = regex.lastIndex
      }
      if (last < text.length) nodes.push(text.slice(last))
      return nodes
    }

    function Markdown({ content, onWiki }) {
      const blocks = useMemo(() => {
        const { body } = parseFrontmatter(content)
        const lines = body.replace(/\r\n?/gu, '\n').split('\n')
        const result = []
        let index = 0
        while (index < lines.length) {
          const line = lines[index]
          if (line.trim() === '') { index += 1; continue }
          const fence = line.match(/^```(\w*)\s*$/u)
          if (fence !== null) {
            const code = []
            index += 1
            while (index < lines.length && !/^```\s*$/u.test(lines[index])) {
              code.push(lines[index])
              index += 1
            }
            index += 1
            result.push(jsx('pre', { className: 'kg-code', children: jsx('code', { children: code.join('\n') }) }, `p${result.length}`))
            continue
          }
          const heading = line.match(/^(#{1,4})\s+(.+)$/u)
          if (heading !== null) {
            const level = Math.min(4, heading[1].length)
            if (level === 1 && result.length === 0) {
              // The panel already renders the page title; keep the body's H1
              // conceptual but not duplicated above it.
              index += 1
              continue
            }
            result.push(jsx(`h${level}`, { children: inlineMarkdown(heading[2], onWiki) }, `h${result.length}`))
            index += 1
            continue
          }
          if (/^[-*+]\s+/u.test(line)) {
            const items = []
            while (index < lines.length && /^[-*+]\s+/u.test(lines[index])) {
              items.push(jsx('li', { children: inlineMarkdown(lines[index].replace(/^[-*+]\s+/u, ''), onWiki) }, `i${result.length}-${items.length}`))
              index += 1
            }
            result.push(jsx('ul', { children: items }, `u${result.length}`))
            continue
          }
          if (/^>\s?/u.test(line)) {
            const quote = []
            while (index < lines.length && /^>\s?/u.test(lines[index])) {
              quote.push(lines[index].replace(/^>\s?/u, ''))
              index += 1
            }
            result.push(jsx('blockquote', { children: inlineMarkdown(quote.join(' '), onWiki) }, `q${result.length}`))
            continue
          }
          if (/^(-{3,}|\*{3,})\s*$/u.test(line)) {
            result.push(jsx('hr', {}, `r${result.length}`))
            index += 1
            continue
          }
          const paragraph = [line.trim()]
          index += 1
          while (index < lines.length && lines[index].trim() !== ''
            && !/^(#{1,4})\s+/u.test(lines[index])
            && !/^[-*+]\s+/u.test(lines[index])
            && !/^```/u.test(lines[index])
            && !/^>\s?/u.test(lines[index])) {
            paragraph.push(lines[index].trim())
            index += 1
          }
          result.push(jsx('p', { children: inlineMarkdown(paragraph.join(' '), onWiki) }, `p${result.length}`))
        }
        return result
      }, [content, onWiki])
      return jsx('div', { className: 'kg-prose', children: blocks })
    }

    function NoteView({ page, loading, error, onWiki, onRefresh, onDeleted }) {
      const [confirmDelete, setConfirmDelete] = useState(false)
      const [deleting, setDeleting] = useState(false)
      const [deleteError, setDeleteError] = useState(null)

      useEffect(() => {
        setConfirmDelete(false)
        setDeleting(false)
        setDeleteError(null)
      }, [page?.path])

      const remove = async () => {
        if (page === null || deleting) return
        setDeleting(true)
        setDeleteError(null)
        try {
          const result = await api('delete', { method: 'POST', body: JSON.stringify({ path: page.path }) })
          onDeleted(result)
        } catch (cause) {
          setDeleting(false)
          const message = errorText(cause)
          setDeleteError(message.includes('405')
            ? '当前宿主仍是旧版本（没有 /api/delete 路由）。仅刷新页面不够，请完全退出 DeepSeek Harness 后重新启动。'
            : message)
        }
      }

      if (loading && page === null) {
        return jsx('div', { className: 'kg-note-empty', children: '正在读取页面…' })
      }
      if (error !== null) {
        return jsxs('div', { className: 'kg-note-empty kg-error', children: ['读取失败：', error] })
      }
      if (page === null) {
        return jsxs('div', { className: 'kg-note-empty', children: [
          jsx(GraphIcon, { size: 28 }),
          jsx('p', { children: '在左侧点一个节点，正文会显示在这里。' }),
          jsx('p', { className: 'kg-muted', children: '关系图里的每个 md 是节点，[[ ]] 是边。' }),
        ] })
      }
      return jsxs(Fragment, { children: [
        jsxs('div', { className: 'kg-note-head', children: [
          jsx('div', { className: 'kg-note-title', children: page.title }),
          jsxs('div', { className: 'kg-note-meta', children: [
            jsx('span', { className: 'kg-chip', style: { color: CATEGORY_COLOR[page.category] ?? '#7d8aa5', borderColor: `${CATEGORY_COLOR[page.category] ?? '#7d8aa5'}55` }, children: page.category }),
            jsx('span', { className: 'kg-chip kg-path', title: page.path, children: page.path }),
            jsxs('span', { className: 'kg-note-actions', children: [
              jsx('button', { type: 'button', className: 'kg-icon-button', onClick: onRefresh, title: '刷新正文', children: '↻' }),
              jsx('button', {
                type: 'button',
                className: 'kg-icon-button kg-danger',
                title: '删除页面',
                'aria-label': '删除页面',
                disabled: deleting,
                onClick: () => { setConfirmDelete(true); setDeleteError(null) },
                children: jsx(TrashIcon, { size: 15 }),
              }),
            ] }),
          ] }),
          page.summary !== '' && jsx('p', { className: 'kg-note-summary', children: page.summary }),
          confirmDelete && jsxs('div', {
            className: 'kg-delete-confirm',
            role: 'alertdialog',
            'aria-label': '确认删除页面',
            children: [
              jsx('span', { children: `删除「${page.title}」？只删除 wiki 页面，资料原文保留。` }),
              jsxs('div', { className: 'kg-delete-actions', children: [
                jsx('button', {
                  type: 'button', className: 'kg-danger-button', disabled: deleting,
                  onClick: () => { void remove() }, children: deleting ? '删除中…' : '确认删除',
                }),
                jsx('button', {
                  type: 'button', className: 'kg-cancel-button', disabled: deleting,
                  onClick: () => { setConfirmDelete(false); setDeleteError(null) }, children: '取消',
                }),
              ] }),
              deleteError !== null && jsx('div', { className: 'kg-error', children: `删除失败：${deleteError}` }),
            ],
          }),
        ] }),
        jsx('div', { className: 'kg-note-scroll', children: jsx(Markdown, { content: page.content, onWiki }) }),
      ] })
    }

    /* ------------------------------------------------------------------ */
    /* Panel                                                               */
    /* ------------------------------------------------------------------ */

    function StatusStrip({ status, error }) {
      if (error !== null) return jsx('div', { className: 'kg-status kg-status-error', children: `状态读取失败：${error}` })
      if (status === null) return jsx('div', { className: 'kg-status', children: '读取知识库…' })
      const queue = status.queue ?? { pending: 0, running: null, recent: [] }
      const pending = queue.pending + (queue.running === null ? 0 : 1)
      return jsxs('div', { className: 'kg-status', children: [
        jsxs('div', { className: 'kg-status-line', children: [
          jsx('span', { className: `kg-dot ${pending > 0 ? 'kg-dot-busy' : 'kg-dot-ok'}` }),
          pending > 0
            ? jsx('span', { children: queue.running === null ? `排队 ${queue.pending}` : `整理中：${queue.running.title}${queue.pending > 0 ? ` · 还有 ${queue.pending}` : ''}` })
            : jsx('span', { children: '整理队列空闲' }),
          jsx('span', { className: 'kg-status-spacer' }),
          status.model !== null && jsx('span', { className: 'kg-muted', children: `${status.model.provider}/${status.model.model}` }),
        ] }),
        queue.recent.length > 0 && jsxs('div', { className: 'kg-recent', children: [
          jsx('span', { className: 'kg-recent-label', children: '最近' }),
          ...queue.recent.slice(0, 3).map(item => jsxs('span', {
            className: `kg-recent-item ${item.status === 'failed' ? 'kg-error' : ''}`,
            title: item.status === 'failed' ? item.error : (item.pages ?? []).map(page => page.title).join('、'),
            children: [
              jsx('span', { className: `kg-dot ${item.status === 'failed' ? 'kg-dot-bad' : 'kg-dot-ok'}` }),
              item.status === 'failed' ? item.title : `${item.title}${item.pages?.length ? ` · ${item.pages.length} 页` : ''}`,
            ],
          }, item.id)),
        ] }),
      ] })
    }

    function KnowledgePanel() {
      const [toast, showToast] = useToast()
      const [graph, setGraph] = useState({ nodes: [], edges: [] })
      const [selectedId, setSelectedId] = useState(null)
      const [page, setPage] = useState(null)
      const [pageLoading, setPageLoading] = useState(false)
      const [pageError, setPageError] = useState(null)
      const [status, setStatus] = useState(null)
      const [statusError, setStatusError] = useState(null)
      const [query, setQuery] = useState('')
      const [local, setLocal] = useState(false)
      const [depth, setDepth] = useState(2)
      const [localRoot, setLocalRoot] = useState(null)
      const [graphError, setGraphError] = useState(null)
      const [version, setVersion] = useState(0)
      const [interacted, setInteracted] = useState(false)
      const selectedRef = useRef(null)
      selectedRef.current = selectedId

      const loadGraph = useCallback(async () => {
        try {
          const next = await api('graph')
          setGraphError(null)
          setGraph({ nodes: next.nodes ?? [], edges: next.edges ?? [] })
          const current = selectedRef.current
          const exists = current !== null && (next.nodes ?? []).some(node => node.id === current)
          if (!exists) {
            const hub = [...(next.nodes ?? [])].sort((a, b) => b.degree - a.degree)[0]?.id ?? null
            if (hub !== null) {
              setSelectedId(hub)
              setLocalRoot(previous => previous ?? hub)
            }
          }
        } catch (error) {
          setGraphError(errorText(error))
        }
      }, [])

      const loadStatus = useCallback(async () => {
        try {
          const next = await api('status')
          setStatus(next)
          setStatusError(null)
        } catch (error) {
          setStatusError(errorText(error))
        }
      }, [])

      useEffect(() => {
        let alive = true
        const run = async () => {
          await loadGraph()
          if (!alive) return
          await loadStatus()
        }
        void run()
        const graphTimer = window.setInterval(() => { void loadGraph() }, 4000)
        const statusTimer = window.setInterval(() => { void loadStatus() }, 1200)
        const onChanged = () => { void loadGraph(); void loadStatus() }
        window.addEventListener('knowledge-graph:changed', onChanged)
        return () => {
          alive = false
          window.clearInterval(graphTimer)
          window.clearInterval(statusTimer)
          window.removeEventListener('knowledge-graph:changed', onChanged)
        }
      }, [loadGraph, loadStatus])

      const openPage = useCallback(async id => {
        if (id === null || id === undefined) return
        setSelectedId(id)
        setPageLoading(true)
        setPageError(null)
        try {
          const next = await api('page', {}, { path: id })
          setPage(next)
        } catch (error) {
          setPageError(errorText(error))
        } finally {
          setPageLoading(false)
        }
      }, [])

      useEffect(() => {
        if (selectedId !== null) void openPage(selectedId)
      }, [selectedId, openPage])

      useEffect(() => {
        setLocalRoot(previous => {
          if (previous !== null && graph.nodes.some(node => node.id === previous)) return previous
          return selectedId ?? graph.nodes.slice().sort((a, b) => b.degree - a.degree)[0]?.id ?? null
        })
      }, [graph, selectedId])

      const onWiki = useCallback(target => {
        const clean = String(target ?? '').replace(/\.md$/u, '').replace(/^\/+/u, '')
        const direct = graph.nodes.find(node => node.id === clean)
        const byTitle = graph.nodes.find(node => node.title === clean || node.title === clean.split('/').at(-1))
        const found = direct ?? byTitle
        if (found !== undefined) {
          setInteracted(true)
          setLocalRoot(found.id)
          void openPage(found.id)
        }
      }, [graph.nodes, openPage])

      const onDeleted = useCallback(result => {
        const path = String(result?.path ?? '')
        setPage(null)
        setPageError(null)
        setSelectedId(null)
        setInteracted(false)
        setLocalRoot(previous => previous === path ? null : previous)
        showToast(`已删除「${result?.title ?? path}」`)
        void loadGraph()
        void loadStatus()
        window.dispatchEvent(new CustomEvent('knowledge-graph:changed'))
      }, [loadGraph, loadStatus, showToast])

      const hub = useMemo(() => [...graph.nodes].sort((a, b) => b.degree - a.degree)[0] ?? null, [graph.nodes])
      const selected = graph.nodes.find(node => node.id === selectedId) ?? null
      const stats = status?.stats ?? { pages: graph.nodes.length, links: graph.edges.length }

      return jsxs('div', { className: 'kg-page', children: [
        jsxs('div', { className: 'kg-header', children: [
          jsxs('div', { className: 'kg-heading', children: [
            jsx('div', { className: 'kg-mark', children: jsx(GraphIcon, { size: 20 }) }),
            jsxs('div', { children: [
              jsx('div', { className: 'kg-title', children: '知识图谱' }),
              jsxs('div', { className: 'kg-subtitle', children: [
                `${stats.pages} 个页面 · ${stats.links} 条链接`,
                selected !== null ? ` · ${selected.title}` : '',
              ] }),
            ] }),
          ] }),
          jsxs('div', { className: 'kg-controls', children: [
            jsx('input', {
              className: 'kg-search',
              value: query,
              placeholder: '搜索页面…',
              onChange: event => setQuery(event.target.value),
              onKeyDown: event => {
                if (event.key === 'Enter' && query.trim() !== '') {
                  const hit = graph.nodes.find(node => `${node.title} ${node.summary}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
                  if (hit !== undefined) {
                    setInteracted(true)
                    setLocalRoot(hit.id)
                    void openPage(hit.id)
                  }
                }
                if (event.key === 'Escape') setQuery('')
              },
            }),
            jsxs('div', { className: 'kg-segment', children: [
              jsx('button', {
                type: 'button', className: local ? 'kg-on' : '', onClick: () => {
                  setLocal(previous => {
                    if (!previous) setLocalRoot(selectedId ?? hub?.id ?? null)
                    return !previous
                  })
                }, title: '只显示当前页面周围的页面',
                children: '局部',
              }),
              local && jsxs('span', { className: 'kg-depth', children: [
                jsx('button', { type: 'button', onClick: () => setDepth(value => Math.max(1, value - 1)), disabled: depth <= 1, children: '−' }),
                jsx('span', { children: `${depth} 层` }),
                jsx('button', { type: 'button', onClick: () => setDepth(value => Math.min(5, value + 1)), disabled: depth >= 5, children: '+' }),
              ] }),
            ] }),
            jsx('button', {
              type: 'button', className: 'kg-refresh', onClick: () => { void loadGraph(); void loadStatus(); if (selectedId) void openPage(selectedId) },
              title: '刷新图谱和状态', children: '刷新',
            }),
          ] }),
        ] }),
        jsxs('div', { className: 'kg-body', children: [
          jsxs('section', { className: 'kg-graph-pane', children: [
            graphError !== null
              ? jsxs('div', { className: 'kg-note-empty kg-error', children: ['图谱读取失败：', graphError, jsx('button', { type: 'button', className: 'kg-refresh', onClick: () => { void loadGraph() }, children: '重试' })] })
              : jsx(GraphView, {
                graph, selectedId: interacted ? selectedId : null,
                onSelect: id => { setInteracted(true); setSelectedId(id); if (id !== null) setLocalRoot(id) },
                query, local, localRoot, depth,
              }),
            jsxs('div', { className: 'kg-legend', children: [
              ...Object.entries(CATEGORY_COLOR).map(([category, color]) => jsxs('span', { className: 'kg-legend-item', children: [
                jsx('i', { style: { background: color } }),
                category,
              ] }, category)),
              jsxs('span', { className: 'kg-legend-item kg-muted', children: ['节点半径 ∝ √连接数'] }),
            ] }),
          ] }),
          jsxs('aside', { className: 'kg-note-pane', children: [
            jsx(NoteView, {
              page,
              loading: pageLoading,
              error: pageError,
              onWiki,
              onRefresh: () => { if (selectedId !== null) void openPage(selectedId) },
              onDeleted,
            }),
            jsx(StatusStrip, { status, error: statusError }),
          ] }),
        ] }),
        jsx('div', { className: 'kg-footnote', children: '知识库：' + (status?.root ?? '…') + ' · 此目录可直接用 Obsidian 打开' }),
        jsx(Toast, { toast }),
      ] })
    }

    /* ------------------------------------------------------------------ */
    /* Selection, context menu, and assistant save action                  */
    /* ------------------------------------------------------------------ */

    async function saveText(text, source) {
      const body = { text, source }
      return api('save', { method: 'POST', body: JSON.stringify(body) })
    }

    function isEditable(target) {
      if (!(target instanceof Element)) return false
      return target.closest('input, textarea, [contenteditable="true"], [contenteditable=""]') !== null
    }

    function inKnowledgePanel(target) {
      return target instanceof Element && target.closest('.kg-page') !== null
    }

    function userRowOf(target) {
      if (!(target instanceof Element)) return null
      let node = target
      for (let depth = 0; depth < 14 && node !== null; depth += 1) {
        const name = typeof node.className === 'string' ? node.className : ''
        if (name.includes('userRow') || name.includes('user-row')) return node
        node = node.parentElement
      }
      return null
    }

    function userRowText(row) {
      const bubble = [...row.querySelectorAll('*')].find(element => {
        const name = typeof element.className === 'string' ? element.className : ''
        return name.includes('bubble') && element.textContent.trim() !== ''
      })
      return (bubble?.textContent ?? row.textContent ?? '').trim()
    }

    function SaveLayer() {
      const [selection, setSelection] = useState(null)
      const [menu, setMenu] = useState(null)
      const [toast, showToast] = useToast()
      const selectionRef = useRef('')
      const menuRef = useRef(null)
      menuRef.current = menu

      const hide = useCallback(() => {
        setSelection(null)
        selectionRef.current = ''
      }, [])

      useEffect(() => {
        const clearMenu = () => setMenu(null)
        const onKey = event => {
          if (event.key === 'Escape') {
            setMenu(null)
            hide()
          }
        }
        const onScroll = () => {
          setMenu(null)
          hide()
        }
        window.addEventListener('keydown', onKey)
        window.addEventListener('scroll', onScroll, true)
        window.addEventListener('resize', onScroll)
        return () => {
          window.removeEventListener('keydown', onKey)
          window.removeEventListener('scroll', onScroll, true)
          window.removeEventListener('resize', onScroll)
        }
      }, [hide])

      useEffect(() => {
        const syncFromSelection = () => {
          const sel = window.getSelection()
          const text = sel?.toString().trim() ?? ''
          if (text === '' || sel === null || sel.rangeCount === 0) {
            hide()
            return
          }
          const range = sel.getRangeAt(0)
          const container = range.commonAncestorContainer instanceof Element
            ? range.commonAncestorContainer
            : range.commonAncestorContainer.parentElement
          if (container === null || inKnowledgePanel(container) || isEditable(container)) {
            hide()
            return
          }
          const rect = range.getBoundingClientRect()
          if (rect.width === 0 && rect.height === 0) {
            hide()
            return
          }
          selectionRef.current = text
          setSelection({
            x: Math.max(8, Math.min(window.innerWidth - 150, rect.left + rect.width / 2 - 64)),
            y: rect.top > 46 ? rect.top - 40 : rect.bottom + 8,
            text,
          })
          setMenu(null)
        }
        const onSelectionChange = () => {
          // selectionchange arrives before the browser finishes painting the
          // handles; defer one turn so getBoundingClientRect is settled.
          window.setTimeout(syncFromSelection, 0)
        }
        const onMouseUp = event => {
          if (event.button !== 0 || isEditable(event.target)) return
          window.setTimeout(syncFromSelection, 0)
        }
        const onPointerDown = event => {
          if (event.target instanceof Element && event.target.closest('.kg-save-float, .kg-context-menu')) return
          hide()
          setMenu(null)
        }
        document.addEventListener('selectionchange', onSelectionChange)
        document.addEventListener('mouseup', onMouseUp)
        document.addEventListener('pointerdown', onPointerDown, true)
        return () => {
          document.removeEventListener('selectionchange', onSelectionChange)
          document.removeEventListener('mouseup', onMouseUp)
          document.removeEventListener('pointerdown', onPointerDown, true)
        }
      }, [hide])

      useEffect(() => {
        const onContextMenu = event => {
          if (isEditable(event.target) || inKnowledgePanel(event.target)) return
          const selected = window.getSelection()?.toString().trim() ?? ''
          const row = userRowOf(event.target)
          const text = selected !== '' ? selected : row === null ? '' : userRowText(row)
          if (text === '') return
          event.preventDefault()
          hide()
          setMenu({
            x: Math.max(8, Math.min(window.innerWidth - 224, event.clientX)),
            y: Math.max(8, Math.min(window.innerHeight - 92, event.clientY)),
            text,
            source: selected !== '' ? 'selection' : 'user',
            label: selected !== '' ? '存入知识库（选区）' : '存入知识库（这条消息）',
          })
        }
        document.addEventListener('contextmenu', onContextMenu)
        return () => { document.removeEventListener('contextmenu', onContextMenu) }
      }, [hide])

      const commit = useCallback(async (text, source) => {
        if (text.trim() === '') return
        try {
          const result = await saveText(text, source)
          showToast(`已存入「${result.title}」 · ${result.wikiPath}`, 'ok')
          window.dispatchEvent(new CustomEvent('knowledge-graph:changed'))
        } catch (error) {
          showToast(`保存失败：${errorText(error)}`, 'error')
        } finally {
          hide()
          setMenu(null)
        }
      }, [hide, showToast])

      return jsxs(Fragment, { children: [
        selection !== null && jsxs('button', {
          type: 'button',
          className: 'kg-save-float',
          style: { left: selection.x, top: selection.y },
          onPointerDown: event => event.preventDefault(),
          onClick: () => { void commit(selection.text, 'selection') },
          children: [jsx(BookIcon, { size: 14 }), jsx('span', { children: '存入知识库' })],
        }),
        menu !== null && jsxs('div', {
          className: 'kg-context-menu',
          style: { left: menu.x, top: menu.y },
          role: 'menu',
          children: [
            jsxs('button', {
              type: 'button', role: 'menuitem',
              onPointerDown: event => event.preventDefault(),
              onClick: () => { void commit(menu.text, menu.source) },
              children: [jsx(BookIcon, { size: 14 }), menu.label],
            }),
            jsx('span', { className: 'kg-menu-hint', children: `${menu.text.length} 字` }),
          ],
        }),
        jsx(Toast, { toast }),
      ] })
    }

    function AssistantSaveAction({ messageId, useChat }) {
      const [state, setState] = useState('idle')
      const [error, setError] = useState(null)
      const text = useChat(snapshot => {
        for (const node of snapshot.nodes.values()) {
          if (node.kind !== 'assistant-step') continue
          const finalNode = node.data?.finalNode
          if (finalNode?.messageId !== messageId) continue
          const blocks = finalNode.blocks ?? node.data?.blocks ?? []
          return blocks.filter(block => block.kind === 'text').map(block => block.text).join('\n\n').trim()
        }
        return ''
      })
      if (text === '') return null
      const save = async () => {
        if (state === 'saving') return
        setState('saving')
        setError(null)
        try {
          const result = await saveText(text, 'assistant')
          setState('saved')
          window.dispatchEvent(new CustomEvent('knowledge-graph:changed'))
          window.setTimeout(() => setState('idle'), 2400)
          // The tooltip carries the exact page so the action never opens a modal.
          setError(`已存入 ${result.wikiPath}`)
        } catch (cause) {
          setState('idle')
          setError(`保存失败：${errorText(cause)}`)
        }
      }
      return jsxs('span', { className: 'kg-assistant-action', children: [
        jsx('button', {
          type: 'button',
          className: 'kg-icon-button',
          title: error ?? (state === 'saved' ? '已存入知识库' : '存入知识库'),
          'aria-label': '存入知识库',
          disabled: state === 'saving',
          onClick: save,
          children: state === 'saving' ? '…' : jsx(BookIcon, { size: 15 }),
        }),
        error !== null && jsx('span', {
          className: `kg-assistant-status ${error.startsWith('保存失败') ? 'kg-error' : ''}`,
          title: error,
          children: error.startsWith('保存失败') ? '失败' : '已存',
        }),
      ] })
    }

    /* ------------------------------------------------------------------ */
    /* Styles and registration                                             */
    /* ------------------------------------------------------------------ */

    const CSS = `
.kg-page{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary,#1f2328);background:var(--dsw-alias-bg-base,#fff);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}
.kg-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 18px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,#e3e6eb);flex-wrap:wrap}
.kg-heading{display:flex;align-items:center;gap:10px;min-width:0}
.kg-mark{width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#5b8def;background:color-mix(in srgb,#5b8def 12%,transparent);border:1px solid color-mix(in srgb,#5b8def 24%,transparent)}
.kg-title{font-size:17px;font-weight:650;line-height:22px}
.kg-subtitle{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#5c6570);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:520px}
.kg-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.kg-search{height:30px;width:190px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#e3e6eb);background:var(--dsw-alias-bg-layer-1,#f7f8fa);color:inherit;padding:0 10px;font:inherit;font-size:12px;outline:none}
.kg-search:focus{border-color:#5b8def;box-shadow:0 0 0 2px color-mix(in srgb,#5b8def 16%,transparent)}
.kg-segment{display:flex;align-items:center;height:30px;border:1px solid var(--dsw-alias-border-l2,#e3e6eb);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#f7f8fa);padding:2px}
.kg-segment>button,.kg-refresh{height:24px;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#5c6570);border-radius:6px;font:inherit;font-size:12px;padding:0 10px;cursor:pointer}
.kg-segment>button.kg-on{background:var(--dsw-alias-bg-base,#fff);color:#5b8def;box-shadow:0 1px 3px rgba(15,23,42,.12)}
.kg-depth{display:inline-flex;align-items:center;gap:2px;margin-left:2px;color:var(--dsw-alias-label-secondary,#5c6570);font-size:12px}
.kg-depth button{width:20px;height:20px;border:0;border-radius:5px;background:transparent;color:inherit;cursor:pointer;font:inherit;line-height:1}
.kg-depth button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(31,35,40,.06))}
.kg-depth button:disabled{opacity:.35;cursor:default}
.kg-refresh{border:1px solid var(--dsw-alias-border-l2,#e3e6eb);padding:0 10px;height:30px;background:var(--dsw-alias-bg-layer-1,#f7f8fa)}
.kg-refresh:hover{color:var(--dsw-alias-label-primary,#1f2328);border-color:var(--dsw-alias-border-l4,#c9ced8)}
.kg-body{display:flex;flex:1;min-height:0}
.kg-graph-pane{position:relative;flex:1.55;min-width:0;display:flex;flex-direction:column;border-right:1px solid var(--dsw-alias-border-l2,#e3e6eb);background:radial-gradient(circle at 50% 40%,color-mix(in srgb,#5b8def 5%,transparent),transparent 62%)}
.kg-graph-wrap{position:relative;flex:1;min-height:260px;overflow:hidden}
.kg-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;border-radius:0}
.kg-graph-hint{position:absolute;left:12px;bottom:10px;font-size:10px;color:var(--dsw-alias-label-tertiary,#8b93a1);pointer-events:none;background:color-mix(in srgb,var(--dsw-alias-bg-base,#fff) 78%,transparent);padding:2px 6px;border-radius:5px}
.kg-tooltip{position:fixed;z-index:1200;width:264px;padding:9px 11px;border-radius:9px;background:var(--dsw-alias-bg-layer-1,#f7f8fa);border:1px solid var(--dsw-alias-border-l2,#e3e6eb);box-shadow:0 8px 28px rgba(15,23,42,.16);pointer-events:none}
.kg-tooltip strong{display:block;font-size:12px;line-height:17px;margin-bottom:2px}
.kg-tooltip-meta{font-size:10px;color:var(--dsw-alias-label-secondary,#5c6570)}
.kg-tooltip p{margin:5px 0 0;font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary,#5c6570);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.kg-legend{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:7px 12px;border-top:1px solid var(--dsw-alias-border-l2,#e3e6eb);font-size:10.5px;color:var(--dsw-alias-label-secondary,#5c6570)}
.kg-legend-item{display:inline-flex;align-items:center;gap:5px}
.kg-legend-item i{width:7px;height:7px;border-radius:50%;display:inline-block}
.kg-muted{color:var(--dsw-alias-label-tertiary,#8b93a1)}
.kg-note-pane{flex:1;min-width:300px;max-width:520px;display:flex;flex-direction:column;min-height:0;background:var(--dsw-alias-bg-base,#fff)}
.kg-note-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:28px;text-align:center;color:var(--dsw-alias-label-secondary,#5c6570);font-size:13px}
.kg-note-empty p{margin:0;max-width:280px;line-height:20px}
.kg-note-empty.kg-error{color:#c0392b}
.kg-note-head{padding:16px 18px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,#e3e6eb)}
.kg-note-title{font-size:19px;font-weight:680;line-height:26px;overflow-wrap:anywhere}
.kg-note-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:7px}
.kg-note-actions{display:flex;align-items:center;gap:2px;margin-left:auto;flex:none}
.kg-chip{display:inline-flex;align-items:center;height:20px;padding:0 7px;border:1px solid var(--dsw-alias-border-l2,#e3e6eb);border-radius:999px;font-size:10.5px;line-height:1;color:var(--dsw-alias-label-secondary,#5c6570);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kg-path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:var(--dsw-alias-label-tertiary,#8b93a1);max-width:240px}
.kg-note-summary{margin:9px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#5c6570)}
.kg-danger{color:#b0392e}
.kg-icon-button.kg-danger:hover:enabled{color:#c0392b;background:color-mix(in srgb,#c0392b 9%,transparent)}
.kg-delete-confirm{display:flex;flex-direction:column;gap:8px;margin-top:10px;padding:9px 10px;border:1px solid color-mix(in srgb,#c0392b 38%,var(--dsw-alias-border-l2,#e3e6eb));border-radius:8px;background:color-mix(in srgb,#c0392b 5%,var(--dsw-alias-bg-layer-1,#f7f8fa));font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#5c6570)}
.kg-delete-actions{display:flex;align-items:center;gap:6px}
.kg-danger-button,.kg-cancel-button{height:25px;border-radius:6px;border:1px solid transparent;font:inherit;font-size:11px;padding:0 9px;cursor:pointer}
.kg-danger-button{border-color:#b0392e;background:#b0392e;color:#fff}
.kg-danger-button:hover:enabled{background:#92291f}
.kg-danger-button:disabled{opacity:.6;cursor:default}
.kg-cancel-button{border-color:var(--dsw-alias-border-l2,#e3e6eb);background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-secondary,#5c6570)}
.kg-cancel-button:hover:enabled{color:var(--dsw-alias-label-primary,#1f2328)}
.kg-cancel-button:disabled{opacity:.55;cursor:default}
.kg-note-scroll{flex:1;min-height:0;overflow:auto;padding:8px 18px 20px;overscroll-behavior:contain}
.kg-prose{font-size:13px;line-height:1.72;overflow-wrap:anywhere}
.kg-prose h1{font-size:21px;margin:14px 0 8px;border-bottom:1px solid var(--dsw-alias-border-l2,#e3e6eb);padding-bottom:7px}
.kg-prose h2{font-size:15px;margin:20px 0 7px;color:var(--dsw-alias-label-primary,#1f2328)}
.kg-prose h3{font-size:13.5px;margin:15px 0 5px}
.kg-prose p{margin:6px 0}
.kg-prose ul{margin:5px 0;padding-left:20px}
.kg-prose li{margin:3px 0}
.kg-prose blockquote{margin:8px 0;padding:5px 12px;border-left:2px solid #5b8def55;color:var(--dsw-alias-label-secondary,#5c6570)}
.kg-prose code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em;background:var(--dsw-alias-bg-layer-2,#eef0f4);border-radius:4px;padding:1px 4px}
.kg-prose pre.kg-code{background:var(--dsw-alias-bg-layer-2,#eef0f4);border-radius:8px;padding:10px;overflow:auto}
.kg-prose pre.kg-code code{background:transparent;padding:0}
.kg-prose hr{border:0;border-top:1px solid var(--dsw-alias-border-l2,#e3e6eb);margin:16px 0}
.kg-wikilink{border:0;background:transparent;color:#5b8def;font:inherit;padding:0;cursor:pointer;text-decoration:underline;text-decoration-color:#5b8def55;text-underline-offset:2px}
.kg-wikilink:hover{text-decoration-color:#5b8def}
.kg-icon-button{width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#5c6570);font:inherit;font-size:14px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}
.kg-icon-button:hover:enabled{background:var(--dsw-alias-interactive-bg-hover,rgba(31,35,40,.06));color:var(--dsw-alias-label-primary,#1f2328)}
.kg-icon-button:disabled{cursor:default;opacity:.65}
.kg-status{border-top:1px solid var(--dsw-alias-border-l2,#e3e6eb);padding:9px 14px 10px;font-size:11px;line-height:16px;background:var(--dsw-alias-bg-layer-1,#f7f8fa)}
.kg-status-error{color:#c0392b}
.kg-status-line{display:flex;align-items:center;gap:6px;min-width:0}
.kg-status-spacer{flex:1}
.kg-dot{width:6px;height:6px;border-radius:50%;display:inline-block;flex:none;background:#39a67a}
.kg-dot-busy{background:#d99545;box-shadow:0 0 0 3px #d9954522;animation:kg-pulse 1.2s ease-in-out infinite}
.kg-dot-bad{background:#c0392b}
@keyframes kg-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.kg-recent{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:4px;color:var(--dsw-alias-label-secondary,#5c6570);min-width:0}
.kg-recent-label{color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:10px}
.kg-recent-item{display:inline-flex;align-items:center;gap:4px;max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}
.kg-footnote{padding:5px 14px;border-top:1px solid var(--dsw-alias-border-l2,#e3e6eb);font-size:10px;color:var(--dsw-alias-label-tertiary,#8b93a1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kg-save-float{position:fixed;z-index:1300;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;border:1px solid color-mix(in srgb,#5b8def 40%,transparent);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:#315fc4;font:inherit;font-size:12px;font-weight:550;box-shadow:0 6px 20px rgba(15,23,42,.18);cursor:pointer;animation:kg-in .12s ease-out}
.kg-save-float:hover{background:color-mix(in srgb,#5b8def 8%,var(--dsw-alias-bg-layer-1,#fff))}
.kg-context-menu{position:fixed;z-index:1350;width:216px;padding:5px;border-radius:9px;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l2,#e3e6eb);box-shadow:0 10px 32px rgba(15,23,42,.2);animation:kg-in .1s ease-out}
.kg-context-menu button{width:100%;display:flex;align-items:center;gap:8px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;text-align:left;padding:7px 8px;cursor:pointer}
.kg-context-menu button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(31,35,40,.07))}
.kg-menu-hint{display:block;padding:2px 8px 3px;font-size:10px;color:var(--dsw-alias-label-tertiary,#8b93a1)}
.kg-toast{position:fixed;z-index:1400;left:50%;bottom:26px;transform:translateX(-50%);max-width:min(560px,calc(100vw - 40px));padding:9px 14px;border-radius:9px;background:#1f2937;color:#fff;font-size:12px;line-height:17px;box-shadow:0 10px 30px rgba(15,23,42,.24);animation:kg-in .14s ease-out;overflow-wrap:anywhere}
.kg-toast-error{background:#a52a2a}
.kg-assistant-action{display:inline-flex;align-items:center;gap:2px;margin-left:1px}
.kg-assistant-status{font-size:10px;color:var(--dsw-alias-label-tertiary,#8b93a1);white-space:nowrap}
.kg-assistant-status.kg-error{color:#c0392b}
.kg-error{color:#c0392b}
@keyframes kg-in{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
@media (max-width:900px){.kg-body{flex-direction:column}.kg-graph-pane{flex:1.2;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l2,#e3e6eb)}.kg-note-pane{max-width:none;flex:1;min-height:220px}.kg-search{width:140px}}
`

    function apply(ctx) {
      const style = document.createElement('style')
      style.dataset.plugin = 'knowledge-graph'
      style.dataset.pluginCss = 'knowledge-graph/main.css'
      style.textContent = CSS
      document.head.appendChild(style)
      ctx.effect(() => () => { style.remove() }, 'knowledge-graph: styles')

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: SIDEBAR_ID,
      }, KnowledgePanel))

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: SIDEBAR_ID,
        order: 2,
        label: () => '知识图谱',
      }, () => jsx(GraphIcon, { size: 17 })))

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'knowledge-graph-save',
        order: 80,
      }, SaveLayer))

      ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
        name: 'conversation.chat.assistant-actions',
        id: 'knowledge-graph-save',
        order: 30,
      }, AssistantSaveAction))
    }

    return { name: 'knowledge-graph', inject: ['slots'], apply }
  },
})
