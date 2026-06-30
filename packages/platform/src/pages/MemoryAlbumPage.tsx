import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, GlassCard, Modal } from '@amiclaw/ui'
import type { MemoryView } from '@shared/companion-types'
import { fetchMemories, deleteMemory } from '@/lib/companion-api'
import { useCompanionAccess, CompanionLoginGate } from '@/components/companion/CompanionAccess'
import CompanionPageHeader from '@/components/companion/CompanionPageHeader'
import CompanionEmptyState from '@/components/companion/CompanionEmptyState'
import MemoryCard from '@/components/companion/MemoryCard'
import styles from './MemoryAlbumPage.module.css'

type LoadStatus = 'loading' | 'ready' | 'error'

/* /me/memories — the memory album. Keyset-paginated episode cards, newest
   first; each is a single-delete with a confirm step (deleting a memory can
   retire understandings that lose all their evidence). Honest empty state — no
   「即将推出」. */
export default function MemoryAlbumPage() {
  const access = useCompanionAccess()
  const [searchParams] = useSearchParams()
  const focusId = searchParams.get('focus')
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [memories, setMemories] = useState<MemoryView[]>([])
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<MemoryView | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteFailed, setDeleteFailed] = useState(false)

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

  async function loadMore() {
    if (cursor === undefined || loadingMore) return
    setLoadingMore(true)
    const result = await fetchMemories(cursor)
    if (result.kind === 'ok') {
      setMemories((prev) => [...prev, ...result.memories])
      setCursor(result.nextCursor)
    }
    setLoadingMore(false)
  }

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
        <CompanionEmptyState
          title="还没有回忆"
          text="去和伙伴一起拆一局炸弹，故事就从这里开始。"
          ctaLabel="开始玩"
          ctaHref="/bombsquad/"
        />
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
