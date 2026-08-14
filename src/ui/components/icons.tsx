/** 인라인 아이콘 모음. 외부 아이콘 패키지를 두지 않기 위해 필요한 것만 직접 그린다. */
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

export const RefreshIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20 11a8 8 0 1 0-2.3 5.6" />
    <path d="M20 5v6h-6" />
  </Icon>
)

export const SettingsIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.35.4.64.73.83.3.17.64.26.98.26H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </Icon>
)

export const CloseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
)

export const ArrowUpIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </Icon>
)

export const ReplyIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M21 15a4 4 0 0 1-4 4H7l-4 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
  </Icon>
)

export const RepostIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M17 2.1 21 6l-4 3.9" />
    <path d="M3 12V9a3 3 0 0 1 3-3h15" />
    <path d="M7 21.9 3 18l4-3.9" />
    <path d="M21 12v3a3 3 0 0 1-3 3H3" />
  </Icon>
)

/** 인용. 한마디 붙여 다시 올린다는 뜻으로 상자 위의 연필을 쓴다. */
export const QuoteIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M18 2.5 21.5 6 12 15.5l-4.4 1.4 1.4-4.4L18 2.5Z" />
    <path d="M20 13.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5.5" />
  </Icon>
)

export const LikeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 22l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />
  </Icon>
)

export const ViewsIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 20V10M10 20V4M16 20v-8M22 20h-20" />
  </Icon>
)

export const PlayIcon = (props: IconProps) => (
  <Icon {...props} fill="currentColor" stroke="none">
    <path d="M8 5.5v13l11-6.5-11-6.5Z" />
  </Icon>
)

export const ColumnsIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="4" width="7.5" height="16" rx="1.5" />
    <rect x="13.5" y="4" width="7.5" height="16" rx="1.5" />
  </Icon>
)

export const RowsIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="4" y="3" width="16" height="7.5" rx="1.5" />
    <rect x="4" y="13.5" width="16" height="7.5" rx="1.5" />
  </Icon>
)

/** 탭으로 갈아 끼우기. 판 하나 위에 탭 하나가 솟은 모양. */
export const TabsIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="8" width="18" height="12" rx="1.5" />
    <path d="M4.5 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Icon>
)

export const EyeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
)

export const SunIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
)

export const MoonIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </Icon>
)

export const VerifiedIcon = (props: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M12 1.6 14.2 4l3.2-.4 1 3.1 3 1.3-1.2 3 1.2 3-3 1.3-1 3.1-3.2-.4L12 22.4 9.8 20l-3.2.4-1-3.1-3-1.3 1.2-3-1.2-3 3-1.3 1-3.1L9.8 4 12 1.6Zm-1.1 13.7 5.3-5.3-1.4-1.4-3.9 3.9-1.8-1.8-1.4 1.4 3.2 3.2Z" />
  </svg>
)
