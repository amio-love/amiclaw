import { EyebrowTag, GlassCard } from '@amiclaw/ui'
import styles from './PrivacyPage.module.css'

const CONTACT_EMAIL = 'hi@amio.love'
const EFFECTIVE_DATE = '2026-06-07'

/* Privacy policy page — a production-grade Chinese privacy policy for the
   AmiClaw platform (claw.amio.fans). The collected-data inventory is kept
   faithful to the real submission and telemetry contracts (validation.ts /
   post-event.ts / leaderboard-types.ts / event-types.ts) and the real KV
   retention windows (leaderboard 48h, telemetry 30d). Platform chrome —
   every accent is brand yellow; no BombSquad cyan on this surface. */
export default function PrivacyPage() {
  return (
    <div className={styles.page}>
      <EyebrowTag variant="section">隐私政策 · PRIVACY</EyebrowTag>
      <h2 className={styles.title}>
        我们如何对待<span className={styles.accent}>你的数据</span>。
      </h2>
      <p className={styles.lead}>
        本政策说明 AmiClaw 收集哪些信息、为什么收集、如何使用与保存，以及你对这些信息拥有的权利。
        请在使用本服务前阅读。
      </p>

      <GlassCard radius="2xl" className={styles.card}>
        <article className={styles.prose}>
          <section className={styles.section}>
            <h3 className={styles.heading}>一、适用范围与运营方</h3>
            <p>
              本政策适用于你访问与使用 AmiClaw 平台（claw.amio.fans，含 BombSquad
              等其上的游戏）时，运营方对你个人信息的处理。本服务的运营方为 AMIO 团队。
            </p>
            <p>
              本服务不设账号体系，无须注册，也无须提供邮箱、手机号或真实姓名即可游玩。
              下文逐项说明我们实际收集的信息。
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.heading}>二、我们收集哪些信息</h3>
            <p>我们只收集运行游戏与维护排行榜所必需的信息，逐项列举如下，并说明每项的收集原因。</p>

            <h4 className={styles.subheading}>1. 你主动提交的信息</h4>
            <ul className={styles.list}>
              <li>
                <strong>昵称</strong>（最长 20
                个字符）：在你首次提交每日挑战成绩时由你自行填写，用于在排行榜上标识你的成绩。
              </li>
              <li>
                <strong>所用 AI 工具</strong>（最长 40 个字符，必填）：你这一局协作所用的语音 AI（如
                Claude、ChatGPT、Gemini 或你填写的其他名称），用于在排行榜上展示成绩的协作背景。
              </li>
              <li>
                <strong>AI 模型</strong>（最长 80
                个字符，选填）：你可补充具体模型或版本；不填则不收集。
              </li>
              <li>
                <strong>问卷回答</strong>（选填）：你可在结算页选择填写一份简短问卷，内容包括所用 AI
                工具、好玩程度评分、难度感受，以及一段不超过 200 字的可选文字反馈。问卷可随时跳过。
              </li>
            </ul>

            <h4 className={styles.subheading}>2. 游戏运行中自动产生的信息</h4>
            <ul className={styles.list}>
              <li>
                <strong>设备标识符</strong>
                （device_id）：首次访问时在你的浏览器本地生成的一个随机标识，
                用于区分不同设备、防止重复计数与刷榜，不包含你的真实身份。
              </li>
              <li>
                <strong>成绩相关数据</strong>
                ：通关用时、每个模块的用时、当日第几次尝试，以及一段用于事后校验的操作记录摘要（哈希值）。这些用于排名、个人最佳计算与反作弊校验。
              </li>
              <li>
                <strong>匿名行为事件</strong>
                ：游戏开始、模块通关、通关、放弃、手册加载失败、再玩意向、三振出局、到达时间上限、问卷提交等事件的计数，附带发生时间与上述设备标识符。这些用于了解整体游玩与完成情况，均为聚合统计，不针对个人画像。
              </li>
            </ul>

            <p className={styles.note}>
              我们不收集邮箱、手机号、真实姓名、精确地理位置或任何支付信息。本服务目前不涉及付费，也不接入支付渠道。
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.heading}>三、我们如何使用这些信息</h3>
            <ul className={styles.list}>
              <li>生成并展示每日排行榜，计算你的排名与当日个人最佳成绩。</li>
              <li>进行成绩的服务端校验与基础反作弊，识别异常或刷榜的提交。</li>
              <li>以聚合方式统计游玩与完成情况，评估游戏体验并据此改进。</li>
              <li>根据问卷反馈了解协作中的问题，改进游戏设计。</li>
            </ul>
            <p>我们不会将上述信息用于与本服务无关的目的，也不会用于自动化决策对你产生重大影响。</p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.heading}>四、公开展示与第三方共享</h3>
            <p>
              <strong>公开排行榜</strong>
              ：你提交成绩后，你的昵称、通关用时、当日尝试次数，以及你所填的 AI
              工具与模型，将在每日排行榜上公开展示，访问本服务的任何人都可看到。
              请勿在昵称中填写你不愿公开的个人信息。
            </p>
            <p>
              <strong>托管与存储服务商</strong>：本服务托管于 Cloudflare。页面由 Cloudflare Pages
              提供，服务端逻辑运行于 Cloudflare Workers，成绩与事件数据存储于 Cloudflare KV。
              这意味着上述数据会经由 Cloudflare 的基础设施传输与存储，受其作为处理方的安全措施约束。
            </p>
            <p>
              <strong>你自带的 AI 工具</strong>：你与之语音协作的 AI
              由你自行选择并独立使用，属于不受我们控制的第三方服务。你与该 AI
              的对话不经过本服务，也不由我们收集；该 AI 如何处理你的数据，由其各自的隐私政策约束。
            </p>
            <p>
              除上述托管与存储服务商外，我们不向任何第三方出售、出租你的个人信息，也不会在法律要求之外对外共享。
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.heading}>五、Cookie 与本地存储</h3>
            <p>
              本服务不使用用于广告追踪的
              Cookie。我们使用浏览器的本地存储（localStorage）保存上述设备标识符，以及你填过的昵称与
              AI
              工具信息，便于你下次游玩时无须重填；并使用会话存储（sessionStorage）在你提交成绩后临时保留你的排行榜成绩，用于即时展示。清除浏览器的本地存储即可移除这些数据。
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.heading}>六、数据保留期限</h3>
            <p>我们仅在实现上述目的所必需的期限内保留数据，到期后由存储服务自动删除。</p>
            <ul className={styles.list}>
              <li>
                <strong>排行榜成绩数据</strong>：自写入起保留 48
                小时后自动过期，对应每日榜的展示周期。
              </li>
              <li>
                <strong>匿名行为事件与问卷回答</strong>：自写入起保留 30 天后自动过期。
              </li>
              <li>
                <strong>本地存储中的设备标识符与昵称等</strong>：保存在你的设备上，由你随时清除。
              </li>
            </ul>
          </section>

          <section className={styles.section}>
            <h3 className={styles.heading}>七、你的权利</h3>
            <p>
              在适用法律允许的范围内，你对自己的个人信息享有访问、更正、删除以及撤回同意的权利。
            </p>
            <p>
              由于本服务不设账号，我们通过你提交时的昵称与提交日期来定位你的成绩记录。
              如需行使上述权利，请发送邮件至{' '}
              <a className={styles.link} href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>
              ，并在邮件中附上你的昵称与成绩提交日期，以便我们核实并处理。
              请注意，排行榜成绩与行为事件均会在前述保留期限到期后自动删除。
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.heading}>八、信息安全</h3>
            <p>
              我们依托 Cloudflare
              的基础设施，对数据的传输采用加密连接（HTTPS），并将数据访问限制在实现服务目的所必需的范围内。请注意，任何通过互联网传输或存储的方式都无法保证绝对安全；我们会持续采取合理措施保护你的信息。
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.heading}>九、未成年人</h3>
            <p>
              本服务面向成年人设计。我们不有意收集未满 14
              周岁未成年人的个人信息。若你是未成年人，请在监护人同意并指导下使用本服务。如我们发现在未取得监护人同意的情况下收集了未成年人信息，将及时删除。
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.heading}>十、政策更新</h3>
            <p>
              我们可能会不时更新本政策。更新后将在本页面公布并更新下方的生效日期。涉及重大变更时，我们会以适当方式提示。你在更新生效后继续使用本服务，即表示你接受更新后的政策。
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.heading}>十一、联系我们</h3>
            <p>
              如对本政策或你的个人信息有任何疑问，请联系{' '}
              <a className={styles.link} href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>
              。
            </p>
            <p className={styles.effective}>生效日期：{EFFECTIVE_DATE}</p>
          </section>
        </article>
      </GlassCard>
    </div>
  )
}
