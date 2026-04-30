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
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
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
  const action = getPrimaryAction(p.data.status)
  if (!action) return ''

  const wrap = document.createElement('div')
  wrap.style.cssText = 'align-items: center; display: flex; gap: 0.5rem'

  const more = document.createElement('button')
  more.className = 'button button-icon compact action-menu'
  more.textContent = '⋯'
  more.onclick = e => showMenu(e, p.data)
  wrap.appendChild(more)

  const btn = document.createElement('button')
  btn.className = 'button compact action-primary'
  btn.textContent = action
  btn.onclick = () => handleAction(action, p.data)
  wrap.appendChild(btn)

  return wrap
}

const handleAction = (action, data) => {
  if (action === 'Review') return alert(`${data.name}: ${data.changedFiles} uncommitted changes\n\nFull review coming in next pass.`)
  if (action === 'Continue') return window.api.runAction('Open in Editor', data.path)
  window.api.runAction(action, data.path)
}

const showMenu = (e, data) => {
  window.api.showMenu(['Open in Terminal', 'Open in Editor', 'Open on GitHub', '—',
    'Show changes', 'Stash', 'Commit', '—', 'Pull', 'Push', 'Checkout main'], data.path)
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
        star.style.cssText = 'cursor: pointer; color: var(--color-half)'
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
    { field: 'lastCommitDisplay', headerName: 'Committed' },
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
    { field: 'status', headerName: 'Status' },
    { field: 'github', headerName: 'GitHub' },
    { cellRenderer: actionCellRenderer, headerName: '', sortable: false, suppressSizeToFit: true },
  ],
  defaultColDef: { resizable: false, sortable: true },
  enableCellTextSelection: true,
  getDataPath: d => d.treePath,
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
  renderViews()
  setView('all')
  scanning = true
  g('spinner').hidden = false
  renderViews()
  const fresh = await window.api.scan()
  allRows = flattenPaths(fresh)
  scanning = false
  g('spinner').hidden = true
  setView(activeView)
}

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

window.api.onActionResult((action, cwd) => handleAction(action, { path: cwd }))
init()
