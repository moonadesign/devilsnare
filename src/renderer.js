const g = document.getElementById.bind(document)

agGrid.ModuleRegistry.registerModules([agGrid.AllCommunityModule, agGrid.AllEnterpriseModule])

const theme = () =>
  agGrid.themeQuartz.withParams({
    backgroundColor: 'var(--color-lightest)',
    borderColor: 'var(--color-light)',
    foregroundColor: 'var(--color-darkest)',
    headerBackgroundColor: 'var(--color-lighter)',
    headerTextColor: 'var(--color-darker)',
    rowBorder: { color: 'var(--color-light)', style: 'solid', width: 1 },
    rowHoverColor: 'var(--color-lighter)',
  })

const formatSize = kb => {
  if (!kb) return ''
  if (kb < 1024) return `${kb} KB`
  if (kb < 1048576) return `${Math.round(kb / 1024)} MB`
  return `${(kb / 1048576).toFixed(1)} GB`
}

const relativeTime = dateStr => {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

const daysSince = dateStr => dateStr ? Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000) : Infinity

const getStatus = c => {
  if (!c) return ''
  if (c.dirty) return '🔴 Uncommitted changes'
  if (c.behind && c.ahead) return '🟡 Ahead and behind remote'
  if (c.behind) return '🟡 Behind remote'
  if (c.ahead) return '🟡 Unpushed commits'
  if (c.branch === 'HEAD') return '⚫️ Detached HEAD'
  if (!c.hasRemote) return '🔴 No remote'
  return '🟢 Clean'
}

const getPrimaryAction = status => {
  if (status.includes('Uncommitted changes')) return 'Review'
  if (status.includes('Behind remote')) return 'Pull'
  if (status.includes('Ahead and behind remote')) return 'Pull'
  if (status.includes('Unpushed commits')) return 'Push'
  if (status.includes('Detached HEAD')) return 'Checkout main'
  if (status.includes('No remote')) return 'Add remote'
  if (status.includes('Clean')) return 'Continue'
  return ''
}

const actionCellRenderer = p => {
  if (!p.data) return ''

  const wrap = document.createElement('div')
  wrap.className = 'action-wrap'

  const more = document.createElement('button')
  more.className = 'button button-icon action-menu'
  more.textContent = '⋯'
  more.onclick = e => { e.stopPropagation(); showMenu(e, p.data) }
  wrap.appendChild(more)

  const serve = document.createElement('button')
  serve.className = 'button button-icon'
  if (p.data.viewMethod) {
    const isElectron = p.data.viewMethod === 'npm start'
    serve.innerHTML = isElectron ? '<i class="fa-regular fa-display"></i>' : '<i class="fa-regular fa-browser"></i>'
    serve.onclick = async e => {
      e.stopPropagation()
      const status = await window.api.serveStatus(p.data.path)
      if (status.running) {
        await window.api.serveStop(p.data.path)
        serve.innerHTML = isElectron ? '<i class="fa-regular fa-display"></i>' : '<i class="fa-regular fa-browser"></i>'
      } else {
        serve.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'
        await window.api.serveStart(p.data.name, p.data.path)
        serve.innerHTML = isElectron ? '<i class="fa-solid fa-display"></i>' : '<i class="fa-solid fa-browser"></i>'
      }
    }
    window.api.serveStatus(p.data.path).then(s => {
      if (s.running) serve.innerHTML = isElectron ? '<i class="fa-solid fa-display"></i>' : '<i class="fa-solid fa-browser"></i>'
    })
  } else {
    serve.innerHTML = '<i class="fa-regular fa-ban"></i>'
    serve.disabled = true
  }
  wrap.appendChild(serve)

  const resume = document.createElement('button')
  resume.className = 'button action-primary'
  resume.textContent = 'Resume'
  resume.disabled = !sessionsReady
  resume.onclick = e => { e.stopPropagation(); window.api.runAction('Open in Editor', p.data.path) }
  wrap.appendChild(resume)

  return wrap
}

let currentDrawer = null

const programmatic = async (label, action, cwd) => {
  const confirmed = await window.api.confirm(`${label} in ${cwd.split('/').pop()}?`)
  if (!confirmed) return
  const result = await window.api.runAction(action, cwd)
  if (result) alert(result)
}

const renderDrawerActions = (commands, prompts, contextual) => {
  const actionsEl = g('drawer-actions')
  actionsEl.innerHTML = ''

  const makeCol = (title, items) => {
    const col = document.createElement('div')
    col.className = 'action-column'
    const h = document.createElement('strong')
    h.textContent = title
    col.appendChild(h)
    for (const [label, handler] of items) {
      const btn = document.createElement('button')
      btn.className = 'button outline'
      btn.textContent = label
      btn.onclick = handler
      col.appendChild(btn)
    }
    return col
  }

  if (commands.length) actionsEl.appendChild(makeCol('Commands', commands))
  if (prompts.length) actionsEl.appendChild(makeCol('Prompts', prompts))
  if (contextual.length) actionsEl.appendChild(makeCol('Contextual', contextual))
}

const runAgent = (prompt, cwd) => {
  agentOutput = ''
  g('drawer-body').innerHTML = ''
  startClock()
  window.api.runAgent(prompt, cwd)
}

const openDrawer = async (title, status, prompt, cwd, commands, prompts, contextual = []) => {
  const drawer = g('drawer')
  const cacheKey = `${cwd}::${status}`
  currentDrawer = { cacheKey, cwd, prompt, status }

  g('drawer-title').textContent = title
  g('drawer-status').textContent = status
  g('drawer-editor').onclick = () => window.api.runAction('Open in Editor', cwd)
  const hasRemote = allRows.find(r => r.id === cwd)?.github !== 'no remote'
  g('drawer-github').disabled = !hasRemote
  g('drawer-github').onclick = hasRemote ? () => window.api.runAction('Open on GitHub', cwd) : null
  drawer.hidden = false

  const cached = await window.api.getReview(cacheKey)
  if (cached) {
    agentOutput = cached
    g('drawer-body').innerHTML = marked.parse(cached)
    g('drawer-status').textContent = status + ' · Cached'
    renderDrawerActions(commands, [['Redo', () => runAgent(prompt, cwd)], ...prompts], contextual)
  } else {
    agentOutput = ''
    g('drawer-body').innerHTML = ''
    renderDrawerActions(commands, prompts, contextual)
    startClock()
    window.api.runAgent(prompt, cwd)
  }
}

const closeDrawer = () => {
  g('drawer').hidden = true
  stopClock()
  window.api.stopAgent()
}

const reviewPrompt = data => `You are reviewing the git repo at ${data.path}.

Run git diff and git log --oneline -5 to understand context.

Then tell me:
1. **What was I doing?** — Infer the intent behind these changes. What problem was I solving or feature was I building? Don't just list files.
2. **Is anything risky?** — Secrets, broken imports, half-finished logic, debug code left in, files that shouldn't be tracked.
3. **What should I do next?** — One specific next step for this repo right now.

Do NOT suggest git commands. I know how to commit. Focus on understanding and risk. Be concise.`

const continuePrompt = data => `You are reviewing the git repo at ${data.path}.

Read the README, TODO, PLAN, or CLAUDE.md if they exist. Check git log --oneline -10 and ls.

Then tell me:
1. **What is this?** — One sentence on what this project does.
2. **Where did I leave off?** — What was the last meaningful thing I did here based on recent commits and file state.
3. **What's the highest-value next step?** — One specific, actionable thing to work on. Reference actual files or features, not generic advice.

Do NOT give multiple options. Pick the best one. Be concise.`

const formatTokens = t => {
  if (!t) return ''
  if (t > 1000000) return `${(t / 1000000).toFixed(1)}M tokens`
  if (t > 1000) return `${Math.round(t / 1000)}k tokens`
  return `${t} tokens`
}

const openActionSheet = data => {
  const drawer = g('drawer')
  g('drawer-title').textContent = data.name
  g('drawer-status').textContent = data.status
  g('drawer-editor').onclick = () => window.api.runAction('Open in Editor', data.path)
  const hasRemote = data.github !== 'no remote'
  g('drawer-github').disabled = !hasRemote
  g('drawer-github').onclick = hasRemote ? () => window.api.runAction('Open on GitHub', data.path) : null
  g('drawer-body').innerHTML = ''
  drawer.hidden = false
  currentDrawer = { cwd: data.path, status: data.status }

  const body = g('drawer-body')
  const session = sessions.matched?.[data.path]
  if (session) {
    const box = document.createElement('div')
    box.className = 'session-box'
    const info = document.createElement('div')
    info.className = 'session-info'
    const harness = session.harness === 'claude' ? 'Claude' : 'Codex'
    const name = session.title || session.topic || session.id.slice(0, 8)
    info.innerHTML = `<strong>${harness}</strong> ${name} <span class="session-meta">${formatTokens(session.tokens)} ${relativeTime(session.date)}</span>`
    box.appendChild(info)
    const btn = document.createElement('button')
    btn.className = 'button primary'
    btn.textContent = 'Resume'
    btn.onclick = () => window.api.runAction('Open in Editor', data.path)
    box.appendChild(btn)
    body.appendChild(box)
  }

  const primary = getPrimaryAction(data.status)
  if (primary === 'Review' || primary === 'Continue') {
    const btn = document.createElement('button')
    btn.className = 'button outline'
    btn.textContent = primary
    btn.onclick = () => handleAction(primary, data)
    body.appendChild(btn)
  }

  renderDrawerActions(
    [['Open in Terminal', () => window.api.runAction('Open in Terminal', data.path)],
     ['Pull', () => programmatic('Pull', 'Pull', data.path)],
     ['Push', () => programmatic('Push', 'Push', data.path)]],
    [['Commit', () => window.api.openInteractive(`Review the uncommitted changes in this repo and help me create a good commit. Show me the diff first and suggest a commit message.`, data.path)],
     ['Add remote', () => window.api.openInteractive(`This repo at ${data.path} has no remote. Help me create a GitHub repo and add it as origin.`, data.path)]],
    [],
  )
}

const handleAction = (action, data) => {
  if (action === 'Review') return openDrawer(
    data.name, `${data.changedFiles} uncommitted changes`, reviewPrompt(data), data.path,
    [['Open in Terminal', () => window.api.runAction('Open in Terminal', data.path)],
     ['Pull', () => programmatic('Pull', 'Pull', data.path)],
     ['Push', () => programmatic('Push', 'Push', data.path)]],
    [['Commit', () => window.api.openInteractive(`Review the uncommitted changes in this repo and help me create a good commit. Show me the diff first and suggest a commit message.`, data.path)],
     ['Add remote', () => window.api.openInteractive(`This repo at ${data.path} has no remote. Help me create a GitHub repo and add it as origin.`, data.path)]],
  )
  if (action === 'Continue') return openDrawer(
    data.name, '🟢 Clean', continuePrompt(data), data.path,
    [['Open in Terminal', () => window.api.runAction('Open in Terminal', data.path)]],
    [['Start a task', () => window.api.openInteractive(`I want to continue working on this project. What should I focus on?`, data.path)]],
  )
  window.api.runAction(action, data.path)
}

const showMenu = (e, data) => {
  const hasRemote = data.github !== 'no remote'
  const items = ['Open in Terminal', 'Open in Editor']
  if (hasRemote) items.push('Open on GitHub')
  items.push('—', 'Show changes', 'Stash', 'Commit', '—', 'Pull', 'Push', 'Checkout main')
  window.api.showMenu(items, data.path)
}

const flattenPaths = paths => {
  const rows = []
  for (const item of paths) {
    rows.push(makeRow(item, [item.name]))
    if (item.children?.length) {
      for (const child of item.children) rows.push(makeRow(child, [item.name, child.name]))
    }
  }
  return rows
}

const makeRow = (item, treePath) => {
  const c = item.checks || {}
  return {
    branch: c.branch === 'HEAD' ? 'detached' : (c.branch || ''),
    changedFiles: c.dirty ? c.changedFiles : '',
    children: item.children?.length || '',
    github: !c.hasRemote ? 'no remote'
      : (c.ahead || c.behind) ? [c.ahead && `${c.ahead}↑`, c.behind && `${c.behind}↓`].filter(Boolean).join(' ')
      : 'synced',
    id: item.path,
    lastCommit: c.lastCommit || '',
    lastCommitDisplay: relativeTime(c.lastCommit),
    lastModified: c.lastModified || '',
    lastModifiedDisplay: relativeTime(c.lastModified),
    name: item.name,
    nodeModules: c.nodeModulesKB ? `${formatSize(c.nodeModulesKB)} (${Math.round(c.nodeModulesKB / c.diskKB * 100)}%)` : '',
    path: item.path,
    status: getStatus(c),
    treePath,
    type: item.type,
    viewMethod: c.viewMethod || null,
  }
}

const grid = agGrid.createGrid(g('grid'), {
  autoGroupColumnDef: {
    cellRendererParams: { suppressCount: true },
    field: 'name',
    headerName: 'Name',
    minWidth: 280,
  },
  autoSizeStrategy: { type: 'fitCellContents', scaleUpToFitGridWidth: true },
  columnDefs: [
    {
      cellRenderer: p => {
        if (!p.data) return ''
        const star = document.createElement('i')
        star.className = favorites.includes(p.data.id) ? 'fa-solid fa-star' : 'fa-regular fa-star'
        star.className += ' star'
        star.onclick = async () => {
          favorites = await window.api.toggleFavorite(p.data.id)
          grid.refreshCells({ force: true })
          renderViews()
        }
        return star
      },
      headerName: '',
      pinned: 'left',
      sortable: false,
      suppressSizeToFit: true,
      width: 40,
    },
    { field: 'type', headerName: 'Type', hide: true },
    { field: 'branch', headerName: 'Branch', hide: true },
    { field: 'children', headerName: 'Children', hide: true },
    { field: 'nodeModules', headerName: 'node_modules', hide: true },
    { field: 'lastCommitDisplay', headerName: 'Committed', hide: true },
    {
      comparator: (a, b, nodeA, nodeB) => {
        const da = nodeA.data?.lastModified || ''
        const db = nodeB.data?.lastModified || ''
        return da < db ? -1 : da > db ? 1 : 0
      },
      field: 'lastModifiedDisplay',
      headerName: 'Modified',
      sort: 'desc',
    },
    {
      cellRenderer: p => {
        if (!p.data) return ''
        const s = sessions.matched?.[p.data.path]
        if (!s) return ''
        return `${s.harness === 'claude' ? 'Claude' : 'Codex'} ${relativeTime(s.date)}`
      },
      headerName: 'Inference',
    },
    { field: 'status', headerName: 'Status' },
    { field: 'github', headerName: 'GitHub' },
    { cellRenderer: actionCellRenderer, headerName: '', sortable: false, suppressSizeToFit: true },
  ],
  defaultColDef: { resizable: false, sortable: true },
  enableCellTextSelection: true,
  getDataPath: d => d.treePath,
  onRowClicked: p => {
    if (!p.data) return
    openActionSheet(p.data)
  },
  getRowId: p => p.data.id,
  getRowStyle: p => {
    if (!p.data) return
    const commit = daysSince(p.data.lastCommit)
    const modified = daysSince(p.data.lastModified)
    if (commit > 365) return { color: 'var(--color-light)' }
    if (commit > 60 && modified > 60) return { color: 'var(--color-half)' }
  },
  groupDefaultExpanded: 0,
  rowData: [],
  theme: theme(),
  treeData: true,
})

let allRows = []
let activeView = 'all'
let favorites = []
let scanning = false
let sessionsReady = false
let sessions = { matched: {}, unmatched: [] }

const setView = view => {
  activeView = view
  let filtered = allRows
  if (view === 'favorites') filtered = allRows.filter(r => favorites.includes(r.id))
  else if (view === 'clean') filtered = allRows.filter(r => r.status.includes('Clean'))
  else if (view === 'last30') filtered = allRows.filter(r => daysSince(r.lastCommit) <= 30 || daysSince(r.lastModified) <= 30)
  else if (view === 'last60') filtered = allRows.filter(r => daysSince(r.lastCommit) <= 60 || daysSince(r.lastModified) <= 60)
  grid.setGridOption('rowData', filtered)
  grid.forEachNode(n => { if (n.key === 'pando') n.setExpanded(true) })
  renderViews()
}

const renderViews = () => {
  const viewsEl = g('views')
  viewsEl.innerHTML = ''
  const clean = allRows.filter(r => r.status.includes('Clean')).length
  const pct = allRows.length ? Math.round(clean / allRows.length * 100) : 0
  const last30 = allRows.filter(r => daysSince(r.lastCommit) <= 30 || daysSince(r.lastModified) <= 30).length
  const last60 = allRows.filter(r => daysSince(r.lastCommit) <= 60 || daysSince(r.lastModified) <= 60).length

  for (const [id, label, count] of [
    ['all', 'All repos', allRows.length],
    ['favorites', 'Favorites', favorites.length],
    ['last30', 'Last 30d', last30],
    ['last60', 'Last 60d', last60],
    ['clean', 'Clean', `${pct}%`],
  ]) {
    const el = document.createElement('div')
    el.className = `view${activeView === id ? ' active' : ''}`
    el.onclick = () => setView(id)
    el.appendChild(document.createTextNode(label + ' '))
    const countEl = document.createElement('span')
    countEl.className = 'view-count'
    countEl.textContent = count
    el.appendChild(countEl)
    viewsEl.appendChild(el)
  }
}

const renderRoots = async () => {
  const config = await window.api.getConfig()
  const roots = config.roots || []
  const list = g('roots-list')
  list.innerHTML = ''
  for (const root of roots) {
    const item = document.createElement('div')
    item.className = 'root-item'
    const span = document.createElement('span')
    span.textContent = root
    item.appendChild(span)
    const rm = document.createElement('button')
    rm.className = 'button button-icon'
    rm.innerHTML = '<i class="fa-regular fa-trash"></i>'
    rm.onclick = async () => {
      roots.splice(roots.indexOf(root), 1)
      await window.api.saveConfig({ ...config, roots })
      renderRoots()
    }
    item.appendChild(rm)
    list.appendChild(item)
  }
}

const init = async () => {
  favorites = await window.api.getFavorites()
  const config = await window.api.getConfig()
  if (!config.roots?.length) {
    await renderRoots()
    g('settings').showModal()
    return
  }
  const cached = await window.api.getCache()
  if (cached?.paths) allRows = flattenPaths(cached.paths)
  sessions = await window.api.getSessions()
  renderViews()
  setView('all')
  scanning = true
  g('spinner').hidden = false
  renderViews()
  const fresh = await window.api.scan()
  allRows = flattenPaths(fresh)
  scanning = false
  setView(activeView)
  g('spinner').classList.replace('fa-spin', 'fa-spin-reverse')
  window.api.scanSessions(allRows.map(r => r.path)).then(s => {
    sessions = s
    sessionsReady = true
    grid.refreshCells({ force: true })
    g('spinner').hidden = true
    g('spinner').classList.replace('fa-spin-reverse', 'fa-spin')
  })
}

document.querySelectorAll('#mode-select [data-mode]').forEach(btn =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('#mode-select [data-mode]').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    window.api.setTheme(btn.dataset.mode)
  })
)

document.querySelectorAll('#harness-select [data-harness]').forEach(btn =>
  btn.addEventListener('click', async () => {
    document.querySelectorAll('#harness-select [data-harness]').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    const config = await window.api.getConfig()
    await window.api.saveConfig({ ...config, harness: btn.dataset.harness })
  })
)

g('btn-settings').addEventListener('click', async () => {
  await renderRoots()
  g('settings').showModal()
})

g('btn-add-root').addEventListener('click', async () => {
  const folder = await window.api.chooseFolder()
  if (!folder) return
  const config = await window.api.getConfig()
  const roots = config.roots || []
  if (!roots.includes(folder)) {
    roots.push(folder)
    await window.api.saveConfig({ ...config, roots })
    renderRoots()
  }
})

g('btn-close-settings').addEventListener('click', () => {
  g('settings').close()
  init()
})

let agentOutput = ''

g('drawer-close').addEventListener('click', closeDrawer)

let renderTimer = null
let clockTimer = null
let clockStart = 0

const startClock = () => {
  clockStart = Date.now()
  const body = g('drawer-body')
  body.innerHTML = ''
  const waiting = document.createElement('div')
  waiting.id = 'waiting'
  waiting.textContent = 'Asking your robot to review this… 0s'
  body.appendChild(waiting)
  clockTimer = setInterval(() => {
    const el = g('waiting')
    if (!el) return stopClock()
    const s = Math.floor((Date.now() - clockStart) / 1000)
    const min = Math.floor(s / 60)
    const sec = s % 60
    el.textContent = `Asking your robot to review this… ${min ? `${min}m ${sec}s` : `${sec}s`}`
  }, 1000)
}

const stopClock = () => {
  clearInterval(clockTimer)
  clockTimer = null
}

window.api.onAgentChunk(chunk => {
  if (!agentOutput) stopClock()
  agentOutput += chunk
  clearTimeout(renderTimer)
  renderTimer = setTimeout(() => {
    const body = g('drawer-body')
    const cleaned = agentOutput.replace(/^[^#]*?(#)/s, '$1')
    const s = Math.floor((Date.now() - clockStart) / 1000)
    const min = Math.floor(s / 60)
    const sec = s % 60
    const time = min ? `${min}m ${sec}s` : `${sec}s`
    body.innerHTML = marked.parse(cleaned + `\n\n---\n\n*${time}*`)
    body.scrollTop = body.scrollHeight
  }, 300)
})

window.api.onAgentResult(result => {
  if (result && result.length > agentOutput.length) agentOutput = result
})

window.api.onAgentDone(async code => {
  clearTimeout(renderTimer)
  const body = g('drawer-body')
  const cleaned = agentOutput.replace(/^[^#]*?(#)/s, '$1')
  g('drawer-status').textContent = currentDrawer?.status || ''

  if (code !== 0 || !currentDrawer || !agentOutput) {
    stopClock()
    const s = Math.floor((Date.now() - clockStart) / 1000)
    const min = Math.floor(s / 60)
    const sec = s % 60
    const time = min ? `${min}m ${sec}s` : `${sec}s`
    body.innerHTML = marked.parse(cleaned + `\n\n---\n\n*Exited (${code}) in ${time}*`)
    body.scrollTop = body.scrollHeight
    return
  }

  window.api.saveReview(currentDrawer.cacheKey, agentOutput)
  body.innerHTML = marked.parse(cleaned + '\n\n---\n\n*Generating actions…*')
  body.scrollTop = body.scrollHeight

  await new Promise(r => setTimeout(r, 500))
  const { actions } = await window.api.getActions(currentDrawer.cwd)

  stopClock()
  const s = Math.floor((Date.now() - clockStart) / 1000)
  const min = Math.floor(s / 60)
  const sec = s % 60
  const time = min ? `${min}m ${sec}s` : `${sec}s`

  body.innerHTML = marked.parse(cleaned + '\n\n---\n\n## Contextual actions')
  if (actions.length) {
    for (const a of actions) {
      const item = document.createElement('div')
      item.className = 'contextual-action'
      const desc = document.createElement('p')
      desc.textContent = a.description
      item.appendChild(desc)
      const btn = document.createElement('button')
      btn.className = 'button outline'
      btn.textContent = a.label
      btn.onclick = () => window.api.openInteractive(a.prompt, currentDrawer.cwd)
      item.appendChild(btn)
      body.appendChild(item)
    }
  }
  const footer = document.createElement('p')
  footer.className = 'drawer-footer'
  footer.innerHTML = `<em>Done in ${time}</em>`
  body.appendChild(footer)
  body.scrollTop = body.scrollHeight
  g('drawer-status').textContent = currentDrawer.status
})

window.api.onActionResult((action, cwd) => handleAction(action, { path: cwd }))
init()
