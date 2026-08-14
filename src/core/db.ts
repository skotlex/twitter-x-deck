/**
 * IndexedDB 영속 저장소.
 *
 * 같은 게시물이 추천·팔로잉 양쪽에 뜰 수 있으므로 기본키는 `${source}:${id}` 다.
 * 컬럼별로 독립된 읽음 위치·정렬을 유지하기 위해서다.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { isNotification, TIMELINE_KINDS, type DeckItem, type TimelineKind } from './types'

const DB_NAME = 'x-deck'
const DB_VERSION = 1
const STORE = 'tweets'

/**
 * 저장된 항목. 게시물과 알림이 한 창고를 쓴다.
 * 정렬·보관 정책이 완전히 같고, 알림 컬럼에는 둘이 섞여 쌓이기 때문이다.
 */
export type StoredItem = DeckItem & {
  /** `${source}:${id}` */
  key: string
}

/** 예전 이름. 게시물만 다루던 자리에서 계속 쓴다. */
export type StoredTweet = StoredItem

interface DeckSchema extends DBSchema {
  [STORE]: {
    key: string
    value: StoredItem
    indexes: {
      'by-source-captured': [TimelineKind, number]
      'by-captured': number
    }
  }
}

let dbPromise: Promise<IDBPDatabase<DeckSchema>> | null = null

export function getDb(): Promise<IDBPDatabase<DeckSchema>> {
  dbPromise ??= openDB<DeckSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore(STORE, { keyPath: 'key' })
      store.createIndex('by-source-captured', ['source', 'capturedAt'])
      store.createIndex('by-captured', 'capturedAt')
    },
  })
  return dbPromise
}

export const storageKey = (source: TimelineKind, id: string): string => `${source}:${id}`

/** 컬럼 하나의 전체 범위를 훑는 키 범위. */
const sourceRange = (source: TimelineKind) =>
  IDBKeyRange.bound([source, 0], [source, Number.MAX_SAFE_INTEGER])

/**
 * 새 항목만 저장하고 저장된 것들을 돌려준다.
 * 이미 있는 id 는 통계만 갱신하고 `capturedAt` 은 최초 관측 시각으로 보존한다 —
 * 그래야 스트림에서 이미 지나간 글이 다시 위로 튀어오르지 않는다.
 * 알림은 갱신할 것이 없어 그대로 둔다.
 */
export async function saveTweets(items: DeckItem[]): Promise<StoredItem[]> {
  if (items.length === 0) return []
  const db = await getDb()
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  const inserted: StoredItem[] = []

  await Promise.all(
    items.map(async (item) => {
      const key = storageKey(item.source, item.id)
      const existing = await store.get(key)
      if (existing) {
        if (!isNotification(item) && !isNotification(existing)) {
          await store.put({ ...existing, stats: item.stats, text: item.text })
        }
        return
      }
      const record: StoredItem = { ...item, key }
      await store.put(record)
      inserted.push(record)
    }),
  )

  await tx.done
  return inserted.sort((a, b) => b.capturedAt - a.capturedAt)
}

/** 컬럼의 최신 항목을 관측 시각 내림차순으로 읽는다. */
export async function loadRecent(
  source: TimelineKind,
  limit: number,
  beforeCapturedAt?: number,
): Promise<StoredItem[]> {
  const db = await getDb()
  const upper = beforeCapturedAt ?? Number.MAX_SAFE_INTEGER
  const range = IDBKeyRange.bound([source, 0], [source, upper], false, beforeCapturedAt !== undefined)
  const index = db.transaction(STORE).store.index('by-source-captured')

  const out: StoredItem[] = []
  let cursor = await index.openCursor(range, 'prev')
  while (cursor && out.length < limit) {
    out.push(cursor.value)
    cursor = await cursor.continue()
  }
  return out
}

/**
 * 게시물 하나를 모든 컬럼에서 지운다.
 * 같은 글이 추천·팔로잉에 함께 들어 있을 수 있어 한 자리만 지워서는 안 된다.
 */
export async function deleteTweet(id: string): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(STORE, 'readwrite')
  await Promise.all(TIMELINE_KINDS.map((source) => tx.store.delete(storageKey(source, id))))
  await tx.done
}

export async function countBySource(source: TimelineKind): Promise<number> {
  const db = await getDb()
  return db.countFromIndex(STORE, 'by-source-captured', sourceRange(source))
}

/**
 * 보관 정책 적용. 기간이 지났거나 컬럼당 상한을 넘긴 오래된 글부터 지운다.
 * @returns 삭제한 건수
 */
export async function pruneTweets(
  retentionDays: number,
  maxPerColumn: number,
  sources: readonly TimelineKind[],
): Promise<number> {
  const db = await getDb()
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  let removed = 0

  for (const source of sources) {
    const tx = db.transaction(STORE, 'readwrite')
    const index = tx.store.index('by-source-captured')
    let seen = 0
    // 최신부터 세면서 상한을 넘거나 보관 기간을 지난 지점부터 잘라낸다.
    let cursor = await index.openCursor(sourceRange(source), 'prev')
    while (cursor) {
      seen += 1
      if (seen > maxPerColumn || cursor.value.capturedAt < cutoff) {
        await cursor.delete()
        removed += 1
      }
      cursor = await cursor.continue()
    }
    await tx.done
  }

  return removed
}

export async function clearSource(source: TimelineKind): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(STORE, 'readwrite')
  let cursor = await tx.store.index('by-source-captured').openCursor(sourceRange(source))
  while (cursor) {
    await cursor.delete()
    cursor = await cursor.continue()
  }
  await tx.done
}

export async function clearAll(): Promise<void> {
  const db = await getDb()
  await db.clear(STORE)
}
