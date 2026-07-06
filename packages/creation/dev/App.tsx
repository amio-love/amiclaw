/**
 * Dev-only shell UI: a game selector over the bundled fixtures, per-role
 * tabs over GameSession's leak-guarded views, a vocabulary-driven action
 * panel, running score (score_threshold levels), an event log, win banner
 * and restart. No game logic lives here — everything renders from
 * vocabulary data and the session API. The "self-play spoiler" toggle shows
 * both role views side-by-side for solo testing (default OFF = authentic
 * hidden info; for symmetric co_build partitions it is merely convenience).
 */

import { useState } from 'react'
import type { DevShellStore, LogEntry } from './store'

export interface GameOption {
  id: string
  label: string
  create: () => DevShellStore
}

export function App({ games }: { games: GameOption[] }) {
  const [, setVersion] = useState(0)
  const bump = () => setVersion((v) => v + 1)
  const [gameId, setGameId] = useState(games[0]?.id ?? '')
  const [store, setStore] = useState<DevShellStore>(() => games[0].create())
  const roles = store.roleIds()
  const [activeRole, setActiveRole] = useState(roles[0] ?? '')
  const [spoiler, setSpoiler] = useState(false)
  const won = store.won()
  const score = store.score()

  const selectGame = (nextId: string) => {
    const option = games.find((game) => game.id === nextId)
    if (!option) return
    const nextStore = option.create()
    setGameId(nextId)
    setStore(nextStore)
    setActiveRole(nextStore.roleIds()[0] ?? '')
  }

  return (
    <main className="shell">
      <header className="shell-header">
        <h1>creation dev shell</h1>
        <p className="subtitle">{store.title()}</p>
        <div className="controls">
          <label className="game-select">
            Game
            <select value={gameId} onChange={(event) => selectGame(event.target.value)}>
              {games.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.label}
                </option>
              ))}
            </select>
          </label>
          <label className="spoiler-toggle">
            <input
              type="checkbox"
              checked={spoiler}
              onChange={(event) => setSpoiler(event.target.checked)}
            />
            Self-play spoiler: show BOTH role views (breaks hidden info on purpose)
          </label>
          <button
            type="button"
            onClick={() => {
              store.reset()
              bump()
            }}
          >
            Restart
          </button>
        </div>
      </header>

      {score && (
        <div className="score-bar" role="status">
          Score: {score.current} / target {score.target}
        </div>
      )}

      {won && (
        <div className="win-banner" role="status">
          Level solved — the win condition is reached. Restart to play again.
        </div>
      )}

      {!spoiler && (
        <nav className="tabs" aria-label="role tabs">
          {roles.map((roleId) => (
            <button
              key={roleId}
              type="button"
              aria-pressed={roleId === activeRole}
              className={roleId === activeRole ? 'tab active' : 'tab'}
              onClick={() => setActiveRole(roleId)}
            >
              {store.roleLabel(roleId)}
            </button>
          ))}
        </nav>
      )}

      <div className={spoiler ? 'panels split' : 'panels'}>
        {(spoiler ? roles : [activeRole]).map((roleId) => (
          <RolePanel key={roleId} store={store} roleId={roleId} onChanged={bump} />
        ))}
      </div>

      <LogPane entries={store.log()} />
    </main>
  )
}

function RolePanel({
  store,
  roleId,
  onChanged,
}: {
  store: DevShellStore
  roleId: string
  onChanged: () => void
}) {
  const view = store.view(roleId)
  const rules = store.ruleSummaries(view.visible_rules)
  return (
    <section className="role-panel" aria-label={`${roleId} view`}>
      <h2>{store.roleLabel(roleId)}</h2>

      <h3>Visible elements</h3>
      <ul className="elements">
        {view.elements.map((element) => (
          <li key={element.element_id} className="element">
            <span className="element-id">
              {store.audioPlaceholder(roleId, element.archetype) ? '[audio] ' : ''}
              {element.element_id}
            </span>
            <span className="element-archetype">{element.archetype}</span>
            {store.placementOf(element.element_id) !== undefined && (
              <span
                className={
                  store.placementOf(element.element_id) === 'placed'
                    ? 'placement placed'
                    : 'placement'
                }
              >
                {store.placementOf(element.element_id)}
              </span>
            )}
            <dl>
              {Object.entries(element.visible_params).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
              {Object.entries(element.visible_states).map(([key, value]) => (
                <div key={key} className="state">
                  <dt>{key}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      {rules.length > 0 && (
        <>
          <h3>Codebook (visible rules)</h3>
          <ul className="codebook">
            {rules.map((rule) => (
              <li key={rule.id}>
                <code>{rule.id}</code> · {rule.template}
                <pre>{rule.bindings}</pre>
              </li>
            ))}
          </ul>
        </>
      )}

      <ActionPanel store={store} roleId={roleId} onChanged={onChanged} />
    </section>
  )
}

function ActionPanel({
  store,
  roleId,
  onChanged,
}: {
  store: DevShellStore
  roleId: string
  onChanged: () => void
}) {
  const actions = store.actionsFor(roleId)
  // F6: only offer targets the engine will accept — the role's visible
  // elements filtered by its action_capability.target_archetypes.
  const targets = store.targetableElements(roleId)
  const [action, setAction] = useState(actions[0]?.name ?? '')
  const [elementId, setElementId] = useState(targets[0]?.element_id ?? '')
  const [actionType, setActionType] = useState('')

  if (actions.length === 0) {
    return <p className="no-actions">This role has no performable actions.</p>
  }

  const selected = actions.find((a) => a.name === action) ?? actions[0]

  return (
    <form
      className="action-panel"
      onSubmit={(event) => {
        event.preventDefault()
        store.perform(roleId, selected.name, {
          element_id: elementId || undefined,
          action_type: actionType || undefined,
        })
        onChanged()
      }}
    >
      <h3>Perform action</h3>
      <label>
        Action
        <select value={selected.name} onChange={(event) => setAction(event.target.value)}>
          {actions.map((entry) => (
            <option key={entry.name} value={entry.name}>
              {entry.name} — {entry.description}
            </option>
          ))}
        </select>
      </label>
      <label>
        Target element
        <select value={elementId} onChange={(event) => setElementId(event.target.value)}>
          <option value="">(none)</option>
          {targets.map((element) => (
            <option key={element.element_id} value={element.element_id}>
              {element.element_id}
            </option>
          ))}
        </select>
      </label>
      {store.hasEventMapping() && (
        <label>
          action_type
          <input
            value={actionType}
            placeholder="event mapping key"
            onChange={(event) => setActionType(event.target.value)}
          />
        </label>
      )}
      <button type="submit">Perform</button>
    </form>
  )
}

function LogPane({ entries }: { entries: readonly LogEntry[] }) {
  return (
    <section className="log-pane" aria-label="event log">
      <h3>Event log</h3>
      {entries.length === 0 ? (
        <p className="log-empty">No actions yet.</p>
      ) : (
        <ol className="log">
          {entries.map((entry) => (
            <li key={entry.seq} className={entry.ok ? 'log-ok' : 'log-error'}>
              <span className="log-seq">#{entry.seq}</span>
              <span className="log-role">{entry.role}</span>
              <span className="log-summary">{entry.summary}</span>
              <span className="log-detail">{entry.detail}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
