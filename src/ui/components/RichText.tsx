/** 본문 안의 링크·멘션·해시태그를 눌러갈 수 있게 만든다. */
import { Fragment, type ReactNode } from 'react'

const TOKEN_RE = /(https?:\/\/\S+|(?<![\w@/])@[A-Za-z0-9_]{1,15}|(?<![\w#/])#[\p{L}\p{N}_]+)/gu

/** 링크는 도메인과 경로 앞부분만 남겨 카드 폭을 넘기지 않게 한다. */
function shortenUrl(raw: string): string {
  try {
    const url = new URL(raw)
    const host = url.hostname.replace(/^www\./, '')
    const rest = `${url.pathname}${url.search}`.replace(/\/$/, '')
    const label = rest && rest !== '/' ? `${host}${rest}` : host
    return label.length > 42 ? `${label.slice(0, 41)}…` : label
  } catch {
    return raw
  }
}

const linkClass =
  'text-accent underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none'

function tokenToNode(token: string, key: number): ReactNode {
  if (token.startsWith('http')) {
    // 문장 끝 문장부호가 URL 에 딸려 들어오는 경우가 흔하다.
    const trailing = /[.,!?)\]]+$/.exec(token)?.[0] ?? ''
    const href = trailing ? token.slice(0, -trailing.length) : token
    return (
      <Fragment key={key}>
        <a href={href} target="_blank" rel="noreferrer noopener" className={linkClass}>
          {shortenUrl(href)}
        </a>
        {trailing}
      </Fragment>
    )
  }

  if (token.startsWith('@')) {
    return (
      <a
        key={key}
        href={`https://x.com/${token.slice(1)}`}
        target="_blank"
        rel="noreferrer noopener"
        className={linkClass}
      >
        {token}
      </a>
    )
  }

  return (
    <a
      key={key}
      href={`https://x.com/hashtag/${encodeURIComponent(token.slice(1))}`}
      target="_blank"
      rel="noreferrer noopener"
      className={linkClass}
    >
      {token}
    </a>
  )
}

export function RichText({ text, className = '' }: { text: string; className?: string }) {
  if (!text) return null

  const nodes: ReactNode[] = []
  let cursor = 0
  let key = 0

  for (const match of text.matchAll(TOKEN_RE)) {
    const index = match.index ?? 0
    if (index > cursor) nodes.push(text.slice(cursor, index))
    nodes.push(tokenToNode(match[0], (key += 1)))
    cursor = index + match[0].length
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))

  return <p className={`whitespace-pre-wrap break-words ${className}`}>{nodes}</p>
}
