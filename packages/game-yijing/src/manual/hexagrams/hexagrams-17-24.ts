// Hexagrams #17–#24 — King Wen order.
// Classical texts follow the received text (通行本); authored fields match the
// register of the original entries.

import type { HexagramEntry } from '../schema'

export const HEXAGRAMS_17_24: HexagramEntry[] = [
  // #17 随 — 泽雷
  {
    number: 17,
    name: { chinese: '随', pinyin: 'suí', english: 'Following' },
    trigrams: { upper: '兑 (泽)', lower: '震 (雷)' },
    judgment: {
      classical: '随：元亨，利贞，无咎。',
      modern_interpretation: '随顺时势，大为亨通；须以正道相随，才无咎。',
      keywords: ['随时', '顺势', '正道', '取舍'],
    },
    image: {
      classical: '泽中有雷，随；君子以向晦入宴息。',
      modern_interpretation: '雷入泽中蛰伏，随时而息；君子据此天黑便入室安歇，作息随时。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '官有渝，贞吉。出门交有功。',
        modern_interpretation: '职守有变，守正即吉。走出门去与人交往，能有功。',
        changing_guidance: '此爻变动时，提示环境变了就调整自己，出去建立新连接。',
      },
      {
        position: 2,
        name: '六二',
        classical: '系小子，失丈夫。',
        modern_interpretation: '系恋眼前的小利，就会失去更重要的依靠。',
        changing_guidance: '此爻变动时，警示别为小的抓手放掉大的方向。',
      },
      {
        position: 3,
        name: '六三',
        classical: '系丈夫，失小子。随有求得，利居贞。',
        modern_interpretation: '追随可靠的引领，舍弃次要的牵绊；所求可得，宜安守正道。',
        changing_guidance: '此爻变动时，提示做出取舍，跟定值得跟的人。',
      },
      {
        position: 4,
        name: '九四',
        classical: '随有获，贞凶。有孚在道，以明，何咎？',
        modern_interpretation:
          '随从而广有收获，易招疑忌。心怀诚信、行在正道、处事光明，又有什么过错？',
        changing_guidance: '此爻变动时，提示收获越多越要透明坦荡。',
      },
      {
        position: 5,
        name: '九五',
        classical: '孚于嘉，吉。',
        modern_interpretation: '诚信地嘉许善者、追随善道——吉。',
        changing_guidance: '此爻变动时，提示认准好的人与事，全心投入。',
      },
      {
        position: 6,
        name: '上六',
        classical: '拘系之，乃从维之。王用亨于西山。',
        modern_interpretation: '相随之情牢固如缚，至诚可通神明。',
        changing_guidance: '此爻变动时，提示极深的信任是稀有之物，郑重对待。',
      },
    ],
  },
  // #18 蛊 — 山风
  {
    number: 18,
    name: { chinese: '蛊', pinyin: 'gǔ', english: 'Work on the Decayed' },
    trigrams: { upper: '艮 (山)', lower: '巽 (风)' },
    judgment: {
      classical: '蛊：元亨，利涉大川。先甲三日，后甲三日。',
      modern_interpretation:
        '整治积弊，大为亨通，值得涉险去做。动手前后都要反复推敲——事前谋划，事后善后。',
      keywords: ['整弊', '修复', '善后', '担当'],
    },
    image: {
      classical: '山下有风，蛊；君子以振民育德。',
      modern_interpretation: '山下有风，物久必腐而待整治；君子据此振奋民心、培育德行。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '干父之蛊，有子，考无咎，厉终吉。',
        modern_interpretation:
          '承担并修正前人留下的积弊；有这样的后继者，前人也可免咎。虽有风险，终吉。',
        changing_guidance: '此爻变动时，提示接手烂摊子是修行，认真收拾会有好结果。',
      },
      {
        position: 2,
        name: '九二',
        classical: '干母之蛊，不可贞。',
        modern_interpretation: '整治积弊须顾及情面，不可一味强硬。',
        changing_guidance: '此爻变动时，提示纠偏也要讲方式，刚柔并济。',
      },
      {
        position: 3,
        name: '九三',
        classical: '干父之蛊，小有悔，无大咎。',
        modern_interpretation: '大力整治前弊，稍有过猛之悔，但无大咎。',
        changing_guidance: '此爻变动时，提示宁可略猛也不拖延，方向对就好。',
      },
      {
        position: 4,
        name: '六四',
        classical: '裕父之蛊，往见吝。',
        modern_interpretation: '对积弊宽纵拖延，继续下去会有遗憾。',
        changing_guidance: '此爻变动时，警示问题不会自己消失，别再拖了。',
      },
      {
        position: 5,
        name: '六五',
        classical: '干父之蛊，用誉。',
        modern_interpretation: '以德望整治前弊，获得称誉。',
        changing_guidance: '此爻变动时，提示用口碑和公信力推动革新。',
      },
      {
        position: 6,
        name: '上九',
        classical: '不事王侯，高尚其事。',
        modern_interpretation: '不侍奉王侯，把自己的志业看得更高。',
        changing_guidance: '此爻变动时，提示跳出名利场，做自己认定的事。',
      },
    ],
  },
  // #19 临 — 地泽
  {
    number: 19,
    name: { chinese: '临', pinyin: 'lín', english: 'Approach' },
    trigrams: { upper: '坤 (地)', lower: '兑 (泽)' },
    judgment: {
      classical: '临：元亨，利贞。至于八月有凶。',
      modern_interpretation: '亲临督导，大为亨通，守正有利。但盛景有时限，须防由盛转衰。',
      keywords: ['临事', '督导', '感化', '盛衰有时'],
    },
    image: {
      classical: '泽上有地，临；君子以教思无穷，容保民无疆。',
      modern_interpretation: '地在泽上，居高临下而相亲；君子据此教化无穷、容纳保民无疆。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '咸临，贞吉。',
        modern_interpretation: '以感化之道临人，守正即吉。',
        changing_guidance: '此爻变动时，提示以真诚打动人，胜过施压。',
      },
      {
        position: 2,
        name: '九二',
        classical: '咸临，吉，无不利。',
        modern_interpretation: '以感化临人，吉，无所不利。',
        changing_guidance: '此爻变动时，提示影响力正盛，放手去带动。',
      },
      {
        position: 3,
        name: '六三',
        classical: '甘临，无攸利。既忧之，无咎。',
        modern_interpretation: '靠甜言哄劝临人，没有好处；能觉察而忧改，则无咎。',
        changing_guidance: '此爻变动时，警示少些讨好，多些真实。',
      },
      {
        position: 4,
        name: '六四',
        classical: '至临，无咎。',
        modern_interpretation: '亲身到场、切实临事，没有过错。',
        changing_guidance: '此爻变动时，提示到现场去，亲自看一眼。',
      },
      {
        position: 5,
        name: '六五',
        classical: '知临，大君之宜，吉。',
        modern_interpretation: '以智慧临下，知人善任——这是领导者该有的样子，吉。',
        changing_guidance: '此爻变动时，提示学会放权，用人的智慧临事。',
      },
      {
        position: 6,
        name: '上六',
        classical: '敦临，吉，无咎。',
        modern_interpretation: '以敦厚之德临人，吉而无咎。',
        changing_guidance: '此爻变动时，提示厚道是最长久的领导力。',
      },
    ],
  },
  // #20 观 — 风地
  {
    number: 20,
    name: { chinese: '观', pinyin: 'guān', english: 'Contemplation' },
    trigrams: { upper: '巽 (风)', lower: '坤 (地)' },
    judgment: {
      classical: '观：盥而不荐，有孚颙若。',
      modern_interpretation: '观仰之道，如祭祀初始洗手时那般庄敬专注；心怀诚敬，自然使人仰望。',
      keywords: ['观察', '庄敬', '示范', '自省'],
    },
    image: {
      classical: '风行地上，观；先王以省方观民设教。',
      modern_interpretation: '风行大地，遍及万物；先王据此巡省四方、观察民情、设立教化。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '童观，小人无咎，君子吝。',
        modern_interpretation: '像孩童一样浅看，普通人无妨，担事者则失之浅陋。',
        changing_guidance: '此爻变动时，提示把视野再抬高一层。',
      },
      {
        position: 2,
        name: '六二',
        classical: '窥观，利女贞。',
        modern_interpretation: '从门缝里窥看，所见狭窄，只宜安守。',
        changing_guidance: '此爻变动时，提示走出去看全景，别只从缝隙里判断。',
      },
      {
        position: 3,
        name: '六三',
        classical: '观我生，进退。',
        modern_interpretation: '观照自己的所作所为，据此决定进退。',
        changing_guidance: '此爻变动时，提示先审视自己，再决定去留。',
      },
      {
        position: 4,
        name: '六四',
        classical: '观国之光，利用宾于王。',
        modern_interpretation: '观见邦国之光华，宜为上宾、施展所长。',
        changing_guidance: '此爻变动时，提示看到了好的平台，就去参与其中。',
      },
      {
        position: 5,
        name: '九五',
        classical: '观我生，君子无咎。',
        modern_interpretation: '居上位者反观自己的施为，君子如此则无咎。',
        changing_guidance: '此爻变动时，提示以他人的反应为镜，检视自己。',
      },
      {
        position: 6,
        name: '上九',
        classical: '观其生，君子无咎。',
        modern_interpretation: '被众人观仰的人，时时自省其行，君子如此则无咎。',
        changing_guidance: '此爻变动时，提示身处注视之下，言行更要经得起看。',
      },
    ],
  },
  // #21 噬嗑 — 火雷
  {
    number: 21,
    name: { chinese: '噬嗑', pinyin: 'shì kè', english: 'Biting Through' },
    trigrams: { upper: '离 (火)', lower: '震 (雷)' },
    judgment: {
      classical: '噬嗑：亨。利用狱。',
      modern_interpretation: '咬合排除梗阻，亨通。适合明断是非、施行刑罚。',
      keywords: ['破障', '明断', '公正', '刚柔并施'],
    },
    image: {
      classical: '雷电，噬嗑；先王以明罚敕法。',
      modern_interpretation: '雷电交合，威明并作；先王据此明定刑罚、整饬法度。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '屦校灭趾，无咎。',
        modern_interpretation: '初犯即受小惩，脚镣遮趾——小惩大诫，无咎。',
        changing_guidance: '此爻变动时，提示小错早纠，是对将来的保护。',
      },
      {
        position: 2,
        name: '六二',
        classical: '噬肤灭鼻，无咎。',
        modern_interpretation: '惩治如咬柔嫩之肉，虽深无咎。',
        changing_guidance: '此爻变动时，提示处置阻力不大时，果断些没关系。',
      },
      {
        position: 3,
        name: '六三',
        classical: '噬腊肉，遇毒。小吝，无咎。',
        modern_interpretation: '咬到坚硬的腊肉而遇苦味——处置旧怨会有小麻烦，但无大碍。',
        changing_guidance: '此爻变动时，提示碰到硬茬别气馁，继续处理。',
      },
      {
        position: 4,
        name: '九四',
        classical: '噬干胏，得金矢。利艰贞，吉。',
        modern_interpretation: '咬开带骨干肉，得到金箭——攻坚有获。在艰难中守正，吉。',
        changing_guidance: '此爻变动时，提示最难啃的部分里藏着最大收获。',
      },
      {
        position: 5,
        name: '六五',
        classical: '噬干肉，得黄金。贞厉，无咎。',
        modern_interpretation: '咬开干肉，得到黄金。居中断事，常怀戒惧则无咎。',
        changing_guidance: '此爻变动时，提示裁断大事要公允，也要如履薄冰。',
      },
      {
        position: 6,
        name: '上九',
        classical: '何校灭耳，凶。',
        modern_interpretation: '恶积不改，重枷加颈遮耳——凶。',
        changing_guidance: '此爻变动时，警示屡犯不改的问题会积重难返。',
      },
    ],
  },
  // #22 贲 — 山火
  {
    number: 22,
    name: { chinese: '贲', pinyin: 'bì', english: 'Grace' },
    trigrams: { upper: '艮 (山)', lower: '离 (火)' },
    judgment: {
      classical: '贲：亨。小利有攸往。',
      modern_interpretation: '文饰修美，亨通。文饰是锦上添花，宜小事推进，不宜倚为根本。',
      keywords: ['文饰', '本色', '内实', '适度'],
    },
    image: {
      classical: '山下有火，贲；君子以明庶政，无敢折狱。',
      modern_interpretation: '山下有火，光照有限；君子据此明察日常政务，而不轻率裁断大狱。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '贲其趾，舍车而徒。',
        modern_interpretation: '修饰脚趾，宁可舍车步行——以踏实为美。',
        changing_guidance: '此爻变动时，提示放弃排场，走自己的路。',
      },
      {
        position: 2,
        name: '六二',
        classical: '贲其须。',
        modern_interpretation: '修饰胡须，依附于面容——装饰须依托本体。',
        changing_guidance: '此爻变动时，提示形式要跟着实质走。',
      },
      {
        position: 3,
        name: '九三',
        classical: '贲如濡如，永贞吉。',
        modern_interpretation: '文饰润泽而有光彩；长守正道即吉。',
        changing_guidance: '此爻变动时，提示光彩之下持之以恒，别昙花一现。',
      },
      {
        position: 4,
        name: '六四',
        classical: '贲如皤如，白马翰如。匪寇婚媾。',
        modern_interpretation: '装饰素白，骑白马疾驰——来者是结好的而非劫掠的。',
        changing_guidance: '此爻变动时，提示放下猜疑，坦然接受善意。',
      },
      {
        position: 5,
        name: '六五',
        classical: '贲于丘园，束帛戋戋。吝，终吉。',
        modern_interpretation: '装饰山丘园圃，礼物微薄——虽显寒酸，崇实黜华，终吉。',
        changing_guidance: '此爻变动时，提示俭朴不丢人，实意比厚礼贵。',
      },
      {
        position: 6,
        name: '上九',
        classical: '白贲，无咎。',
        modern_interpretation: '以无饰为饰，返璞归真——无咎。',
        changing_guidance: '此爻变动时，提示删繁就简，回到本色。',
      },
    ],
  },
  // #23 剥 — 山地
  {
    number: 23,
    name: { chinese: '剥', pinyin: 'bō', english: 'Splitting Apart' },
    trigrams: { upper: '艮 (山)', lower: '坤 (地)' },
    judgment: {
      classical: '剥：不利有攸往。',
      modern_interpretation: '剥落侵蚀之时，阴长阳消——不宜有所前往，宜静待时势。',
      keywords: ['剥蚀', '守静', '止损', '存种'],
    },
    image: {
      classical: '山附于地，剥；上以厚下安宅。',
      modern_interpretation: '山倾附于地，根基被剥；居上者据此厚待根基、安固所居。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '剥床以足，蔑贞凶。',
        modern_interpretation: '床从脚开始剥蚀——正道被侵蚀于底层，凶。',
        changing_guidance: '此爻变动时，警示侵蚀从底部开始了，尽早加固。',
      },
      {
        position: 2,
        name: '六二',
        classical: '剥床以辨，蔑贞凶。',
        modern_interpretation: '剥蚀到了床身，正道进一步被毁——凶。',
        changing_guidance: '此爻变动时，警示问题在升级，不能再观望。',
      },
      {
        position: 3,
        name: '六三',
        classical: '剥之，无咎。',
        modern_interpretation: '身处剥落之世而独与正者相应，可以无咎。',
        changing_guidance: '此爻变动时，提示即使大势不好，也可以选择站对的一边。',
      },
      {
        position: 4,
        name: '六四',
        classical: '剥床以肤，凶。',
        modern_interpretation: '剥蚀已及肌肤，祸患切身——凶。',
        changing_guidance: '此爻变动时，警示危险已经贴身，立即避害。',
      },
      {
        position: 5,
        name: '六五',
        classical: '贯鱼，以宫人宠，无不利。',
        modern_interpretation: '如串鱼般依序引众而进，转而顺从正道——无所不利。',
        changing_guidance: '此爻变动时，提示把散乱的力量组织起来，归入正轨。',
      },
      {
        position: 6,
        name: '上九',
        classical: '硕果不食，君子得舆，小人剥庐。',
        modern_interpretation:
          '硕大的果实未被吃掉，生机犹存。君子得众而载，小人则连容身之处也剥尽。',
        changing_guidance: '此爻变动时，提示保住最后的种子，它是下一轮的开始。',
      },
    ],
  },
  // #24 复 — 地雷
  {
    number: 24,
    name: { chinese: '复', pinyin: 'fù', english: 'Return' },
    trigrams: { upper: '坤 (地)', lower: '震 (雷)' },
    judgment: {
      classical: '复：亨。出入无疾，朋来无咎。反复其道，七日来复。利有攸往。',
      modern_interpretation:
        '阳气回复，亨通。出入无碍，同类渐来。往复有其周期，转机如期而至——利于有所前往。',
      keywords: ['回归', '转机', '周期', '新生'],
    },
    image: {
      classical: '雷在地中，复；先王以至日闭关，商旅不行，后不省方。',
      modern_interpretation: '雷藏地中，阳气初回；先王据此在冬至闭关静养，商旅止行，君主不巡四方。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '不远复，无祗悔，元吉。',
        modern_interpretation: '走得不远就回归正道，不至于悔恨——大吉。',
        changing_guidance: '此爻变动时，提示发现偏了就立刻回头，代价最小。',
      },
      {
        position: 2,
        name: '六二',
        classical: '休复，吉。',
        modern_interpretation: '美好地回归，亲近仁者——吉。',
        changing_guidance: '此爻变动时，提示靠近好的榜样，回归更顺。',
      },
      {
        position: 3,
        name: '六三',
        classical: '频复，厉，无咎。',
        modern_interpretation: '屡次偏离又屡次回归，虽有危厉，回归本身无咎。',
        changing_guidance: '此爻变动时，提示反复不可怕，每次回来都算数。',
      },
      {
        position: 4,
        name: '六四',
        classical: '中行独复。',
        modern_interpretation: '行于众人之中，却能独自回归正道。',
        changing_guidance: '此爻变动时，提示哪怕周围没人同行，也走自己的正路。',
      },
      {
        position: 5,
        name: '六五',
        classical: '敦复，无悔。',
        modern_interpretation: '敦厚笃实地回归，无所懊悔。',
        changing_guidance: '此爻变动时，提示把回归落实成习惯，而非一时冲动。',
      },
      {
        position: 6,
        name: '上六',
        classical: '迷复，凶，有灾眚。用行师，终有大败；以其国君凶，至于十年不克征。',
        modern_interpretation: '迷途不返，凶，有灾祸。此时兴师必大败，久久难以振作。',
        changing_guidance: '此爻变动时，警示一错到底的代价极大，趁早回头。',
      },
    ],
  },
]
