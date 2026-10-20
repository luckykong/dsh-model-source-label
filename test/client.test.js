import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const LABELS = 'dsh-model-source-label:labels'
const SEEN = 'dsh-model-source-label:seen'
const settle = () => new Promise(resolve => setImmediate(resolve))

function browserStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  const pages = new Set()
  let lockTail = Promise.resolve()
  let lockCalls = 0
  return {
    data,
    pages,
    get lockCalls() { return lockCalls },
    locks: {
      request(name, callback) {
        assert.equal(name, 'dsh-model-source-label:storage')
        lockCalls += 1
        const next = lockTail.then(callback)
        lockTail = next.catch(() => {})
        return next
      },
    },
    emit(origin, key) {
      for (const page of pages) {
        if (page === origin) continue
        const event = { key, storageArea: page.storage }
        // Storage events arrive on a later task, after the current write.
        setImmediate(() => page.events.get('storage')?.(event))
      }
    },
  }
}

function page(shared = browserStorage(), { locks = true } = {}) {
  const slots = new Map()
  const dictionaries = new Map()
  const events = new Map()
  const cleanups = []
  const hookValues = new Map()
  const effects = new Map()
  let renderPath = ''
  let hookIndex = 0
  let afterRender = []
  let plugin
  let failRead = false
  let failWrite = false
  let failKey = null
  let denyStorage = false
  const api = {
    events,
    get registeredSlots() { return slots.size },
    get registeredDictionaries() { return dictionaries.size },
    set failRead(value) { failRead = value },
    set failWrite(value) { failWrite = value },
    set failKey(value) { failKey = value },
    set denyStorage(value) { denyStorage = value },
  }
  const storage = {
    getItem(key) {
      if (failRead) throw new Error('SecurityError')
      return shared.data.get(key) ?? null
    },
    setItem(key, value) {
      if (failWrite || key === failKey) throw new Error('QuotaExceededError')
      shared.data.set(key, value)
      shared.emit(api, key)
    },
  }
  api.storage = storage
  shared.pages.add(api)
  const React = {
    createElement(type, props, ...children) { return { type, props: props || {}, children } },
    useSyncExternalStore(subscribe, snapshot) { return snapshot() },
    useState(initial) {
      const key = `${renderPath}:${hookIndex++}`
      if (!hookValues.has(key)) hookValues.set(key, initial)
      return [hookValues.get(key), value => hookValues.set(key, value)]
    },
    useEffect(callback, dependencies) {
      const key = `${renderPath}:${hookIndex++}`
      const previous = effects.get(key)
      if (previous && dependencies.every((value, index) => value === previous[index])) return
      effects.set(key, dependencies)
      afterRender.push(callback)
    },
  }
  const window = {
    get localStorage() {
      if (denyStorage) throw new Error('SecurityError')
      return storage
    },
    navigator: locks ? { locks: shared.locks } : {},
    addEventListener(type, listener) { events.set(type, listener) },
    removeEventListener(type, listener) { if (events.get(type) === listener) events.delete(type) },
    __ModuleLoader__: { load(entry) {
      assert.equal(entry.id, 'dsh-model-source-label')
      plugin = entry.factory(name => { assert.equal(name, 'react'); return React })
    } },
  }
  vm.runInNewContext(source, { window })
  const ctx = {
    locale: { register(namespace, dictionary) {
      dictionaries.set(namespace, dictionary)
      return () => dictionaries.delete(namespace)
    } },
    effect(callback) { const cleanup = callback(); if (cleanup) cleanups.push(cleanup) },
    slots: {
      inject(name, callback) { const cleanup = callback(); if (cleanup) cleanups.push(cleanup) },
      register(options, component) { slots.set(options.name, component); return () => slots.delete(options.name) },
    },
  }
  function expand(node, path) {
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (Array.isArray(node)) return node.map((child, index) => expand(child, `${path}/${index}`))
    if (typeof node !== 'object') return node
    assert.ok(node.type, 'Plain objects must not become React children')
    if (typeof node.type === 'function') {
      renderPath = path
      hookIndex = 0
      return expand(node.type(node.props), `${path}/component`)
    }
    return { ...node, children: node.children.map((child, index) => expand(child, `${path}/${index}`)) }
  }
  function render(slot, props) {
    afterRender = []
    const component = slots.get(slot)
    assert.ok(component)
    const tree = expand({ type: component, props }, slot)
    afterRender.forEach(callback => callback())
    return tree
  }
  Object.assign(api, {
    install() { plugin.apply(ctx) },
    dispose() { cleanups.splice(0).reverse().forEach(cleanup => cleanup()) },
    settings(language = 'en') {
      const dict = dictionaries.get('model-source-label')[language]
      return render('settings.models.footer', { t: key => dict[key] || key })
    },
    discover(id, name = id) {
      return render('conversation.input.model.label', { provider: { id, name }, model: { id: 'model', name: 'Model' } })
    },
    label(id, name = id) { return text(api.discover(id, name)) },
    edit(id, label) {
      const row = all(api.settings(), node => node.type === 'li')
        .find(node => all(node, child => child.props?.title === id).length)
      assert.ok(row, `Missing settings row for ${id}`)
      all(row, node => node.type === 'input')[0].props.onChange({ target: { value: label } })
    },
    add(id, label = '') {
      let inputs = all(api.settings(), node => node.type === 'input')
      inputs.at(-2).props.onChange({ target: { value: id } })
      inputs.at(-1).props.onChange({ target: { value: label } })
      const button = all(api.settings(), node => node.type === 'button' && text(node) === 'Add')[0]
      button.props.onClick()
    },
  })
  api.install()
  return api
}

function all(node, predicate) {
  if (node === null || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate))
  return [...(predicate(node) ? [node] : []), ...node.children.flatMap(child => all(child, predicate))]
}

function text(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map(text).join('')
  return typeof node === 'object' ? node.children.map(text).join('') : String(node)
}

test('discovery, alias, persistence, reset and reload preserve normal behavior', async () => {
  const shared = browserStorage()
  const p = page(shared)
  assert.equal(p.label('wb', 'WorkBuddy'), 'WorkBuddy ·Model')
  p.edit('wb', 'WB ')
  assert.equal(p.label('wb', 'WorkBuddy'), 'WB ·Model')
  await settle()
  assert.equal(JSON.parse(shared.data.get(LABELS)).wb, 'WB ')
  assert.equal(page(shared).label('wb', 'WorkBuddy'), 'WB ·Model')
  const reset = all(p.settings(), node => node.type === 'button' && text(node) === 'Use default')[0]
  reset.props.onClick()
  await settle()
  assert.equal(p.label('wb', 'WorkBuddy'), 'WorkBuddy ·Model')
  assert.deepEqual(JSON.parse(shared.data.get(LABELS)), {})
})

test('stale pages merge separate labels without waiting for storage events', async () => {
  const shared = browserStorage({ [SEEN]: '{"a":"A","b":"B"}' })
  const a = page(shared, { locks: false })
  const b = page(shared, { locks: false })
  a.edit('a', 'AA')
  await settle()
  b.edit('b', 'BB')
  await settle()
  assert.deepEqual(JSON.parse(shared.data.get(LABELS)), { a: 'AA', b: 'BB' })
  await settle()
  assert.equal(a.label('b', 'B'), 'BB ·Model')
  assert.equal(b.label('a', 'A'), 'AA ·Model')
})

test('Web Locks serialize simultaneous saves; same-source edits and deletion use the last save', async () => {
  const shared = browserStorage({ [SEEN]: '{"a":"A","b":"B"}' })
  const a = page(shared)
  const b = page(shared)
  a.edit('a', 'AA')
  b.edit('b', 'BB')
  await settle()
  assert.deepEqual(JSON.parse(shared.data.get(LABELS)), { a: 'AA', b: 'BB' })
  a.edit('a', 'First')
  b.edit('a', 'Last')
  await settle()
  assert.equal(JSON.parse(shared.data.get(LABELS)).a, 'Last')
  a.edit('a', '')
  b.edit('b', 'New B')
  await settle()
  assert.deepEqual(JSON.parse(shared.data.get(LABELS)), { b: 'New B' })
  assert.ok(shared.lockCalls >= 6)
})

test('stored values are validated and capped before entering React props', () => {
  const shared = browserStorage({
    [LABELS]: JSON.stringify({ valid: 'A'.repeat(30), object: {}, number: 1, blank: ' ', ' spaced ': 'X' }),
    [SEEN]: JSON.stringify({ valid: 'V'.repeat(100), object: {}, number: 1, blank: ' ' }),
  })
  const p = page(shared)
  const tree = p.settings()
  assert.equal(all(tree, node => node.type === 'li').length, 1)
  assert.equal(all(tree, node => node.type === 'input')[0].props.value, 'A'.repeat(16))
  assert.equal(all(tree, node => node.type === 'input')[0].props.placeholder, 'V'.repeat(80))
  for (const value of ['[1]', 'null', '{broken', '"string"']) {
    assert.doesNotThrow(() => page(browserStorage({ [LABELS]: value, [SEEN]: value })).settings())
  }
})

test('history is capped while all labeled sources remain editable', async () => {
  const seen = Object.fromEntries(Array.from({ length: 205 }, (_, i) => [`p${i}`, `Provider ${i}`]))
  const labels = Object.fromEntries(Array.from({ length: 205 }, (_, i) => [`p${i}`, `L${i}`]))
  const shared = browserStorage({ [SEEN]: JSON.stringify(seen), [LABELS]: JSON.stringify(labels) })
  const p = page(shared)
  assert.equal(all(p.settings(), node => node.type === 'li').length, 205)
  p.edit('p0', 'Old')
  p.discover('new', 'New')
  await settle()
  assert.equal(Object.keys(JSON.parse(shared.data.get(SEEN))).length, 200)
  assert.equal(p.label('p0'), 'Old ·Model')
  p.edit('p0', '')
  await settle()
  assert.equal(Object.hasOwn(JSON.parse(shared.data.get(LABELS)), 'p0'), false)
})

test('history eviction prefers sources with saved aliases', async () => {
  const seen = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`p${i}`, `P${i}`]))
  const shared = browserStorage({ [SEEN]: JSON.stringify(seen), [LABELS]: '{"p0":"Keep"}' })
  const p = page(shared)
  p.discover('new')
  await settle()
  assert.equal(JSON.parse(shared.data.get(SEEN)).p0, 'P0')
  assert.equal(Object.hasOwn(JSON.parse(shared.data.get(SEEN)), 'p1'), false)
})

test('write failure keeps edits in memory, warns in both languages and retries without clobbering other pages', async () => {
  const shared = browserStorage({ [SEEN]: '{"a":"A","b":"B"}' })
  const p = page(shared)
  p.failWrite = true
  p.edit('a', 'Draft')
  await settle()
  assert.equal(p.label('a', 'A'), 'Draft ·Model')
  assert.match(text(p.settings()), /could not be saved/)
  assert.match(text(p.settings('zh')), /未能保存/)
  assert.equal(shared.data.has(LABELS), false)
  const other = page(shared)
  other.edit('b', 'Other')
  await settle()
  await settle()
  assert.equal(p.label('a', 'A'), 'Draft ·Model')
  p.failWrite = false
  p.edit('a', 'Saved')
  await settle()
  assert.deepEqual(JSON.parse(shared.data.get(LABELS)), { b: 'Other', a: 'Saved' })
  assert.equal(all(p.settings(), node => node.props.role === 'alert').length, 0)
})

test('read failures never replace unknown persisted labels with an empty snapshot', async () => {
  const shared = browserStorage({ [SEEN]: '{"a":"A"}', [LABELS]: '{"hidden":"Keep"}' })
  const p = page(shared)
  p.failRead = true
  p.edit('a', 'Draft')
  await settle()
  assert.deepEqual(JSON.parse(shared.data.get(LABELS)), { hidden: 'Keep' })
  assert.match(text(p.settings()), /could not be saved/)
  p.failRead = false
  p.edit('a', 'Saved')
  await settle()
  assert.deepEqual(JSON.parse(shared.data.get(LABELS)), { hidden: 'Keep', a: 'Saved' })
})

test('special provider IDs remain ordinary own dictionary entries through reload and reset', async () => {
  const shared = browserStorage()
  const p = page(shared)
  for (const id of ['__proto__', 'constructor', 'toString']) p.add(id, 'Label')
  await settle()
  const labels = JSON.parse(shared.data.get(LABELS))
  for (const id of ['__proto__', 'constructor', 'toString']) assert.equal(Object.hasOwn(labels, id), true)
  const reloaded = page(shared)
  assert.equal(all(reloaded.settings(), node => node.type === 'li').length, 3)
  reloaded.edit('__proto__', '')
  await settle()
  assert.equal(Object.hasOwn(JSON.parse(shared.data.get(LABELS)), '__proto__'), false)
})

test('storage clear refreshes other pages; unrelated storage events do nothing', async () => {
  const shared = browserStorage({ [LABELS]: '{"a":"Alias"}', [SEEN]: '{"a":"A"}' })
  const p = page(shared)
  shared.data.delete(LABELS)
  p.events.get('storage')({ key: 'unrelated', storageArea: p.storage })
  assert.equal(all(p.settings(), node => node.type === 'input')[0].props.value, 'Alias')
  shared.data.clear()
  shared.emit(null, null)
  await settle()
  assert.equal(all(p.settings(), node => node.type === 'li').length, 0)
})

test('unload removes listeners, dictionaries and slots and cancels queued writes', async () => {
  const shared = browserStorage({ [SEEN]: '{"a":"A"}' })
  const p = page(shared)
  p.edit('a', 'Pending')
  p.dispose()
  await settle()
  assert.equal(p.events.has('storage'), false)
  assert.equal(p.registeredSlots, 0)
  assert.equal(p.registeredDictionaries, 0)
  assert.equal(shared.data.has(LABELS), false)
  p.install()
  await settle()
  assert.equal(JSON.parse(shared.data.get(LABELS)).a, 'Pending')
  assert.equal(p.label('a', 'A'), 'Pending ·Model')
})

test('a partial save retains only the failed changes and recovers on a later storage event', async () => {
  const shared = browserStorage()
  const p = page(shared)
  p.failKey = SEEN
  p.add('a', 'Alias')
  await settle()
  assert.deepEqual(JSON.parse(shared.data.get(LABELS)), { a: 'Alias' })
  assert.equal(shared.data.has(SEEN), false)
  assert.match(text(p.settings()), /could not be saved/)
  // A later writer updates the successful key. Retrying history must preserve it.
  shared.data.set(LABELS, '{"a":"External"}')
  p.failKey = null
  shared.emit(null, LABELS)
  await settle()
  await settle()
  assert.deepEqual(JSON.parse(shared.data.get(LABELS)), { a: 'External' })
  assert.deepEqual(JSON.parse(shared.data.get(SEEN)), { a: 'a' })
  assert.equal(all(p.settings(), node => node.props.role === 'alert').length, 0)
})

test('Web Lock rejection keeps the draft and displays a recoverable save error', async () => {
  const shared = browserStorage({ [SEEN]: '{"a":"A"}' })
  const request = shared.locks.request
  shared.locks.request = () => Promise.reject(new Error('Lock denied'))
  const p = page(shared)
  p.edit('a', 'Draft')
  await settle()
  assert.equal(shared.data.has(LABELS), false)
  assert.equal(p.label('a', 'A'), 'Draft ·Model')
  assert.match(text(p.settings()), /could not be saved/)
  shared.locks.request = request
  p.edit('a', 'Saved')
  await settle()
  assert.equal(JSON.parse(shared.data.get(LABELS)).a, 'Saved')
})

test('unload while waiting for a lock prevents its delayed callback from saving', async () => {
  const shared = browserStorage({ [SEEN]: '{"a":"A"}' })
  let release
  const held = new Promise(resolve => { release = resolve })
  shared.locks.request('dsh-model-source-label:storage', () => held)
  const p = page(shared)
  p.edit('a', 'Pending')
  await settle()
  p.dispose()
  release()
  await settle()
  assert.equal(shared.data.has(LABELS), false)
})

test('localStorage getter denial and unrelated storage areas are handled safely', async () => {
  const shared = browserStorage({ [SEEN]: '{"a":"A"}', [LABELS]: '{"a":"Original"}' })
  const p = page(shared)
  shared.data.set(LABELS, '{"a":"Other"}')
  p.events.get('storage')({ key: LABELS, storageArea: {} })
  assert.equal(all(p.settings(), node => node.type === 'input')[0].props.value, 'Original')
  p.denyStorage = true
  assert.doesNotThrow(() => p.events.get('storage')({ key: LABELS, storageArea: p.storage }))
  p.edit('a', 'Draft')
  await settle()
  assert.deepEqual(JSON.parse(shared.data.get(LABELS)), { a: 'Other' })
  assert.match(text(p.settings()), /could not be saved/)
  p.denyStorage = false
  shared.emit(null, LABELS)
  await settle()
  await settle()
  assert.equal(JSON.parse(shared.data.get(LABELS)).a, 'Draft')
})
