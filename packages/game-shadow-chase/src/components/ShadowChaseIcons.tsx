import type { ReactNode } from 'react'

interface IconProps {
  className?: string
}

function IconFrame({ children, className }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function CoreIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m16 3 10 8-4 15H10L6 11Z" />
    </IconFrame>
  )
}

export function GateIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="16" cy="16" r="13" />
      <path d="M10 26V14l6-7 6 7v12" />
    </IconFrame>
  )
}

export function ShadowsIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M3 27V13l5-8 5 8v14M19 27V13l5-8 5 8v14" />
    </IconFrame>
  )
}

export function RescueIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="11" cy="17" r="7" />
      <path d="m7 13 8 8m0-8-8 8M23 7v9l5 4" />
    </IconFrame>
  )
}

export function ClockIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="16" cy="18" r="11" />
      <path d="M16 18v-7M12 3h8" />
    </IconFrame>
  )
}

export function SwapIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M5 11h21m-5-5 5 5-5 5M27 23H6m5 5-5-5 5-5" />
    </IconFrame>
  )
}

export function ShieldIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M16 29s11-5 11-15V6L16 3 5 6v8c0 10 11 15 11 15Z" />
      <path d="m10 16 4 4 8-9" />
    </IconFrame>
  )
}

export function MicrophoneIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect x="11" y="3" width="10" height="18" rx="5" />
      <path d="M7 16a9 9 0 0 0 18 0M16 25v4" />
    </IconFrame>
  )
}

export function StopIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect x="8" y="8" width="16" height="16" rx="2" />
    </IconFrame>
  )
}

export function StrategyIcon({ intent, className }: IconProps & { intent: string }) {
  if (intent === 'support') {
    return (
      <IconFrame className={className}>
        <circle cx="11" cy="16" r="5" />
        <circle cx="23" cy="16" r="5" />
        <path d="M16 16h2" />
      </IconFrame>
    )
  }
  if (intent === 'scout') {
    return (
      <IconFrame className={className}>
        <path d="M16 27V8m0 7L7 5m9 10 9-10M4 5h5v5m14-5h5v5" />
      </IconFrame>
    )
  }
  return (
    <IconFrame className={className}>
      <circle cx="10" cy="16" r="5" />
      <path d="M17 16h11m-5-5 5 5-5 5" />
    </IconFrame>
  )
}
