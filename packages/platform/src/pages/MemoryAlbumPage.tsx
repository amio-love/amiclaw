import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, GlassCard, Modal } from '@amiclaw/ui'
import type { MemoryView } from '@shared/companion-types'
import { fetchMemories, deleteMemory } from '@/lib/companion-api'
import { useCompanion } from '@/hooks/useCompanion'
import {
  useCompanionAccess,
  CompanionLoginGate,
  CompanionSetupGate,
} from '@/components/companion/CompanionAccess'
import CompanionPageHeader from '@/components/companion/CompanionPageHeader'
import CompanionEmptyState from '@/components/companion/CompanionEmptyState'
import MemoryCard from '@/components/companion/MemoryCard'
import styles from './MemoryAlbumPage.module.css'

type LoadStatus = 'loading' | 'ready' | 'error'

// Bound the focus auto-paginate so a deleted / nonexistent focus id can never
// loop forever — stop at cursor exhaustion or this many extra pages.
const MAX_FOCUS_AUTO_PAGES = 20

/* /me/memories — the memory album. Keyset-paginated episode cards, newest
   first; each is a single-delete with a confirm step (deleting a memory can
   retire understandings that lose all their evidence). Honest empty state — no
   「即将推出」. */
export default function MemoryAlbumPage() {
  const access = useCompanionAccess()
  // Whether a companion exists distinguishes the two empty states: no-companion
  // (route to setup — capture events are discarded until a companion exists) vs
  // has-companion-but-no-episodes (the legitimate "去玩一局" empty state).
  const { state: companion } = useCompanion(access === 'ready')
  const [searchParams] = useSearchParams()
  const focusId = searchParams.get('focus')
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [memories, setMemories] = useState<MemoryView[]>([])
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<MemoryView | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteFailed, setDeleteFailed] = useState(false)
  // How many pages the focus auto-paginate has already pulled (bound the loop).
  const focusAutoPages = useRef(0)

  // The focused episode (an evidence link's `?focus=`) is resolvable once it is
  // in the loaded set — or when there is no focus at all.
  const focusResolved = focusId === null || memories.some((m) => m.id === focusId)

  useEffect(() => {
    if (access !== 'ready') return
    let active = true
    fetchMemories().then((result) => {
      if (!active) return
      if (result.kind === 'ok') {
        setMemories(result.memories)
        setCursor(result.nextCursor)
        setStatus('ready')
      } else {
        setStatus('error')
      }
    })
    return () => {
      active = false
    }
  }, [access])

  const loadMore = useCallback(async () => {
    if (cursor === undefined || loadingMore) return
    setLoadingMore(true)
    const result = await fetchMemories(cursor)
    if (result.kind === 'ok') {
      setMemories((prev) => [...prev, ...result.memories])
      setCursor(result.nextCursor)
    }
    setLoadingMore(false)
  }, [cursor, loadingMore])

  // A new focus target resets the page budget.
  useEffect(() => {
    focusAutoPages.current = 0
  }, [focusId])

  // Evidence click-back beyond the first page: if the focused episode is not in
  // the loaded set, auto-paginate (via the existing cursor) until it is found or
  // pagination is exhausted (cursor === undefined) — bounded by
  // MAX_FOCUS_AUTO_PAGES. If never found, the album still renders normally.
  useEffect(() => {
    if (focusResolved || status !== 'ready') return
    if (cursor === undefined || loadingMore) return
    if (focusAutoPages.current >= MAX_FOCUS_AUTO_PAGES) return
    focusAutoPages.current += 1
    loadMore()
  }, [focusResolved, status, cursor, loadingMore, loadMore])

  async function confirmDelete() {
    if (pendingDelete === null) return
    setDeleting(true)
    setDeleteFailed(false)
    const result = await deleteMemory(pendingDelete.id)
    setDeleting(false)
    if (result.kind === 'ok') {
      setMemories((prev) => prev.filter((m) => m.id !== pendingDelete.id))
      setPendingDelete(null)
    } else {
      setDeleteFailed(true)
    }
  }

  function closeDeleteModal() {
    if (deleting) return
    setPendingDelete(null)
    setDeleteFailed(false)
  }

  return (
    <div className={styles.page}>
      <CompanionPageHeader
        eyebrow="回忆 · MEMORIES"
        title="回忆相册"
        lead="你和伙伴一起拆过的局，会被它记成一段段回忆。"
      />

      {access === 'loading' ? null : access === 'gate' ? (
        <CompanionLoginGate />
      ) : status === 'loading' ? null : status === 'error' ? (
        <GlassCard radius="2xl" className={styles.note}>
          <p className={styles.noteText}>回忆暂时读不出来，稍后再试。</p>
        </GlassCard>
      ) : memories.length === 0 ? (
        // No-companion vs has-companion-no-episodes are different empty states.
        companion.status === 'loading' ? null : companion.status === 'none' ? (
          <CompanionSetupGate text="回忆是你和伙伴一起拆局留下的。先认识你的伙伴，回忆才会开始积累。" />
        ) : (
          <CompanionEmptyState
            title="还没有回忆"
            text="去和伙伴一起拆一局炸弹，故事就从这里开始。"
            ctaLabel="开始玩"
            ctaHref="/bombsquad/"
          />
        )
      ) : (
        <>
          <div className={styles.list}>
            {memories.map((memory) => (
              <MemoryCard
                key={memory.id}
                memory={memory}
                onRequestDelete={setPendingDelete}
                focused={memory.id === focusId}
              />
            ))}
          </div>
          {cursor !== undefined ? (
            <div className={styles.more}>
              <Button variant="ghost" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? '加载中…' : '看更早的回忆'}
              </Button>
            </div>
          ) : null}
        </>
      )}

      <Modal open={pendingDelete !== null} onClose={closeDeleteModal} title="删除这段回忆？">
        <p className={styles.modalText}>
          删除后，依赖它的理解如果再没有别的回忆作证据，也会一并失效。这一步无法撤销。
        </p>
        {deleteFailed && (
          <p className={styles.modalError} role="alert">
            删除失败，请稍后重试。
          </p>
        )}
        <div className={styles.modalActions}>
          <Button variant="ghost" onClick={closeDeleteModal} disabled={deleting}>
            取消
          </Button>
          <button
            type="button"
            className={styles.danger}
            onClick={confirmDelete}
            disabled={deleting}
          >
            {deleting ? '删除中…' : '删除'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
