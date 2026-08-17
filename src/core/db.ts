/**
 * IndexedDB 영속 저장소.
 *
 * 같은 게시물이 추천·팔로잉 양쪽에 뜰 수 있으므로 기본키는 `${source}:${id}` 다.
 * 컬럼별로 독립된 읽음 위치·정렬을 유지하기 위해서다.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { ImageTranslation } from './messages'
import {
  isNotification,
  notificationIdentity,
  TIMELINE_KINDS,
  type DeckItem,
  type TimelineKind,
} from './types'

const DB_NAME = 'x-deck'
const DB_VERSION = 3
const STORE = 'tweets'

/**
 * 사진 번역 결과를 쟁여두는 자리.
 *
 * 한 번 번역하는 데 30초 넘게 걸리고 구독 한도도 함께 닳는다. 같은 사진을 두 번
 * 청하지 않는 것이 여기서는 성능이 아니라 비용 문제다.
 */
const TRANSLATION_STORE = 'imageTranslations'

/**
 * 한 번만 하면 되는 일의 완료 표식을 두는 자리. 지금은 쓰는 곳이 없다.
 *
 * 그래도 판 3 에 만들어 두는 이유는, 이 자리를 쓰던 코드가 다시 들어올 수 있어서다.
 * 판 3 이 어떤 곳에서는 이 스토어가 있고 어떤 곳에서는 없는 상태가 되면, 되돌아온
 * 코드가 `oldVersion === 3` 을 보고 만들기를 건너뛴 채 없는 스토어를 연다.
 */
const META_STORE = 'metadata'

export interface StoredTranslation {
  /** 원본 이미지 주소. 그대로 열쇠로 쓴다. */
  url: string
  /** 어느 명령이 한 것인지. 엔진을 바꾸면 다시 번역해야 하므로 함께 본다. */
  engine: string
  translation: ImageTranslation
  at: number
}

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
  [TRANSLATION_STORE]: {
    key: string
    value: StoredTranslation
  }
  [META_STORE]: {
    key: string
    value: { key: string; done: boolean }
  }
}

let dbPromise: Promise<IDBPDatabase<DeckSchema>> | null = null

function open(): Promise<IDBPDatabase<DeckSchema>> {
  return openDB<DeckSchema>(DB_NAME, DB_VERSION, {
    // 이미 쓰던 데이터베이스가 있을 수 있다. 어느 판에서 올라오는지를 보고 없는 것만 만든다 —
    // 조건 없이 만들면 기존 사용자의 첫 실행에서 곧바로 터진다.
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' })
        store.createIndex('by-source-captured', ['source', 'capturedAt'])
        store.createIndex('by-captured', 'capturedAt')
      }
      if (oldVersion < 2) {
        db.createObjectStore(TRANSLATION_STORE, { keyPath: 'url' })
      }
      if (oldVersion < 3) {
        db.createObjectStore(META_STORE, { keyPath: 'key' })
      }
    },
  })
}

export function getDb(): Promise<IDBPDatabase<DeckSchema>> {
  /*
   * 저장소가 코드보다 높은 판에 있으면 IndexedDB 는 여는 것 자체를 거절한다
   * (`VersionError`). 확장을 이전 빌드로 되돌리면 곧바로 걸리는 자리이고, 여기서
   * 터지면 읽기·쓰기가 전부 조용히 실패해 덱이 빈 채로 뜬다 — 글을 못 읽어오는
   * 것처럼 보이지만 수집은 멀쩡히 돌고 있다.
   *
   * 스토어는 판이 오를 때 더해지기만 하므로, 높은 판을 그대로 여는 것은 안전하다.
   * 판 번호를 대지 않고 다시 열어 있는 판에 맞춘다.
   */
  dbPromise ??= open().catch((error: unknown) => {
    if (!(error instanceof DOMException) || error.name !== 'VersionError') throw error
    return openDB<DeckSchema>(DB_NAME)
  })
  return dbPromise
}

/** 쟁여둔 번역. 엔진이 다르면 없는 것으로 친다 — 결과의 종류부터 다르기 때문이다. */
export async function loadTranslation(
  url: string,
  engine: string,
): Promise<ImageTranslation | null> {
  const db = await getDb()
  const found = await db.get(TRANSLATION_STORE, url)
  if (!found || found.engine !== engine) return null
  return found.translation
}

export async function saveTranslation(
  url: string,
  engine: string,
  translation: ImageTranslation,
): Promise<void> {
  const db = await getDb()
  await db.put(TRANSLATION_STORE, { url, engine, translation, at: Date.now() })
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
        } else if (isNotification(item) && isNotification(existing) && existing.text !== item.text) {
          /*
           * 같은 알림이 자라났다 ('2개' → '3개').
           *
           * 새 줄로 쌓으면 같은 알림이 여러 줄이 되므로 자리는 처음 본 그대로 두고
           * 문구와 사람만 갈아 끼운다. 문구가 그대로면 아무 것도 쓰지 않는다 —
           * 갱신이 없는 응답마다 목록 전체를 다시 쓰게 된다.
           */
          await store.put({ ...existing, text: item.text, actors: item.actors })
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
 * 예전 방식으로 쌓인 알림인지.
 *
 * 알림의 신원은 x.com 이 준 id 에서 내용 기반으로 바뀌었다 (`notificationIdentity`).
 * 그전에 쌓인 줄은 열쇠가 달라 새로 받는 것과 짝지어지지 않으므로, 같은 알림이
 * 옛 줄 여럿과 새 줄 하나로 남는다. 열쇠가 지금 규칙과 어긋나는 것을 그 표시로 삼는다.
 */
function staleNotification(item: StoredItem): boolean {
  if (!isNotification(item)) return false
  const identity = notificationIdentity(item)
  return identity !== null && item.key !== storageKey(item.source, identity)
}

/**
 * 보관 정책 적용. 기간이 지났거나 컬럼당 상한을 넘긴 오래된 글부터 지운다.
 * 예전 방식으로 쌓인 알림도 함께 걷어낸다.
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
      if (seen > maxPerColumn || cursor.value.capturedAt < cutoff || staleNotification(cursor.value)) {
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
  // 번역본은 원본 게시물에 딸린 것이라 함께 비운다.
  await db.clear(TRANSLATION_STORE)
}
