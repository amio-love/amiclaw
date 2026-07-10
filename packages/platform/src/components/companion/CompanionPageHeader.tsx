import { BackLink, EyebrowTag, PageHeader } from '@amiclaw/ui'

interface CompanionPageHeaderProps {
  /** Bilingual eyebrow, e.g. `回忆 · MEMORIES`. */
  eyebrow: string
  title: string
  lead?: string
}

/* Shared header for the nested /me/* companion pages — a back link to /me, the
   bilingual section eyebrow, a page title, and an optional lead. Built on the
   shared PageHeader + BackLink primitives. */
export default function CompanionPageHeader({ eyebrow, title, lead }: CompanionPageHeaderProps) {
  return (
    <PageHeader
      back={<BackLink variant="inline" to="/me" label="我的" />}
      eyebrow={<EyebrowTag variant="section">{eyebrow}</EyebrowTag>}
      title={title}
      lead={lead}
    />
  )
}
