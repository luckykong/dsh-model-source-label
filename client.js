window.__ModuleLoader__.load({
  id: 'dsh-model-source-label',
  factory(require) {
    'use strict'

    const React = require('react')
    const h = React.createElement

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------
    const NS = 'model-source-label'
    const LABELS_KEY = 'dsh-model-source-label:labels'
    const SEEN_KEY = 'dsh-model-source-label:seen'
    const STORAGE_LOCK = 'dsh-model-source-label:storage'
    const MAX_LABEL_LENGTH = 16
    const MAX_SEEN = 200

    // ---------------------------------------------------------------------
    // Locale dictionaries (runtime dictionaries are inlined; the locale/*.json
    // files only carry the Plugin Manager metadata).
    // ---------------------------------------------------------------------
    const DICT_ZH = {
      empty: '还没有来源。打开一次模型下拉菜单，来源会自动出现在这里，也可以在下方手动添加。',
      clear: '恢复默认',
      addTitle: '手动添加来源',
      modelsTitle: '模型来源简称',
      modelsIntro: '模型名旁那段小字就是来源。给每个来源填一个 2-3 字的简称，留空则显示来源原名；打开一次模型下拉菜单后，来源会自动收集到这里。',
      addIdPlaceholder: '来源 ID，例如 workbuddy',
      addLabelPlaceholder: '简称（可选）',
      addButton: '添加',
      hint: '简称保存在本机浏览器中，修改后立即生效。',
      saving: '正在保存来源设置…',
      storageError: '来源设置未能保存到浏览器。修改目前仅在本页生效，刷新后可能丢失；请检查浏览器存储权限或可用空间，再尝试修改。',
      colLabel: '简称',
    }
    const DICT_EN = {
      empty: 'No sources yet. Open the model menu once and its sources appear here, or add one manually below.',
      clear: 'Use default',
      addTitle: 'Add a source',
      modelsTitle: 'Model source labels',
      modelsIntro: 'The small text beside each model name is its source. Give a source a 2-3 character label, or leave it empty to keep the provider name; sources are collected here after you open the model menu.',
      addIdPlaceholder: 'Source id, e.g. workbuddy',
      addLabelPlaceholder: 'Short label (optional)',
      addButton: 'Add',
      hint: 'Labels are stored in this browser and apply immediately.',
      saving: 'Saving source settings…',
      storageError: 'Source settings could not be saved in this browser. Changes only apply to this page and may be lost on reload. Check storage permissions or available space, then try editing again.',
      colLabel: 'Label',
    }

    // ---------------------------------------------------------------------
    // Tiny persisted store (localStorage + useSyncExternalStore)
    // ---------------------------------------------------------------------
    function dictionary() {
      return Object.create(null)
    }

    function copyDictionary(value) {
      return Object.assign(dictionary(), value)
    }

    function readObject(key) {
      try {
        const raw = window.localStorage.getItem(key)
        const result = dictionary()
        if (raw === null) return { value: result, ok: true }
        let parsed
        try {
          parsed = JSON.parse(raw)
        } catch (error) {
          return { value: result, ok: true }
        }
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          Object.keys(parsed).forEach(function validateEntry(id) {
            // Provider IDs are opaque; do not silently merge distinct keys.
            if (id.trim() === '' || id !== id.trim() || typeof parsed[id] !== 'string') return
            const value = key === LABELS_KEY
              ? parsed[id].slice(0, MAX_LABEL_LENGTH)
              : parsed[id].trim().slice(0, 80)
            if (value.trim() !== '') result[id] = value
          })
        }
        return { value: result, ok: true }
      } catch (error) {
        return { value: dictionary(), ok: false }
      }
    }

    function writeObject(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
        return true
      } catch (error) {
        return false
      }
    }

    function normalizeLabel(value) {
      if (typeof value !== 'string') return ''
      return value.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_LENGTH)
    }

    const initialLabels = readObject(LABELS_KEY)
    const initialSeen = readObject(SEEN_KEY)
    let state = {
      labels: initialLabels.value,
      seen: trimSeen(initialSeen.value, initialLabels.value),
      storageError: !initialLabels.ok || !initialSeen.ok,
      saving: false,
    }
    let pendingLabels = dictionary()
    let pendingSeen = dictionary()
    let saving = false
    let stopped = true
    const listeners = new Set()

    function getSnapshot() {
      return state
    }

    function subscribe(listener) {
      listeners.add(listener)
      return function unsubscribe() {
        listeners.delete(listener)
      }
    }

    function sameDictionary(left, right) {
      const keys = Object.keys(left)
      return keys.length === Object.keys(right).length && keys.every(function sameValue(id) {
        return Object.prototype.hasOwnProperty.call(right, id) && left[id] === right[id]
      })
    }

    function commit(labels, seen, storageError, isSaving) {
      if (sameDictionary(labels, state.labels) && sameDictionary(seen, state.seen)
        && storageError === state.storageError && isSaving === state.saving) return
      state = { labels: labels, seen: seen, storageError: storageError, saving: isSaving }
      listeners.forEach(function notify(listener) {
        try {
          listener()
        } catch (error) {
          /* one broken subscriber must not starve the others */
        }
      })
    }

    function trimSeen(seen, labels) {
      const result = copyDictionary(seen)
      const keys = Object.keys(result)
      // Prefer keeping display names for sources with a custom label. The
      // editor also lists labels whose history record has been evicted.
      const evict = keys.filter(function withoutLabel(id) {
        return !Object.prototype.hasOwnProperty.call(labels, id)
      }).concat(keys.filter(function withLabel(id) {
        return Object.prototype.hasOwnProperty.call(labels, id)
      }))
      for (let i = 0; i < keys.length - MAX_SEEN; i += 1) delete result[evict[i]]
      return result
    }

    function mergeChanges(base, changes) {
      const result = copyDictionary(base)
      Object.keys(changes).forEach(function applyChange(id) {
        if (changes[id] === null) delete result[id]
        else result[id] = changes[id]
      })
      return result
    }

    function hasPendingChanges() {
      return Object.keys(pendingLabels).length > 0 || Object.keys(pendingSeen).length > 0
    }

    function synchronize() {
      const labels = readObject(LABELS_KEY)
      const seen = readObject(SEEN_KEY)
      const mergedLabels = mergeChanges(labels.ok ? labels.value : state.labels, pendingLabels)
      commit(mergedLabels,
        trimSeen(mergeChanges(seen.ok ? seen.value : state.seen, pendingSeen), mergedLabels),
        !labels.ok || !seen.ok || (hasPendingChanges() && state.storageError), hasPendingChanges())
    }

    function persistPendingChanges() {
      if (stopped) return
      const latestLabels = readObject(LABELS_KEY)
      const latestSeen = readObject(SEEN_KEY)
      let failed = !latestLabels.ok || !latestSeen.ok
      const labels = mergeChanges(latestLabels.ok ? latestLabels.value : state.labels, pendingLabels)
      const seen = trimSeen(mergeChanges(latestSeen.ok ? latestSeen.value : state.seen, pendingSeen), labels)
      // Never replace an unreadable store with an empty snapshot. Keep failed
      // edits pending so a later edit or storage event can retry them.
      if (Object.keys(pendingLabels).length > 0 && latestLabels.ok) {
        if (writeObject(LABELS_KEY, labels)) pendingLabels = dictionary()
        else failed = true
      }
      if (Object.keys(pendingSeen).length > 0 && latestSeen.ok) {
        if (writeObject(SEEN_KEY, seen)) pendingSeen = dictionary()
        else failed = true
      }
      commit(labels, seen, failed, hasPendingChanges())
    }

    function queueSave() {
      if (saving || stopped || !hasPendingChanges()) return
      saving = true
      Promise.resolve().then(function saveUnderLock() {
        if (stopped) return
        const locks = window.navigator && window.navigator.locks
        return locks && typeof locks.request === 'function'
          ? locks.request(STORAGE_LOCK, persistPendingChanges)
          : persistPendingChanges()
      }).catch(function saveFailed() {
        if (!stopped) commit(state.labels, state.seen, true, hasPendingChanges())
      }).finally(function saveFinished() {
        saving = false
        if (!state.storageError) queueSave()
      })
    }

    function setLabel(providerId, value) {
      const id = typeof providerId === 'string' ? providerId.trim() : ''
      if (id === '') return
      // Keep the raw draft (a trailing space while typing must survive); only
      // the emptiness check is trimmed, and reads collapse whitespace later.
      const raw = typeof value === 'string' ? value.slice(0, MAX_LABEL_LENGTH) : ''
      pendingLabels[id] = raw.trim() === '' ? null : raw
      synchronize()
      queueSave()
    }

    function recordSeenProvider(provider) {
      if (provider === null || provider === undefined) return
      const id = typeof provider.id === 'string' ? provider.id.trim() : ''
      if (id === '') return
      const name = typeof provider.name === 'string' && provider.name.trim() !== ''
        ? provider.name.trim().slice(0, 80)
        : id
      if (state.seen[id] === name) {
        queueSave()
        return
      }
      pendingSeen[id] = name
      synchronize()
      queueSave()
    }

    function useStore() {
      return React.useSyncExternalStore(subscribe, getSnapshot)
    }

    // ---------------------------------------------------------------------
    // Source resolution
    // ---------------------------------------------------------------------
    function sourceFor(provider, labels) {
      const id = provider !== null && provider !== undefined && typeof provider.id === 'string'
        ? provider.id.trim()
        : ''
      if (id !== '' && Object.prototype.hasOwnProperty.call(labels, id)) {
        const stored = normalizeLabel(labels[id])
        if (stored !== '') return stored
      }
      const name = provider !== null && provider !== undefined && typeof provider.name === 'string'
        ? provider.name.trim()
        : ''
      if (name !== '') return name
      return id
    }

    function sourceTitle(provider) {
      if (provider === null || provider === undefined) return undefined
      const name = typeof provider.name === 'string' ? provider.name.trim() : ''
      const id = typeof provider.id === 'string' ? provider.id.trim() : ''
      if (name !== '' && id !== '' && name !== id) return name + ' (' + id + ')'
      if (name !== '') return name
      if (id !== '') return id
      return undefined
    }

    // ---------------------------------------------------------------------
    // The composer model label: catalog model name + a small source caption
    // ---------------------------------------------------------------------
    function ModelSourceLabel(props) {
      const snapshot = useStore()
      const provider = props.provider || null
      const model = props.model || null
      const name = model !== null && typeof model.name === 'string' && model.name !== ''
        ? model.name
        : (model !== null && typeof model.id === 'string' ? model.id : '')
      const source = sourceFor(provider, snapshot.labels)
      const providerId = provider !== null && typeof provider.id === 'string' ? provider.id : ''
      const providerName = provider !== null && typeof provider.name === 'string' ? provider.name : ''

      React.useEffect(function announceProvider() {
        recordSeenProvider(provider)
      }, [providerId, providerName])

      const containerStyle = {
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: '0.35em',
        minWidth: 0,
        maxWidth: '100%',
        verticalAlign: 'baseline',
      }
      const nameStyle = {
        flex: '0 1 auto',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }
      const sourceStyle = {
        flex: 'none',
        fontSize: '0.8em',
        lineHeight: 1.4,
        fontWeight: 400,
        color: 'var(--dsw-alias-label-secondary, #8a8a8a)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth: '8em',
      }

      return h('span', {
        className: 'dsh-msl-label',
        style: containerStyle,
        title: sourceTitle(provider),
      },
        source !== ''
          ? h('span', { className: 'dsh-msl-label-source', style: sourceStyle, 'aria-label': source }, source + ' \u00b7')
          : null,
        h('span', { className: 'dsh-msl-label-name', style: nameStyle }, name))
    }

    // ---------------------------------------------------------------------
    // Settings page: one row per discovered source
    // ---------------------------------------------------------------------
    const PAGE_STYLE = {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      maxWidth: '720px',
      color: 'var(--dsw-alias-label-primary, inherit)',
    }
    const TITLE_STYLE = {
      margin: 0,
      fontSize: 18,
      lineHeight: '28px',
      fontWeight: 600,
      color: 'var(--dsw-alias-label-primary, inherit)',
    }
    const INTRO_STYLE = {
      margin: 0,
      fontSize: 14,
      lineHeight: '22px',
      color: 'var(--dsw-alias-label-secondary, #666)',
    }
    const LIST_STYLE = {
      listStyle: 'none',
      margin: '8px 0 0',
      padding: 0,
      display: 'flex',
      flexDirection: 'column',
    }
    const ROW_STYLE = {
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: '10px',
      padding: '14px 0',
      borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28))',
    }
    const ROW_TEXT_STYLE = {
      flex: '1 1 180px',
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
    }
    const ROW_TITLE_STYLE = {
      fontSize: 14,
      lineHeight: '22px',
      fontWeight: 500,
      color: 'var(--dsw-alias-label-primary, inherit)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }
    const ROW_DESC_STYLE = {
      fontSize: 12,
      lineHeight: '18px',
      color: 'var(--dsw-alias-label-secondary, #666)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }
    const ROW_ACTIONS_STYLE = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      marginLeft: 'auto',
    }
    const INPUT_STYLE = {
      width: '120px',
      boxSizing: 'border-box',
      padding: '4px 8px',
      borderRadius: 8,
      border: '1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.35))',
      background: 'var(--dsw-alias-bg-layer-1, transparent)',
      color: 'var(--dsw-alias-label-primary, inherit)',
      fontFamily: 'inherit',
      fontSize: 13,
      lineHeight: '20px',
    }
    const GHOST_BUTTON_STYLE = {
      flex: 'none',
      padding: '4px 10px',
      borderRadius: 8,
      border: '1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.35))',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary, inherit)',
      cursor: 'pointer',
      fontFamily: 'inherit',
      fontSize: 13,
      lineHeight: '20px',
    }
    const ADD_BUTTON_STYLE = {
      flex: 'none',
      padding: '4px 14px',
      borderRadius: 8,
      border: 0,
      background: 'var(--dsw-alias-brand-primary, #4d6bfe)',
      color: 'var(--dsw-alias-bg-base, #fff)',
      cursor: 'pointer',
      fontFamily: 'inherit',
      fontSize: 13,
      lineHeight: '20px',
    }
    const HINT_STYLE = {
      margin: 0,
      fontSize: 12,
      lineHeight: '18px',
      color: 'var(--dsw-alias-label-secondary, #666)',
    }
    const ADD_BLOCK_STYLE = {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      marginTop: '12px',
    }
    const ADD_ROW_STYLE = {
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: '8px',
    }
    const PAGE_CSS = [
      '.dsh-msl-input:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }',
      '.dsh-msl-ghost:hover { background: var(--dsw-alias-bg-layer-2); }',
      '.dsh-msl-add:hover { filter: brightness(1.05); }',
    ].join('\n')

    function SourceRow(props) {
      const id = props.id
      const name = props.name
      const stored = props.stored
      const t = props.t
      const inputValue = stored !== undefined ? stored : ''
      return h('li', { className: 'dsh-msl-row', style: ROW_STYLE },
        h('div', { style: ROW_TEXT_STYLE },
          h('div', { style: ROW_TITLE_STYLE, title: name }, name),
          h('div', { style: ROW_DESC_STYLE, title: id }, id)),
        h('div', { style: ROW_ACTIONS_STYLE },
          h('input', {
            className: 'dsh-msl-input',
            type: 'text',
            value: inputValue,
            maxLength: MAX_LABEL_LENGTH,
            placeholder: name,
            'aria-label': t('colLabel') + ': ' + name,
            style: INPUT_STYLE,
            onChange: function onLabelChange(event) {
              setLabel(id, event.target.value)
            },
          }),
          stored !== undefined && stored !== ''
            ? h('button', {
              type: 'button',
              className: 'dsh-msl-ghost',
              style: GHOST_BUTTON_STYLE,
              onClick: function onClear() {
                setLabel(id, '')
              },
            }, t('clear'))
            : null))
    }

    const EDITOR_STYLE = {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      minWidth: 0,
    }

    function SourceEditor(props) {
      const snapshot = useStore()
      const t = props.t
      const seen = snapshot.seen
      const labels = snapshot.labels
      const idDraftState = React.useState('')
      const idDraft = idDraftState[0]
      const setIdDraft = idDraftState[1]
      const labelDraftState = React.useState('')
      const labelDraft = labelDraftState[0]
      const setLabelDraft = labelDraftState[1]
      const errorState = React.useState(false)
      const error = errorState[0]
      const setError = errorState[1]

      const ids = Array.from(new Set(Object.keys(seen).concat(Object.keys(labels)))).sort(function byName(left, right) {
        return (seen[left] || left).localeCompare(seen[right] || right) || left.localeCompare(right)
      })

      function addSource() {
        const id = idDraft.trim()
        if (id === '') {
          setError(true)
          return
        }
        setError(false)
        const alias = normalizeLabel(labelDraft)
        recordSeenProvider({ id: id, name: seen[id] || id })
        if (alias !== '') setLabel(id, alias)
        setIdDraft('')
        setLabelDraft('')
      }

      return h('div', { className: 'dsh-msl-editor', style: EDITOR_STYLE },
        snapshot.storageError
          ? h('p', { role: 'alert', style: Object.assign({}, HINT_STYLE, {
            color: 'var(--dsw-alias-state-error-primary, #d93026)',
          }) }, t('storageError'))
          : snapshot.saving ? h('p', { role: 'status', style: HINT_STYLE }, t('saving')) : null,
        ids.length === 0
          ? h('p', { style: HINT_STYLE }, t('empty'))
          : h('ul', { style: LIST_STYLE }, ids.map(function renderRow(id) {
            return h(SourceRow, {
              key: id,
              id: id,
              name: seen[id] || id,
              stored: Object.prototype.hasOwnProperty.call(labels, id) ? labels[id] : undefined,
              t: t,
            })
          })),
        h('div', { style: ADD_BLOCK_STYLE },
          h('div', { style: ROW_TITLE_STYLE }, t('addTitle')),
          h('div', { style: ADD_ROW_STYLE },
            h('input', {
              className: 'dsh-msl-input',
              type: 'text',
              value: idDraft,
              placeholder: t('addIdPlaceholder'),
              'aria-label': t('addIdPlaceholder'),
              style: Object.assign({}, INPUT_STYLE, {
                width: '200px',
                borderColor: error ? 'var(--dsw-alias-state-error-primary, #d93026)' : 'var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.35))',
              }),
              onChange: function onIdDraft(event) {
                setIdDraft(event.target.value)
                if (error) setError(false)
              },
            }),
            h('input', {
              className: 'dsh-msl-input',
              type: 'text',
              value: labelDraft,
              maxLength: MAX_LABEL_LENGTH,
              placeholder: t('addLabelPlaceholder'),
              'aria-label': t('addLabelPlaceholder'),
              style: Object.assign({}, INPUT_STYLE, { width: '160px' }),
              onChange: function onLabelDraft(event) {
                setLabelDraft(event.target.value)
              },
              onKeyDown: function onKeyDown(event) {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addSource()
                }
              },
            }),
            h('button', {
              type: 'button',
              className: 'dsh-msl-add',
              style: ADD_BUTTON_STYLE,
              onClick: addSource,
            }, t('addButton'))),
          h('p', { style: HINT_STYLE }, t('hint'))))
    }

    function ModelsFooter(props) {
      const t = props.t || function fallbackT(key) { return DICT_ZH[key] || key }
      return h('div', { className: 'dsh-msl-page dsh-msl-models', style: PAGE_STYLE },
        h('style', null, PAGE_CSS),
        h('div', { style: TITLE_STYLE }, t('modelsTitle')),
        h('p', { style: INTRO_STYLE }, t('modelsIntro')),
        h(SourceEditor, { t: t }))
    }

    // ---------------------------------------------------------------------
    // Client plugin
    // ---------------------------------------------------------------------
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const locale = ctx.locale

        ctx.effect(function installDictionaries() {
          return locale.register(NS, { zh: DICT_ZH, en: DICT_EN })
        }, 'model-source-label: dictionaries')

        ctx.effect(function installStorageSync() {
          stopped = false
          synchronize()
          queueSave()
          function onStorage(event) {
            if (event.key !== null && event.key !== LABELS_KEY && event.key !== SEEN_KEY) return
            try {
              if (event.storageArea !== null && event.storageArea !== window.localStorage) return
            } catch (error) {
              // Accessing localStorage itself can throw when permission changes.
              synchronize()
              return
            }
            // Read current storage rather than replaying possibly stale events.
            synchronize()
            queueSave()
          }
          window.addEventListener('storage', onStorage)
          return function removeStorageSync() {
            stopped = true
            window.removeEventListener('storage', onStorage)
          }
        }, 'model-source-label: storage sync')

        // Replace the composer's inline model label with model name + source.
        // A single slot renders its LOWEST-priority live entry (the shipped
        // fallback sits at 0), so overriding means registering below zero;
        // unloading this plugin removes the entry and the fallback returns.
        ctx.slots.inject('conversation.input.model.label', function registerLabel() {
          return ctx.slots.register({
            name: 'conversation.input.model.label',
            priority: -1,
          }, ModelSourceLabel)
        })

        // The only settings surface: the bottom of Settings > Models.
        ctx.slots.inject('settings.models.footer', function registerModelsFooter() {
          return ctx.slots.register({
            name: 'settings.models.footer',
            id: 'model-source-label',
            order: 50,
            locale: NS,
          }, ModelsFooter)
        })
      },
    }
  },
})
