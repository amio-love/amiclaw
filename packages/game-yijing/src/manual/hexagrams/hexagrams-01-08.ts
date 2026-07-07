// Hexagrams #1–#8 — King Wen order.
//
// Classical texts (卦辞 / 大象 / 爻辞) follow the received text (通行本) verbatim.
// `modern_interpretation` / `changing_guidance` / `keywords` are authored product
// copy in the register established by the original #1 / #13 / #25 entries.
// 乾 / 坤 additionally carry 用九 / 用六 via `extra_line` (schema.ts) — read in
// place of the six 爻辞 when a cast in 乾/坤 has all six lines changing.

import type { HexagramEntry } from '../schema'

export const HEXAGRAMS_01_08: HexagramEntry[] = [
  // #1 乾 — ported verbatim from the original demo entry (yijing-oracle-design.md).
  {
    number: 1,
    name: { chinese: '乾', pinyin: 'qián', english: 'The Creative / Heaven' },
    trigrams: { upper: '乾 (天)', lower: '乾 (天)' },
    judgment: {
      classical: '乾：元，亨，利，贞。',
      modern_interpretation:
        '乾卦代表纯阳之力，创造与开始的能量。元始、亨通、和谐、正固——四德俱全。',
      keywords: ['创造', '力量', '开始', '坚持'],
    },
    image: {
      classical: '天行健，君子以自强不息。',
      modern_interpretation: '天体运行刚健不止，人应效法天道，持续自我激励、永不懈怠。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '潜龙勿用。',
        modern_interpretation: '力量处于潜伏期，时机未到不宜行动。积蓄能量，等待机会。',
        changing_guidance: '此爻变动时，提示当前不是行动的时机，宜蛰伏积累。',
      },
      {
        position: 2,
        name: '九二',
        classical: '见龙在田，利见大人。',
        modern_interpretation: '才能开始显现，适合寻找导师或合作者。',
        changing_guidance: '此爻变动时，暗示与重要人物的相遇或合作契机将至。',
      },
      {
        position: 3,
        name: '九三',
        classical: '君子终日乾乾，夕惕若厉，无咎。',
        modern_interpretation: '白天勤勉不辍，夜晚警惕反省，虽有危险但不会犯错。',
        changing_guidance: '此爻变动时，强调谨慎与勤勉的重要性——努力本身就是方向。',
      },
      {
        position: 4,
        name: '九四',
        classical: '或跃在渊，无咎。',
        modern_interpretation: '在跳跃与深潜之间选择，两者皆无过错。关键是审时度势。',
        changing_guidance: '此爻变动时，面临重大抉择，但无论哪个方向都不会是错的。',
      },
      {
        position: 5,
        name: '九五',
        classical: '飞龙在天，利见大人。',
        modern_interpretation: '达到最佳状态，适合与志同道合者合作共事。',
        changing_guidance: '此爻变动时，正处于最有影响力的时刻，把握机会。',
      },
      {
        position: 6,
        name: '上九',
        classical: '亢龙有悔。',
        modern_interpretation: '到达极高之处反有遗憾。过刚则折，物极必反。',
        changing_guidance: '此爻变动时，警示当前可能已经走得太远，需要适度收敛。',
      },
    ],
    extra_line: {
      label: '用九',
      classical: '见群龙无首，吉。',
      modern_interpretation: '群龙齐现而不争居首——刚健至极却能不逞强，吉。',
      changing_guidance: '六爻皆变时，以此代读：放下「必须领头」的执念，不居首反而成事。',
    },
    relationships: { opposite: 2, nuclear_upper: 1, nuclear_lower: 1 },
  },
  // #2 坤 — 地
  {
    number: 2,
    name: { chinese: '坤', pinyin: 'kūn', english: 'The Receptive / Earth' },
    trigrams: { upper: '坤 (地)', lower: '坤 (地)' },
    judgment: {
      classical: '坤：元亨，利牝马之贞。君子有攸往，先迷后得主，利。西南得朋，东北丧朋。安贞吉。',
      modern_interpretation:
        '大地般的承载之力，亨通。像母马一样温顺而持久地走正道。有所前往时，抢先会迷路，跟随则找到主导；安于正道即吉。',
      keywords: ['承载', '柔顺', '跟随', '厚德'],
    },
    image: {
      classical: '地势坤，君子以厚德载物。',
      modern_interpretation: '大地形势宽厚和顺，人应效法大地，以深厚的德行承载万物。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '履霜，坚冰至。',
        modern_interpretation: '踩到霜，就该知道坚冰将至。微小的迹象里已有大势的方向。',
        changing_guidance: '此爻变动时，提示留意刚刚出现的苗头，趋势正在成形。',
      },
      {
        position: 2,
        name: '六二',
        classical: '直方大，不习无不利。',
        modern_interpretation: '正直、方正、宽大——不刻意造作，也无所不利。',
        changing_guidance: '此爻变动时，提示守住本色即可，无须额外表演。',
      },
      {
        position: 3,
        name: '六三',
        classical: '含章可贞。或从王事，无成有终。',
        modern_interpretation: '内藏才华而守正。若辅助他人做事，不居功也能善终。',
        changing_guidance: '此爻变动时，提示收敛锋芒，把事做成比抢功重要。',
      },
      {
        position: 4,
        name: '六四',
        classical: '括囊，无咎无誉。',
        modern_interpretation: '扎紧口袋，谨慎缄默——没有过错，也没有称誉。',
        changing_guidance: '此爻变动时，提示此刻宜谨言慎行，先求无过。',
      },
      {
        position: 5,
        name: '六五',
        classical: '黄裳，元吉。',
        modern_interpretation: '黄色的下裳，居中而不张扬——大吉。',
        changing_guidance: '此爻变动时，提示以谦和居于要位，反而最稳。',
      },
      {
        position: 6,
        name: '上六',
        classical: '龙战于野，其血玄黄。',
        modern_interpretation: '龙在旷野交战，血染玄黄。阴盛到极点，冲突难免。',
        changing_guidance: '此爻变动时，警示对峙已到临界，宜及早退让化解。',
      },
    ],
    extra_line: {
      label: '用六',
      classical: '利永贞。',
      modern_interpretation: '利于永远守持正道——柔顺之德，以恒久的坚定来收束。',
      changing_guidance: '六爻皆变时，以此代读：把柔顺沉淀为长期的坚定，一直正下去。',
    },
  },
  // #3 屯 — 水雷
  {
    number: 3,
    name: { chinese: '屯', pinyin: 'zhūn', english: 'Difficulty at the Beginning' },
    trigrams: { upper: '坎 (水)', lower: '震 (雷)' },
    judgment: {
      classical: '屯：元亨，利贞。勿用有攸往，利建侯。',
      modern_interpretation:
        '万物初生，充满生机也充满艰难。大方向亨通，但此刻不宜贸然远行，适合先立好根基、找好帮手。',
      keywords: ['初创', '艰难', '扎根', '蓄力'],
    },
    image: {
      classical: '云雷，屯；君子以经纶。',
      modern_interpretation: '乌云与雷声交织，时局初创而未定；君子据此梳理头绪、经营筹划。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '磐桓，利居贞，利建侯。',
        modern_interpretation: '徘徊不进，宜安守正道，先建立根据地。',
        changing_guidance: '此爻变动时，提示起步阶段先站稳，不急着扩张。',
      },
      {
        position: 2,
        name: '六二',
        classical: '屯如邅如，乘马班如。匪寇婚媾，女子贞不字，十年乃字。',
        modern_interpretation:
          '进退两难，骑马盘旋。来者是求亲的而非劫掠的；女子守正不轻许，十年才应允。',
        changing_guidance: '此爻变动时，提示重要的承诺可以慢一点给。',
      },
      {
        position: 3,
        name: '六三',
        classical: '即鹿无虞，惟入于林中，君子几不如舍，往吝。',
        modern_interpretation:
          '没有向导就追鹿，只会陷进林子深处。君子见机，不如放手，硬追会有遗憾。',
        changing_guidance: '此爻变动时，提示缺少引路人的目标，暂时放下更明智。',
      },
      {
        position: 4,
        name: '六四',
        classical: '乘马班如，求婚媾，往吉，无不利。',
        modern_interpretation: '骑马盘旋，前去求亲——去则吉，无所不利。',
        changing_guidance: '此爻变动时，提示主动去连接对的人，时机是合适的。',
      },
      {
        position: 5,
        name: '九五',
        classical: '屯其膏，小贞吉，大贞凶。',
        modern_interpretation: '恩泽施展不开。小事守正尚吉，大动作反而凶。',
        changing_guidance: '此爻变动时，提示先做小而确定的事，不做大而冒进的事。',
      },
      {
        position: 6,
        name: '上六',
        classical: '乘马班如，泣血涟如。',
        modern_interpretation: '骑马盘旋不前，泣血涟涟。困局到了尽头处的悲鸣。',
        changing_guidance: '此爻变动时，警示旧路已尽，与其硬撑不如换一条路。',
      },
    ],
  },
  // #4 蒙 — 山水
  {
    number: 4,
    name: { chinese: '蒙', pinyin: 'méng', english: 'Youthful Folly' },
    trigrams: { upper: '艮 (山)', lower: '坎 (水)' },
    judgment: {
      classical: '蒙：亨。匪我求童蒙，童蒙求我。初筮告，再三渎，渎则不告。利贞。',
      modern_interpretation:
        '蒙昧待启，亨通。学习的主动权在求学的一方；第一次诚心问，就认真答，反复轻慢地问，就不再答。守正有利。',
      keywords: ['启蒙', '求教', '诚心', '规矩'],
    },
    image: {
      classical: '山下出泉，蒙；君子以果行育德。',
      modern_interpretation: '山下涌出泉水，涓流待引；君子据此以果决的行动培育德行。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '发蒙，利用刑人，用说桎梏，以往吝。',
        modern_interpretation: '启蒙之初，立规矩是为了解除束缚；一味放任下去会有遗憾。',
        changing_guidance: '此爻变动时，提示先立边界，再谈自由。',
      },
      {
        position: 2,
        name: '九二',
        classical: '包蒙吉，纳妇吉，子克家。',
        modern_interpretation: '包容蒙昧，吉；接纳他人，吉。能担起一家之事。',
        changing_guidance: '此爻变动时，提示以包容带人，胜过以苛责带人。',
      },
      {
        position: 3,
        name: '六三',
        classical: '勿用取女，见金夫，不有躬，无攸利。',
        modern_interpretation: '见利就忘了自己的人，不宜与之结盟，没有好处。',
        changing_guidance: '此爻变动时，警示远离只被利益驱动的合作对象。',
      },
      {
        position: 4,
        name: '六四',
        classical: '困蒙，吝。',
        modern_interpretation: '困在蒙昧里，远离良师益友——有遗憾。',
        changing_guidance: '此爻变动时，提示主动走近能让你成长的人。',
      },
      {
        position: 5,
        name: '六五',
        classical: '童蒙，吉。',
        modern_interpretation: '保持孩童般的虚心求教——吉。',
        changing_guidance: '此爻变动时，提示放下身段去问，是此刻最快的路。',
      },
      {
        position: 6,
        name: '上九',
        classical: '击蒙，不利为寇，利御寇。',
        modern_interpretation: '以猛击破除蒙昧。过猛则成伤害，用于防守纠偏才有利。',
        changing_guidance: '此爻变动时，提示纠错要有力度，但别越界成攻击。',
      },
    ],
  },
  // #5 需 — 水天
  {
    number: 5,
    name: { chinese: '需', pinyin: 'xū', english: 'Waiting' },
    trigrams: { upper: '坎 (水)', lower: '乾 (天)' },
    judgment: {
      classical: '需：有孚，光亨，贞吉。利涉大川。',
      modern_interpretation:
        '等待需要信心。心怀诚信，光明亨通，守正即吉；时机到来时，适合涉越大河。',
      keywords: ['等待', '信心', '时机', '从容'],
    },
    image: {
      classical: '云上于天，需；君子以饮食宴乐。',
      modern_interpretation: '云已升上天，雨尚未落；君子据此安然饮食休养，在等待中养精蓄锐。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '需于郊，利用恒，无咎。',
        modern_interpretation: '在远郊等待，离险尚远。保持平常心，没有过错。',
        changing_guidance: '此爻变动时，提示保持节奏，不必提前焦虑。',
      },
      {
        position: 2,
        name: '九二',
        classical: '需于沙，小有言，终吉。',
        modern_interpretation: '在沙滩上等待，离险渐近，难免有些闲话，最终仍吉。',
        changing_guidance: '此爻变动时，提示别被议论带乱阵脚，稳住即可。',
      },
      {
        position: 3,
        name: '九三',
        classical: '需于泥，致寇至。',
        modern_interpretation: '在泥泞中等待，离险太近，招来了麻烦。',
        changing_guidance: '此爻变动时，警示位置太冒进了，往回撤一步。',
      },
      {
        position: 4,
        name: '六四',
        classical: '需于血，出自穴。',
        modern_interpretation: '已陷入险境流血，但顺势而退，能从险穴中脱身。',
        changing_guidance: '此爻变动时，提示及时止损，退出比硬撑更需要勇气。',
      },
      {
        position: 5,
        name: '九五',
        classical: '需于酒食，贞吉。',
        modern_interpretation: '在酒食安泰中等待，守正即吉。等待本身也是一种笃定。',
        changing_guidance: '此爻变动时，提示安心休整，该来的会来。',
      },
      {
        position: 6,
        name: '上六',
        classical: '入于穴，有不速之客三人来，敬之终吉。',
        modern_interpretation: '落入险穴，不速之客三人到来。以敬相待，终得吉。',
        changing_guidance: '此爻变动时，提示对意料之外的来者保持敬意，转机可能就在其中。',
      },
    ],
  },
  // #6 讼 — 天水
  {
    number: 6,
    name: { chinese: '讼', pinyin: 'sòng', english: 'Conflict' },
    trigrams: { upper: '乾 (天)', lower: '坎 (水)' },
    judgment: {
      classical: '讼：有孚窒惕，中吉，终凶。利见大人，不利涉大川。',
      modern_interpretation:
        '争讼之时，纵然占理也要警惕。适可而止则吉，争到底则凶。宜求公正之人裁断，不宜此时冒险远行。',
      keywords: ['争讼', '克制', '止争', '审慎'],
    },
    image: {
      classical: '天与水违行，讼；君子以作事谋始。',
      modern_interpretation:
        '天向上、水向下，方向相背而生争端；君子据此在做事之初就谋划清楚，从源头减少纷争。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '不永所事，小有言，终吉。',
        modern_interpretation: '不把争端拖长，虽有些口舌，最终吉。',
        changing_guidance: '此爻变动时，提示小摩擦早点了结，别让它发酵。',
      },
      {
        position: 2,
        name: '九二',
        classical: '不克讼，归而逋。其邑人三百户，无眚。',
        modern_interpretation: '争不过就退回来避让，安守自己的小地方，反而无灾。',
        changing_guidance: '此爻变动时，提示实力不及时退一步，保全比争胜重要。',
      },
      {
        position: 3,
        name: '六三',
        classical: '食旧德，贞厉，终吉。或从王事，无成。',
        modern_interpretation: '安守既有的本分，虽有风险，终吉。辅助他人做事，不居功。',
        changing_guidance: '此爻变动时，提示守住已有的，不去抢不属于自己的。',
      },
      {
        position: 4,
        name: '九四',
        classical: '不克讼，复即命，渝，安贞吉。',
        modern_interpretation: '争不赢，回头顺应正理，改变初衷，安于正道即吉。',
        changing_guidance: '此爻变动时，提示回心转意不丢人，转向即是转机。',
      },
      {
        position: 5,
        name: '九五',
        classical: '讼，元吉。',
        modern_interpretation: '居中持正地裁断争讼——大吉。',
        changing_guidance: '此爻变动时，提示把争端交给公正的裁决，是最好的出路。',
      },
      {
        position: 6,
        name: '上九',
        classical: '或锡之鞶带，终朝三褫之。',
        modern_interpretation: '靠争讼赢来的荣耀，一天之内也可能被剥夺三次。',
        changing_guidance: '此爻变动时，警示争来的东西难以久持，别把胜诉当胜利。',
      },
    ],
  },
  // #7 师 — 地水
  {
    number: 7,
    name: { chinese: '师', pinyin: 'shī', english: 'The Army' },
    trigrams: { upper: '坤 (地)', lower: '坎 (水)' },
    judgment: {
      classical: '师：贞，丈人吉，无咎。',
      modern_interpretation: '兴师动众，必须师出有名，并由老成持重的人统领，才吉而无咎。',
      keywords: ['统领', '纪律', '正名', '担当'],
    },
    image: {
      classical: '地中有水，师；君子以容民畜众。',
      modern_interpretation: '大地中蓄藏着水，如众之所聚；君子据此容纳民众、蓄养力量。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '师出以律，否臧凶。',
        modern_interpretation: '出师首在纪律。军纪不严，再好的局面也会转凶。',
        changing_guidance: '此爻变动时，提示先立规矩，再谈行动。',
      },
      {
        position: 2,
        name: '九二',
        classical: '在师中，吉，无咎，王三锡命。',
        modern_interpretation: '身在军中居中调度，吉而无咎，屡受信任与嘉奖。',
        changing_guidance: '此爻变动时，提示在其位谋其政，担当会被看见。',
      },
      {
        position: 3,
        name: '六三',
        classical: '师或舆尸，凶。',
        modern_interpretation: '军中政出多门，或有大败载尸而归——凶。',
        changing_guidance: '此爻变动时，警示多头指挥是大忌，先理顺权责。',
      },
      {
        position: 4,
        name: '六四',
        classical: '师左次，无咎。',
        modern_interpretation: '军队后撤驻扎，避其锋芒，没有过错。',
        changing_guidance: '此爻变动时，提示有序撤退也是一种打法。',
      },
      {
        position: 5,
        name: '六五',
        classical: '田有禽，利执言，无咎。长子帅师，弟子舆尸，贞凶。',
        modern_interpretation: '田中有禽，出师有名则无咎。用对统帅则胜，用错人则败。',
        changing_guidance: '此爻变动时，提示行动要有正当理由，用人要看能力。',
      },
      {
        position: 6,
        name: '上六',
        classical: '大君有命，开国承家，小人勿用。',
        modern_interpretation: '论功行赏、分封安顿之时，切不可重用无德之人。',
        changing_guidance: '此爻变动时，提示收尾阶段的人事安排，决定成果能否守住。',
      },
    ],
  },
  // #8 比 — 水地
  {
    number: 8,
    name: { chinese: '比', pinyin: 'bǐ', english: 'Holding Together' },
    trigrams: { upper: '坎 (水)', lower: '坤 (地)' },
    judgment: {
      classical: '比：吉。原筮，元永贞，无咎。不宁方来，后夫凶。',
      modern_interpretation:
        '亲近依附，吉。审慎选择追随的对象，长久守正则无咎。犹疑不定、来得太迟的人有凶。',
      keywords: ['亲附', '选择', '及时', '同盟'],
    },
    image: {
      classical: '地上有水，比；先王以建万国，亲诸侯。',
      modern_interpretation: '水在地上，相亲相依；先王据此封建万国、亲近诸侯。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '有孚比之，无咎。有孚盈缶，终来有它，吉。',
        modern_interpretation: '以诚信相亲附，无咎。诚意充盈，终会带来意外之喜。',
        changing_guidance: '此爻变动时，提示以诚待人，回报会超出预期。',
      },
      {
        position: 2,
        name: '六二',
        classical: '比之自内，贞吉。',
        modern_interpretation: '发自内心地亲附，守正即吉。',
        changing_guidance: '此爻变动时，提示认同要发自内心，而非表面应付。',
      },
      {
        position: 3,
        name: '六三',
        classical: '比之匪人。',
        modern_interpretation: '亲附了不该亲附的人。',
        changing_guidance: '此爻变动时，警示看清身边的关系，及时调整站位。',
      },
      {
        position: 4,
        name: '六四',
        classical: '外比之，贞吉。',
        modern_interpretation: '向外亲附贤者，守正即吉。',
        changing_guidance: '此爻变动时，提示走出小圈子，向更值得的人靠拢。',
      },
      {
        position: 5,
        name: '九五',
        classical: '显比。王用三驱，失前禽，邑人不诫，吉。',
        modern_interpretation: '光明正大地亲附。狩猎网开一面，去留自愿，不施压迫——吉。',
        changing_guidance: '此爻变动时，提示留出选择的自由，来的才是真同盟。',
      },
      {
        position: 6,
        name: '上六',
        classical: '比之无首，凶。',
        modern_interpretation: '亲附而没有领头人，群龙无首——凶。',
        changing_guidance: '此爻变动时，警示同盟缺了主心骨，先解决牵头问题。',
      },
    ],
  },
]
