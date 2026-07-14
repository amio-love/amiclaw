/** Companion proxy social steps — the 屏 A/B/C surfaces of
    arch-component-proxy-social (§UI Integration + §E2E Acceptance Mapping).

    The static build has no D1 / Workers runtime, so the community feed and the
    two /ai-intent/* generation routes are route-mocked in fixtures.ts. These
    steps seed one companion proxy thread on a mocked event, then drive the four
    viewer variants the Playwright layer covers: the owner-with-companion reply
    closure (屏 A + 屏 B), the companion-less owner CTA and the anonymous
    login-hint (屏 B variants), and the author-side transparency line (屏 C). */
import { expect } from '@playwright/test'
import { Given, Then, When } from './fixtures'

// The one seeded proxy thread + its anchoring event. The event owner (乙) is
// `OWNER_LABEL`; the visiting companion (甲's) that authored the line is
// `AUTHOR_COMPANION` signed as `AUTHOR_LABEL 的伙伴`. `PROXY_EVENT_ID` is
// URL-safe so the 屏 C transparency link (`/community?event=<id>`) is asserted
// verbatim.
const PROXY_EVENT_ID = 'e0proxyevent0001'
const PROXY_MESSAGE_ID = 'm0proxymsg000001'
const OWNER_LABEL = '林小满'
const AUTHOR_LABEL = '星野'
const AUTHOR_COMPANION = 'Aster'
const AUTHOR_BODY = '刚看到你把今天的每日挑战拆得干干净净，稳。'
const RESPONDER_COMPANION = 'Nova'
const REPLY_BODY = '谢谢它替你留言，我也回你一句 —— 改天一起拆一颗。'

const REPLY_CTA = /让我的伙伴回一句/

Given('a companion has left a proxy line on a community event', async ({ world }) => {
  // A real-shaped daily_clear event owned by 乙, carrying ONE unanswered proxy
  // thread authored by 甲's companion. Viewer flags default false — the second
  // Given (owner-with / owner-without / anon) sets them, matching how the server
  // derives them per session.
  world.communityFeed = {
    items: [
      {
        id: PROXY_EVENT_ID,
        template: 'daily_clear',
        public_label: OWNER_LABEL,
        at: new Date(world.seedT - 8 * 60_000).toISOString(),
        duration_ms: 142_000,
        like_count: 3,
        liked: false,
        threads: [
          {
            message_id: PROXY_MESSAGE_ID,
            author_companion_name: AUTHOR_COMPANION,
            author_public_label: AUTHOR_LABEL,
            body: AUTHOR_BODY,
            created_at: new Date(world.seedT - 5 * 60_000).toISOString(),
            reply: null,
            can_reply: false,
          },
        ],
        viewer_is_owner: false,
        viewer_has_companion: false,
      },
    ],
    next_before: null,
  }
})

Given('I am the signed-in owner of that event with a companion', async ({ world }) => {
  // signIn() before navigation so the first session read is authenticated. The
  // server-derived viewer flags (mirrored here) make the thread replyable, and
  // the responder signature is what the mocked V2 route writes into the feed.
  world.signIn({ user_id: 'e2e-owner', email: 'owner@amio.fans' })
  world.companion = {
    name: RESPONDER_COMPANION,
    address_style: '',
    voice_id: 'companion-warm',
    profile_enabled: true,
    // quiet-remembered → the home shell never auto-requests the mic (the
    // auto-voice sequence is gated on the homepage + voice-default posture).
    voice_posture: 'quiet-remembered',
    created_at: '2026-06-30T00:00:00.000Z',
  }
  const item = world.communityFeed.items[0]
  item.viewer_is_owner = true
  item.viewer_has_companion = true
  item.threads[0].can_reply = true
  world.proxyReplyResponder = {
    responder_companion_name: RESPONDER_COMPANION,
    responder_public_label: OWNER_LABEL,
    body: REPLY_BODY,
  }
})

Given('I am the signed-in owner of that event without a companion', async ({ world }) => {
  world.signIn({ user_id: 'e2e-owner', email: 'owner@amio.fans' })
  world.companion = null
  const item = world.communityFeed.items[0]
  item.viewer_is_owner = true
  item.viewer_has_companion = false
  item.threads[0].can_reply = false
})

Given('I am an anonymous visitor', async ({ world }) => {
  // No signIn — viewer flags stay false, exactly what the server derives for an
  // anonymous read.
  world.authIdentity = null
})

Given(
  "my companion has autonomously left a proxy line on another player's event",
  async ({ world }) => {
    // Raise the V1 `messaged:true` outcome the mocked background trigger returns,
    // so the 屏 C transparency beat renders from the returned target_event.
    world.proxyMessage = {
      messaged: true,
      message_id: PROXY_MESSAGE_ID,
      target_event: {
        event_id: PROXY_EVENT_ID,
        template: 'daily_clear',
        target_public_label: OWNER_LABEL,
      },
    }
  }
)

Given('I am the signed-in author with a companion', async ({ world }) => {
  world.signIn({ user_id: 'e2e-author', email: 'author@amio.fans' })
  world.companion = {
    name: AUTHOR_COMPANION,
    address_style: '',
    voice_id: 'companion-warm',
    profile_enabled: true,
    voice_posture: 'quiet-remembered',
    created_at: '2026-06-30T00:00:00.000Z',
  }
})

When('I open the lobby homepage', async ({ world }) => {
  await world.openPath('/')
})

Then('I see the companion proxy line with its companion signature', async ({ page }) => {
  // The author companion's name, the「<主人昵称> 的伙伴」signature, the AI body,
  // and the「非模板」honesty hint — all server-generated snapshot data (屏 A).
  await expect(page.getByText(AUTHOR_COMPANION).first()).toBeVisible()
  await expect(page.getByText(`${AUTHOR_LABEL} 的伙伴`).first()).toBeVisible()
  await expect(page.getByText(AUTHOR_BODY).first()).toBeVisible()
  await expect(page.getByText('真实内容由伙伴 AI 生成，非模板').first()).toBeVisible()
})

Then('I see the one-tap reply CTA on the thread', async ({ page }) => {
  // 屏 B — owner + companion + unanswered thread. The corner badge counts the
  // threads on the card.
  await expect(page.getByRole('button', { name: REPLY_CTA })).toBeVisible()
  await expect(page.getByText(/伙伴留言 1/)).toBeVisible()
})

When('I tap the one-tap reply CTA', async ({ page }) => {
  await page.getByRole('button', { name: REPLY_CTA }).click()
})

Then("my companion's reply is shown and the round is sealed", async ({ page, world }) => {
  // The V2 route wrote the server-generated reply into the feed; the client
  // refetched and rendered it verbatim (never fabricated client-side), with the
  // responder signature and the 封存 seal.
  await expect(page.getByText(REPLY_BODY).first()).toBeVisible()
  await expect(page.getByText(`${OWNER_LABEL} 的伙伴`).first()).toBeVisible()
  await expect(page.getByText('一轮对话已完成')).toBeVisible()
  // The request carried only the opaque message_id — zero user free text.
  expect(world.proxyReplies.at(-1)).toEqual({ message_id: PROXY_MESSAGE_ID })
})

Then('the one-tap reply CTA is gone', async ({ page }) => {
  // 一轮封顶 at the UI: the thread sealed, so there is no further reply affordance
  // to tap (the DB PK backstop is unit-tested; here the closure is the absent CTA).
  await expect(page.getByRole('button', { name: REPLY_CTA })).toHaveCount(0)
})

Then('I see the create-a-companion guide instead of a reply CTA', async ({ page }) => {
  // 屏 B variant — owner WITHOUT a companion: the point-of-need onboarding hook,
  // never the reply CTA.
  await expect(page.getByRole('link', { name: /创建你的伙伴来回应/ })).toBeVisible()
  await expect(page.getByRole('button', { name: REPLY_CTA })).toHaveCount(0)
})

Then('I see the log-in-to-reply invitation on the thread', async ({ page }) => {
  // 屏 B variant — anonymous passer-by: the honest login invite, never a reply CTA.
  await expect(page.getByText('登录，让你的伙伴回应。').first()).toBeVisible()
  await expect(page.getByRole('button', { name: REPLY_CTA })).toHaveCount(0)
})

Then('I see the transparency line naming the player my companion greeted', async ({ page }) => {
  // 屏 C — the single dismissible dock line, filled verbatim from the V1
  // target_event facts (no fabricated content, no second feed read).
  const beat = page.getByRole('status', { name: '伙伴代言提示' })
  await expect(beat).toBeVisible()
  await expect(beat).toContainText(`我看到 ${OWNER_LABEL} 拆掉了今天的每日挑战，替你道了句漂亮`)
})

Then('the transparency line links to that anchored community event', async ({ page }) => {
  // 「→ 看看我说了什么」anchors at the exact event via target_event.event_id, so
  // the just-authored thread scrolls into view on arrival (the wired-up event_id).
  const link = page
    .getByRole('status', { name: '伙伴代言提示' })
    .getByRole('link', { name: /看看我说了什么/ })
  const href = await link.getAttribute('href')
  expect(href).toContain(`/community?event=${PROXY_EVENT_ID}`)
})
