import { EyebrowTag, GlassCard } from '@amiclaw/ui'
import styles from './TermsPage.module.css'

const CONTACT_EMAIL = 'hi@amio.love'
const EFFECTIVE_DATE = '2026-06-07'

/* Terms-of-service page — a production-grade Chinese user agreement for
   AMIO Arcade (claw.amio.fans). Mirrors the real service shape: no
   accounts (device-id identity), the player-supplied AI tool is an
   uncontrolled third party, nicknames + AI tool are publicly displayed.
   Platform chrome — every accent is brand yellow; no BombSquad cyan here. */
export default function TermsPage() {
  return (
    <div className={styles.page}>
      <EyebrowTag variant="section">用户条款 · TERMS</EyebrowTag>
      <h2 className={styles.title}>
        使用本服务的<span className={styles.accent}>约定</span>。
      </h2>
      <p className={styles.lead}>
        本条款是你与运营方就使用 AMIO 游乐场达成的协议。请在使用本服务前阅读并接受。
      </p>

      <GlassCard radius="2xl" className={styles.card}>
        <article className={styles.prose}>
          <section className={styles.section}>
            <h3 className={styles.heading}>一、接受条款</h3>
            <p>
              {
                '当你访问或使用 AMIO 游乐场（AMIO Arcade，原 AmiClaw，claw.amio.fans，含 BombSquad 等其上的游戏，下称「本服务」）时，即表示你已阅读、理解并同意受本条款约束。如你不同意本条款，请勿使用本服务。本服务的运营方为 AMIO 团队。'
              }
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.heading}>二、服务说明</h3>
            <p>
              本服务是一个人机语音协作的游戏平台。以 BombSquad 为例，你需要与一个语音 AI
              搭档仅通过语音沟通，共同完成拆弹挑战。
            </p>
            <p>
              你所使用的语音 AI 工具由你自行选择、自行获取并独立使用，属于不受我们控制的第三方服务。
              本服务不集成、不提供、不代理任何 AI
              接口，也不对该第三方工具的可用性、准确性或其表现负责。
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.heading}>三、身份与昵称</h3>
            <p>
              本服务不设账号体系，无须注册。我们通过你浏览器本地生成的设备标识符区分设备。
              你在提交成绩时填写的昵称仅用于排行榜标识，并非账号，亦不构成对你真实身份的认证。
              你应自行妥善管理使用本服务的设备。
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.heading}>四、用户行为规范</h3>
            <p>使用本服务时，你同意不从事下列行为：</p>
            <ul className={styles.list}>
              <li>以伪造成绩、篡改用时、自动化脚本或任何作弊手段刷榜，或干扰排行榜的公平性。</li>
              <li>使用违法、侮辱、淫秽、仇恨、冒充他人或侵犯他人权利的昵称及内容。</li>
              <li>干扰、破坏本服务的正常运行，或试图未经授权访问本服务的系统与数据。</li>
              <li>以任何方式将本服务用于违反适用法律法规的目的。</li>
            </ul>
            <p>
              对于违反上述规范的提交，我们有权移除相关成绩、过滤或清除违规昵称，并在必要时限制相关设备的使用。
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.heading}>五、用户内容</h3>
            <p>
              你提交的昵称，以及你所填写的 AI
              工具与模型信息，将在每日排行榜上公开展示。提交即表示你授权我们为运营本服务之目的展示、存储与处理这些内容。
            </p>
            <p>
              你应对自己提交的内容负责，并保证其不侵犯任何第三方的合法权利。请勿在昵称等内容中填写你不愿公开的个人信息。
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.heading}>六、知识产权</h3>
            <p>
              本服务及其包含的游戏设计、界面、文案、视觉素材、代码等，除你提交的内容及第三方素材外，其知识产权均归运营方或相应权利人所有。
              未经书面许可，你不得复制、改编、分发或以其他方式商业利用本服务的内容。
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.heading}>七、免责声明</h3>
            <p>
              本服务按「现状」与「现有可用」基础提供。在适用法律允许的范围内，我们不对本服务的不间断、无错误、满足你的特定需求或与你所用第三方
              AI 工具的兼容性作出任何明示或默示的保证。
            </p>
            <p>
              你所使用的第三方 AI
              工具不受我们控制，其表现、内容与可用性由该工具的提供方负责，与本服务无关。
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.heading}>八、责任限制</h3>
            <p>
              在适用法律允许的最大范围内，对于因使用或无法使用本服务而产生的任何间接、附带或后果性损失，运营方不承担责任。
              本条款的任何内容均不排除或限制依法不可排除或限制的责任。
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.heading}>九、服务变更与终止</h3>
            <p>
              我们可能随时新增、修改、暂停或终止本服务的全部或部分功能，且无须事先逐一通知。
              我们也可能不时更新本条款，更新后将在本页面公布并更新下方生效日期；你在更新生效后继续使用本服务，即视为接受更新后的条款。
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.heading}>十、适用法律与争议解决</h3>
            <p>
              本条款的订立、解释与争议解决适用中华人民共和国法律。
              因本服务或本条款产生的争议，双方应先友好协商解决；协商不成的，可依法向有管辖权的人民法院提起诉讼。
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.heading}>十一、联系方式</h3>
            <p>
              如对本条款有任何疑问，请联系{' '}
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
