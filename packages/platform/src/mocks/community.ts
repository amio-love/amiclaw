/* Mock data for the community surfaces — handoff §6.7 (the homepage
   feed carousel) and §6.10 (the Phase 8 community page). `feedItems`
   feeds components/home/CommunityFeedCarousel; `communityPosts` is
   consumed by the community page built in Phase 8. */

/* A feed-card body is either plain text, or text carrying one fragment
   the carousel renders as a yellow `.high` highlight. Mock data stays
   plain — the highlight `<span>` is applied by the consuming component,
   so no JSX leaks into this module. */
export interface FeedHighlightBody {
  text: string
  highlight: string
}

export type FeedItemBody = string | FeedHighlightBody

export interface FeedItem {
  id: string
  who: string
  initial: string
  when: string
  body: FeedItemBody
  likes: number
  comments: number
}

export const feedItems: FeedItem[] = [
  {
    id: 'feed-1',
    who: '南瓜灯',
    initial: '南',
    when: '12 分钟前',
    body: {
      text: '刚刚 00:48 拆完每日，AI 抢答星盘的时候我都没看清符号 🙃',
      highlight: '00:48',
    },
    likes: 36,
    comments: 8,
  },
  {
    id: 'feed-2',
    who: 'Skyfall_42',
    initial: 'S',
    when: '47 分钟前',
    body: '新人指南：先练「光弦」模块，最容易让 AI 看清。',
    likes: 129,
    comments: 23,
  },
  {
    id: 'feed-3',
    who: '夜空灯塔',
    initial: '夜',
    when: '1 小时前',
    body: '第一次进 Top 10！谢谢 ChatGPT 的耐心。',
    likes: 58,
    comments: 12,
  },
  {
    id: 'feed-4',
    who: 'aurora',
    initial: 'A',
    when: '2 小时前',
    body: '把 BombSquad 当英语口语练习，AI 比我老师还有耐心。',
    likes: 212,
    comments: 41,
  },
  {
    id: 'feed-5',
    who: '林星海',
    initial: '林',
    when: '3 小时前',
    body: '每日 03:14，被星盘狠狠教育。',
    likes: 14,
    comments: 3,
  },
  {
    id: 'feed-6',
    who: '石头剪刀布',
    initial: '石',
    when: '4 小时前',
    body: '建议加个「双人合拆」模式，已经向官方提了。',
    likes: 88,
    comments: 17,
  },
]

/* A community post — handoff §6.10. `image` is an optional cyan
   img-block label (e.g. the run outcome); absent on text-only posts. */
export interface CommunityPost {
  id: string
  who: string
  initial: string
  when: string
  body: string
  image?: string
  likes: number
  comments: number
}

export const communityPosts: CommunityPost[] = [
  {
    id: 'post-1',
    who: 'Skyfall_42',
    initial: 'S',
    when: '47 分钟前',
    body: '把手册分成 4 段念给 AI，模块切换的时候只重复对应那段，能省 30 秒。',
    likes: 129,
    comments: 23,
  },
  {
    id: 'post-2',
    who: '夜空灯塔',
    initial: '夜',
    when: '1 小时前',
    body: '第一次进 Top 10！打完 AI 还安慰我说光弦那段拆得很稳。',
    image: '拆弹成功 · 02:11',
    likes: 58,
    comments: 12,
  },
  {
    id: 'post-3',
    who: 'aurora',
    initial: 'A',
    when: '2 小时前',
    body: '把 BombSquad 当英语口语练习，跟 AI 描述符号反而比和人聊天放松。',
    likes: 212,
    comments: 41,
  },
  {
    id: 'post-4',
    who: '南瓜灯',
    initial: '南',
    when: '12 分钟前',
    body: '星盘转过头，AI 居然冷静告诉我「再来一圈」。终极心理素质。',
    likes: 36,
    comments: 8,
  },
  {
    id: 'post-5',
    who: '林星海',
    initial: '林',
    when: '3 小时前',
    body: '今天的每日比昨天难一档，前两次都被「星符」卡住了。',
    image: '差一点 · 03:14',
    likes: 14,
    comments: 3,
  },
  {
    id: 'post-6',
    who: '石头剪刀布',
    initial: '石',
    when: '4 小时前',
    body: '提议双人合拆模式：一个对着 AI，一个对着屏幕。已经写信给官方。',
    likes: 88,
    comments: 17,
  },
]
