// Hexagrams #9–#16 — King Wen order.
// Classical texts follow the received text (通行本); authored fields match the
// register of the original entries. #13 同人 ported verbatim.

import type { HexagramEntry } from '../schema'

export const HEXAGRAMS_09_16: HexagramEntry[] = [
  // #9 小畜 — 风天
  {
    number: 9,
    name: { chinese: '小畜', pinyin: 'xiǎo xù', english: 'Small Taming' },
    trigrams: { upper: '巽 (风)', lower: '乾 (天)' },
    judgment: {
      classical: '小畜：亨。密云不雨，自我西郊。',
      modern_interpretation: '小有蓄积，亨通。浓云密布却还未下雨——力量在积累，时机尚未成熟。',
      keywords: ['蓄积', '未成', '耐心', '渐进'],
    },
    image: {
      classical: '风行天上，小畜；君子以懿文德。',
      modern_interpretation: '风行天上，蓄而未发；君子据此修美文德，在小处涵养自己。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '复自道，何其咎？吉。',
        modern_interpretation: '沿着自己的正道回归，有什么过错呢——吉。',
        changing_guidance: '此爻变动时，提示回到自己的节奏，不必勉强跟随。',
      },
      {
        position: 2,
        name: '九二',
        classical: '牵复，吉。',
        modern_interpretation: '与同道携手回归，吉。',
        changing_guidance: '此爻变动时，提示找同路人一起回到正轨。',
      },
      {
        position: 3,
        name: '九三',
        classical: '舆说辐，夫妻反目。',
        modern_interpretation: '车轮脱了辐条，夫妻反目。强行前进，内部先出问题。',
        changing_guidance: '此爻变动时，警示先修复内部关系，再谈前进。',
      },
      {
        position: 4,
        name: '六四',
        classical: '有孚，血去惕出，无咎。',
        modern_interpretation: '以诚信化解，忧惧消散，没有过错。',
        changing_guidance: '此爻变动时，提示坦诚是化解紧张的最短路径。',
      },
      {
        position: 5,
        name: '九五',
        classical: '有孚挛如，富以其邻。',
        modern_interpretation: '诚信相连，与邻共富。',
        changing_guidance: '此爻变动时，提示把资源分享出去，蓄积才有意义。',
      },
      {
        position: 6,
        name: '上九',
        classical: '既雨既处，尚德载，妇贞厉。月几望，君子征凶。',
        modern_interpretation: '雨已下，蓄积已满。满则将溢，此时再进则凶。',
        changing_guidance: '此爻变动时，警示目标已达，见好就收。',
      },
    ],
  },
  // #10 履 — 天泽
  {
    number: 10,
    name: { chinese: '履', pinyin: 'lǚ', english: 'Treading' },
    trigrams: { upper: '乾 (天)', lower: '兑 (泽)' },
    judgment: {
      classical: '履虎尾，不咥人，亨。',
      modern_interpretation: '踩着老虎尾巴走路，老虎却不咬人——以谦谨之姿行险地，亨通。',
      keywords: ['谨慎', '礼节', '行险', '分寸'],
    },
    image: {
      classical: '上天下泽，履；君子以辨上下，定民志。',
      modern_interpretation: '天在上、泽在下，位分自然；君子据此辨明上下秩序，安定人心。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '素履，往无咎。',
        modern_interpretation: '以朴素的本色行走，前往无咎。',
        changing_guidance: '此爻变动时，提示以本来面目行事，简单反而安全。',
      },
      {
        position: 2,
        name: '九二',
        classical: '履道坦坦，幽人贞吉。',
        modern_interpretation: '走在平坦大道上，恬静自守的人守正即吉。',
        changing_guidance: '此爻变动时，提示低调走自己的路，不必声张。',
      },
      {
        position: 3,
        name: '六三',
        classical: '眇能视，跛能履。履虎尾，咥人，凶。武人为于大君。',
        modern_interpretation: '眼弱偏要远视，脚跛偏要疾行——高估自己而踩虎尾，就会被咬。',
        changing_guidance: '此爻变动时，警示看清自己的实际能力，别逞强犯险。',
      },
      {
        position: 4,
        name: '九四',
        classical: '履虎尾，愬愬，终吉。',
        modern_interpretation: '踩到虎尾而心存戒惧，谨慎前行，终吉。',
        changing_guidance: '此爻变动时，提示保持敬畏地推进，危险反而可控。',
      },
      {
        position: 5,
        name: '九五',
        classical: '夬履，贞厉。',
        modern_interpretation: '行事过于果决，即使守正也有危险。',
        changing_guidance: '此爻变动时，警示决断太快太硬，留一点余地。',
      },
      {
        position: 6,
        name: '上九',
        classical: '视履考祥，其旋元吉。',
        modern_interpretation: '回顾来路、检视得失，善始善终——大吉。',
        changing_guidance: '此爻变动时，提示复盘走过的路，是下一程的起点。',
      },
    ],
  },
  // #11 泰 — 地天
  {
    number: 11,
    name: { chinese: '泰', pinyin: 'tài', english: 'Peace' },
    trigrams: { upper: '坤 (地)', lower: '乾 (天)' },
    judgment: {
      classical: '泰：小往大来，吉，亨。',
      modern_interpretation: '天地交通，小的去、大的来——通泰之时，吉而亨。',
      keywords: ['通泰', '交融', '同心', '居安思危'],
    },
    image: {
      classical: '天地交，泰；后以财成天地之道，辅相天地之宜，以左右民。',
      modern_interpretation: '天地之气交融通泰；君主据此裁成天地之道、辅助万物之宜，以安顿民众。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '拔茅茹，以其汇，征吉。',
        modern_interpretation: '拔起茅草，根系相连——与同类一起前进，吉。',
        changing_guidance: '此爻变动时，提示带上同伴一起行动，一荣俱荣。',
      },
      {
        position: 2,
        name: '九二',
        classical: '包荒，用冯河，不遐遗，朋亡，得尚于中行。',
        modern_interpretation:
          '有涵纳荒秽的度量，有徒步过河的果敢，不遗漏远人，不偏私朋党——正合中道。',
        changing_guidance: '此爻变动时，提示以包容与公心做事，是通泰的根基。',
      },
      {
        position: 3,
        name: '九三',
        classical: '无平不陂，无往不复。艰贞无咎，勿恤其孚，于食有福。',
        modern_interpretation: '没有只平不陂的路，没有只往不返的行程。在艰难中守正，无咎有福。',
        changing_guidance: '此爻变动时，提示顺境中记得起伏是常态，提前备好韧性。',
      },
      {
        position: 4,
        name: '六四',
        classical: '翩翩，不富以其邻，不戒以孚。',
        modern_interpretation: '轻快下交，不倚仗财富，以真诚与邻相处。',
        changing_guidance: '此爻变动时，提示放低姿态与人相交，诚意胜过筹码。',
      },
      {
        position: 5,
        name: '六五',
        classical: '帝乙归妹，以祉元吉。',
        modern_interpretation: '帝乙嫁妹，尊贵者谦降下交——福泽绵长，大吉。',
        changing_guidance: '此爻变动时，提示居高位者主动放下身段，能成大好局面。',
      },
      {
        position: 6,
        name: '上六',
        classical: '城复于隍，勿用师。自邑告命，贞吝。',
        modern_interpretation: '城墙倾覆回壕沟，泰极而否。此时不宜强攻，宜收缩自省。',
        changing_guidance: '此爻变动时，警示局面正在翻转，收敛保全为上。',
      },
    ],
  },
  // #12 否 — 天地
  {
    number: 12,
    name: { chinese: '否', pinyin: 'pǐ', english: 'Standstill' },
    trigrams: { upper: '乾 (天)', lower: '坤 (地)' },
    judgment: {
      classical: '否之匪人，不利君子贞，大往小来。',
      modern_interpretation: '闭塞不通之时，小人道长，君子难行——大的去、小的来。',
      keywords: ['闭塞', '守拙', '待时', '自保'],
    },
    image: {
      classical: '天地不交，否；君子以俭德辟难，不可荣以禄。',
      modern_interpretation: '天地之气不相交通；君子据此收敛才德以避祸难，不以禄位为荣。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '拔茅茹，以其汇，贞吉，亨。',
        modern_interpretation: '拔茅连根，与同类一起退守——守正即吉。',
        changing_guidance: '此爻变动时，提示与同道一起退，退也退得有章法。',
      },
      {
        position: 2,
        name: '六二',
        classical: '包承，小人吉，大人否，亨。',
        modern_interpretation: '曲意逢迎，小人以此得利；大人不屑为之，反而亨通。',
        changing_guidance: '此爻变动时，提示不迎合是一种立场，撑住它。',
      },
      {
        position: 3,
        name: '六三',
        classical: '包羞。',
        modern_interpretation: '包藏羞愧——所行不正，心中有愧。',
        changing_guidance: '此爻变动时，提示心里那点不安，正是需要纠正的地方。',
      },
      {
        position: 4,
        name: '九四',
        classical: '有命无咎，畴离祉。',
        modern_interpretation: '奉正当之命而行，无咎，同类都能依附福泽。',
        changing_guidance: '此爻变动时，提示转机初现，顺着正当的路径行动。',
      },
      {
        position: 5,
        name: '九五',
        classical: '休否，大人吉。其亡其亡，系于苞桑。',
        modern_interpretation: '闭塞将止，大人吉。常怀「将亡将亡」的警惕，根基才如丛桑般牢固。',
        changing_guidance: '此爻变动时，提示越接近好转，越要保持危机感。',
      },
      {
        position: 6,
        name: '上九',
        classical: '倾否，先否后喜。',
        modern_interpretation: '倾覆闭塞的局面，先经否塞、后得欢喜。',
        changing_guidance: '此爻变动时，提示黑暗到了尽头，主动破局迎来转变。',
      },
    ],
  },
  // #13 同人 — ported verbatim from the original demo entry.
  {
    number: 13,
    name: { chinese: '同人', pinyin: 'tóng rén', english: 'Fellowship with Men' },
    trigrams: { upper: '乾 (天)', lower: '离 (火)' },
    judgment: {
      classical: '同人于野，亨。利涉大川，利君子贞。',
      modern_interpretation:
        '在更广阔的场域中与人同心，亨通。适合涉越大河，适合君子坚守正道。同行不靠强迫，靠方向一致。',
      keywords: ['同行', '协作', '方向', '坚守'],
    },
    image: {
      classical: '天与火，同人；君子以类族辨物。',
      modern_interpretation: '天在上、火在下，火向上烧，方向与天相合；君子据此分辨同类、识别异同。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '同人于门，无咎。',
        modern_interpretation: '在门口与人同行——刚起步，门户敞开，没有错。',
        changing_guidance: '此爻变动时，提示从开放的起点出发，先建立公开的连接。',
      },
      {
        position: 2,
        name: '六二',
        classical: '同人于宗，吝。',
        modern_interpretation: '只与自己宗族内同行——视野受限，难免遗憾。',
        changing_guidance: '此爻变动时，提示警惕同温层，拓展圈层之外的对话。',
      },
      {
        position: 3,
        name: '九三',
        classical: '伏戎于莽，升其高陵，三岁不兴。',
        modern_interpretation:
          '把兵藏进草丛，登上高陵远望，三年都不轻举妄动。主动停一停，不是放弃，是让真正的同行人显形。',
        changing_guidance:
          '此爻变动时——核心提示：与其急于推进，不如先停下来观察方向与同行人是否真正一致。',
      },
      {
        position: 4,
        name: '九四',
        classical: '乘其墉，弗克攻，吉。',
        modern_interpretation: '登上城墙却没有发动进攻——克制即吉。势已成，可以不打。',
        changing_guidance: '此爻变动时，强调克制是更高阶的力量。',
      },
      {
        position: 5,
        name: '九五',
        classical: '同人，先号咷而后笑。大师克相遇。',
        modern_interpretation: '同行先经痛哭后能相视而笑——付出大代价后终能相遇。',
        changing_guidance: '此爻变动时，提示当下的拉扯是通向真正同行的必经路。',
      },
      {
        position: 6,
        name: '上九',
        classical: '同人于郊，无悔。',
        modern_interpretation: '在郊外与人同行——更广阔的场域中，无所遗憾。',
        changing_guidance: '此爻变动时，提示把场域再放大一些，无须计较得失。',
      },
    ],
    relationships: { opposite: 7, nuclear_upper: 44, nuclear_lower: 44 },
  },
  // #14 大有 — 火天
  {
    number: 14,
    name: { chinese: '大有', pinyin: 'dà yǒu', english: 'Great Possession' },
    trigrams: { upper: '离 (火)', lower: '乾 (天)' },
    judgment: {
      classical: '大有：元亨。',
      modern_interpretation: '大有所获，盛大丰有——至为亨通。',
      keywords: ['丰有', '光明', '谦顺', '共享'],
    },
    image: {
      classical: '火在天上，大有；君子以遏恶扬善，顺天休命。',
      modern_interpretation: '火在天上，普照万物；君子据此遏止恶行、弘扬善行，顺应天道。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '无交害，匪咎，艰则无咎。',
        modern_interpretation: '尚未卷入利害纠葛，本无过错；常念艰难，更无咎。',
        changing_guidance: '此爻变动时，提示富足初期保持简单与警醒。',
      },
      {
        position: 2,
        name: '九二',
        classical: '大车以载，有攸往，无咎。',
        modern_interpretation: '大车足以载重，可以有所前往，无咎。',
        changing_guidance: '此爻变动时，提示能力足以承担，放心把担子接过来。',
      },
      {
        position: 3,
        name: '九三',
        classical: '公用亨于天子，小人弗克。',
        modern_interpretation: '公侯以丰有奉献于天子；小人则难当此任。',
        changing_guidance: '此爻变动时，提示把所得贡献于更大的事，方配得上所有。',
      },
      {
        position: 4,
        name: '九四',
        classical: '匪其彭，无咎。',
        modern_interpretation: '不炫耀自己的盛大，没有过错。',
        changing_guidance: '此爻变动时，提示越丰盛越要收敛锋芒。',
      },
      {
        position: 5,
        name: '六五',
        classical: '厥孚交如，威如，吉。',
        modern_interpretation: '以诚信与人相交，又自有威严——吉。',
        changing_guidance: '此爻变动时，提示诚信与分寸并用，宽而有威。',
      },
      {
        position: 6,
        name: '上九',
        classical: '自天祐之，吉无不利。',
        modern_interpretation: '像有上天护佑，吉，无所不利。',
        changing_guidance: '此爻变动时，提示顺道而行的人，运气也会站在这边。',
      },
    ],
  },
  // #15 谦 — 地山
  {
    number: 15,
    name: { chinese: '谦', pinyin: 'qiān', english: 'Modesty' },
    trigrams: { upper: '坤 (地)', lower: '艮 (山)' },
    judgment: {
      classical: '谦：亨，君子有终。',
      modern_interpretation: '谦逊，亨通。君子谦而不懈，必有善终。',
      keywords: ['谦逊', '低处', '持久', '善终'],
    },
    image: {
      classical: '地中有山，谦；君子以裒多益寡，称物平施。',
      modern_interpretation: '高山藏于地中，大而不显；君子据此取多补少，称量事物而公平施予。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '谦谦君子，用涉大川，吉。',
        modern_interpretation: '谦而又谦的君子，以此渡越大川也吉。',
        changing_guidance: '此爻变动时，提示把姿态放到最低，路反而最宽。',
      },
      {
        position: 2,
        name: '六二',
        classical: '鸣谦，贞吉。',
        modern_interpretation: '谦德发于声、形于外，守正即吉。',
        changing_guidance: '此爻变动时，提示由衷的谦逊自然会被听见。',
      },
      {
        position: 3,
        name: '九三',
        classical: '劳谦，君子有终，吉。',
        modern_interpretation: '有功劳而依然谦逊，君子由此善终——吉。',
        changing_guidance: '此爻变动时，提示功劳越大越要谦，这是守住成果的方式。',
      },
      {
        position: 4,
        name: '六四',
        classical: '无不利，撝谦。',
        modern_interpretation: '无所不利，发挥谦德而已。',
        changing_guidance: '此爻变动时，提示把谦逊落实到每个举动里。',
      },
      {
        position: 5,
        name: '六五',
        classical: '不富以其邻，利用侵伐，无不利。',
        modern_interpretation: '不倚仗财富也能得邻里相从；对不服者以正讨之，无所不利。',
        changing_guidance: '此爻变动时，提示谦不等于软弱，该坚决时要坚决。',
      },
      {
        position: 6,
        name: '上六',
        classical: '鸣谦，利用行师，征邑国。',
        modern_interpretation: '谦名远播，却仍未得志；宜先整治自己的领地。',
        changing_guidance: '此爻变动时，提示从自己能改变的范围做起。',
      },
    ],
  },
  // #16 豫 — 雷地
  {
    number: 16,
    name: { chinese: '豫', pinyin: 'yù', english: 'Enthusiasm' },
    trigrams: { upper: '震 (雷)', lower: '坤 (地)' },
    judgment: {
      classical: '豫：利建侯行师。',
      modern_interpretation: '欢愉振奋之时，顺势而动——适合建侯封国、兴师动众这样的大动作。',
      keywords: ['振奋', '顺势', '有备', '警惕安逸'],
    },
    image: {
      classical: '雷出地奋，豫；先王以作乐崇德，殷荐之上帝，以配祖考。',
      modern_interpretation:
        '春雷破土而出，万物振奋；先王据此制礼作乐、尊崇德行，隆重地献祭天帝与祖先。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '鸣豫，凶。',
        modern_interpretation: '得意忘形，把欢愉挂在嘴上——凶。',
        changing_guidance: '此爻变动时，警示炫耀安乐最招祸，收起得意。',
      },
      {
        position: 2,
        name: '六二',
        classical: '介于石，不终日，贞吉。',
        modern_interpretation: '耿介如石，见机而作，不待终日——守正即吉。',
        changing_guidance: '此爻变动时，提示在安逸中保持敏锐，觉察要快。',
      },
      {
        position: 3,
        name: '六三',
        classical: '盱豫，悔。迟有悔。',
        modern_interpretation: '仰人鼻息求欢愉，会后悔；迟迟不改，悔上加悔。',
        changing_guidance: '此爻变动时，提示依附他人的快乐靠不住，早些自立。',
      },
      {
        position: 4,
        name: '九四',
        classical: '由豫，大有得。勿疑，朋盍簪。',
        modern_interpretation: '众人因你而欢愉，大有所得。不要多疑，朋友自会聚拢。',
        changing_guidance: '此爻变动时，提示信任伙伴，开放合作。',
      },
      {
        position: 5,
        name: '六五',
        classical: '贞疾，恒不死。',
        modern_interpretation: '沉溺安乐如久病缠身，虽不至亡，也难振作。',
        changing_guidance: '此爻变动时，警示安逸正在消磨你，需要一点硬约束。',
      },
      {
        position: 6,
        name: '上六',
        classical: '冥豫，成有渝，无咎。',
        modern_interpretation: '昏昧地沉迷欢愉；若能及时改变，尚可无咎。',
        changing_guidance: '此爻变动时，提示现在回头还来得及。',
      },
    ],
  },
]
