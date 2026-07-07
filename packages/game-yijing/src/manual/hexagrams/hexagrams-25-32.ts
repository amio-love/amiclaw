// Hexagrams #25–#32 — King Wen order.
// Classical texts follow the received text (通行本); authored fields match the
// register of the original entries. #25 无妄 ported verbatim.

import type { HexagramEntry } from '../schema'

export const HEXAGRAMS_25_32: HexagramEntry[] = [
  // #25 无妄 — ported verbatim from the original demo entry.
  {
    number: 25,
    name: { chinese: '无妄', pinyin: 'wú wàng', english: 'Innocence / The Unexpected' },
    trigrams: { upper: '乾 (天)', lower: '震 (雷)' },
    judgment: {
      classical: '无妄，元亨，利贞。其匪正有眚，不利有攸往。',
      modern_interpretation: '不妄动则大亨通，利于坚守正道。若动机不正便招灾，此时不宜远行或新拓。',
      keywords: ['真诚', '不妄动', '正道', '审慎'],
    },
    image: {
      classical: '天下雷行，物与无妄；先王以茂对时育万物。',
      modern_interpretation: '天下雷震，万物各自无妄，应时而生；先王据此顺时养育万物。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '无妄，往吉。',
        modern_interpretation: '不存妄念地前往——吉。',
        changing_guidance: '此爻变动时，提示心存正念地行动即可顺利。',
      },
      {
        position: 2,
        name: '六二',
        classical: '不耕获，不菑畬，则利有攸往。',
        modern_interpretation: '不刻意耕作收获，不刻意开荒——顺势而行反而有利。',
        changing_guidance: '此爻变动时，提示放下结果焦虑，专注当下。',
      },
      {
        position: 3,
        name: '六三',
        classical: '无妄之灾。或系之牛，行人之得，邑人之灾。',
        modern_interpretation: '无妄之灾——拴住的牛被路人牵走，邑人遭无端损失。',
        changing_guidance: '此爻变动时，提示无端之祸有时难免，需平心面对。',
      },
      {
        position: 4,
        name: '九四',
        classical: '可贞，无咎。',
        modern_interpretation: '可以坚守，没有过错。',
        changing_guidance: '此爻变动时，提示稳守现状即可。',
      },
      {
        position: 5,
        name: '九五',
        classical: '无妄之疾，勿药有喜。',
        modern_interpretation: '无端的小病，不用吃药也会好转。',
        changing_guidance: '此爻变动时，提示有些问题自然消解，不必过度干预。',
      },
      {
        position: 6,
        name: '上九',
        classical: '无妄，行有眚，无攸利。',
        modern_interpretation: '此时再动便招祸，无所利益。',
        changing_guidance: '此爻变动时，明确提示——此刻不动是最优解。',
      },
    ],
    relationships: { opposite: 46, nuclear_upper: 53, nuclear_lower: 53 },
  },
  // #26 大畜 — 山天
  {
    number: 26,
    name: { chinese: '大畜', pinyin: 'dà xù', english: 'Great Taming' },
    trigrams: { upper: '艮 (山)', lower: '乾 (天)' },
    judgment: {
      classical: '大畜：利贞。不家食吉，利涉大川。',
      modern_interpretation:
        '大有蓄积，守正有利。才德当用于天下而非独善其身——出而任事，值得涉险前行。',
      keywords: ['厚积', '养贤', '任事', '克制'],
    },
    image: {
      classical: '天在山中，大畜；君子以多识前言往行，以畜其德。',
      modern_interpretation: '天蓄于山中，所蓄至大；君子据此多研习前人的言行，蓄养自己的德行。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '有厉，利已。',
        modern_interpretation: '前行有危险，适合停下来。',
        changing_guidance: '此爻变动时，提示此刻停住是聪明的选择，无关退缩。',
      },
      {
        position: 2,
        name: '九二',
        classical: '舆说輹。',
        modern_interpretation: '车子卸下轮轴，主动停驶。',
        changing_guidance: '此爻变动时，提示主动降速，把力量留到能用的时候。',
      },
      {
        position: 3,
        name: '九三',
        classical: '良马逐，利艰贞。曰闲舆卫，利有攸往。',
        modern_interpretation: '良马驰逐，可以前进了；仍要在艰难中守正、日日操练防卫，再有所往。',
        changing_guidance: '此爻变动时，提示机会开了口，带着训练有素的准备进入。',
      },
      {
        position: 4,
        name: '六四',
        classical: '童牛之牿，元吉。',
        modern_interpretation: '给小牛戴上护角的横木，防患于未然——大吉。',
        changing_guidance: '此爻变动时，提示在问题幼小时就加以引导，最省力。',
      },
      {
        position: 5,
        name: '六五',
        classical: '豮豕之牙，吉。',
        modern_interpretation: '豮豕之牙不再伤人——从根源上化解戾气，吉。',
        changing_guidance: '此爻变动时，提示治本而非治标，从源头下手。',
      },
      {
        position: 6,
        name: '上九',
        classical: '何天之衢，亨。',
        modern_interpretation: '蓄极而通，如担荷青天大道——亨通无阻。',
        changing_guidance: '此爻变动时，提示积累已成，大道敞开，放手施展。',
      },
    ],
  },
  // #27 颐 — 山雷
  {
    number: 27,
    name: { chinese: '颐', pinyin: 'yí', english: 'Nourishment' },
    trigrams: { upper: '艮 (山)', lower: '震 (雷)' },
    judgment: {
      classical: '颐：贞吉。观颐，自求口实。',
      modern_interpretation: '颐养之道，守正即吉。看一个人养什么、如何自谋生计，就知道他是什么人。',
      keywords: ['颐养', '自食其力', '节制', '养正'],
    },
    image: {
      classical: '山下有雷，颐；君子以慎言语，节饮食。',
      modern_interpretation: '山下有雷，如口之开合；君子据此谨慎言语、节制饮食。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '舍尔灵龟，观我朵颐，凶。',
        modern_interpretation: '放着自己的灵龟不用，眼馋别人咀嚼——凶。',
        changing_guidance: '此爻变动时，警示别羡慕别人的饭碗，你有自己的本钱。',
      },
      {
        position: 2,
        name: '六二',
        classical: '颠颐，拂经，于丘颐，征凶。',
        modern_interpretation: '颠倒了求养的方向，违背常理，前行有凶。',
        changing_guidance: '此爻变动时，警示依赖的对象错了，回到正常的秩序。',
      },
      {
        position: 3,
        name: '六三',
        classical: '拂颐，贞凶。十年勿用，无攸利。',
        modern_interpretation: '违背颐养正道，纵然守着也凶，久不可用。',
        changing_guidance: '此爻变动时，警示饮鸩止渴式的滋养，趁早戒断。',
      },
      {
        position: 4,
        name: '六四',
        classical: '颠颐，吉。虎视眈眈，其欲逐逐，无咎。',
        modern_interpretation: '居上而求养于下，为的是养人——专注如虎视，其求不断，无咎。',
        changing_guidance: '此爻变动时，提示为正当目的借力，可以理直气壮。',
      },
      {
        position: 5,
        name: '六五',
        classical: '拂经，居贞吉。不可涉大川。',
        modern_interpretation: '己力不足而依赖贤者，安守正道即吉；不宜此时涉险。',
        changing_guidance: '此爻变动时，提示承认自己需要帮助，安守本分。',
      },
      {
        position: 6,
        name: '上九',
        classical: '由颐，厉吉。利涉大川。',
        modern_interpretation: '众人赖之以养，责任重大——常怀危惧则吉，值得涉险担当。',
        changing_guidance: '此爻变动时，提示担起养人者的责任，谨慎而行。',
      },
    ],
  },
  // #28 大过 — 泽风
  {
    number: 28,
    name: { chinese: '大过', pinyin: 'dà guò', english: 'Great Excess' },
    trigrams: { upper: '兑 (泽)', lower: '巽 (风)' },
    judgment: {
      classical: '大过：栋桡。利有攸往，亨。',
      modern_interpretation: '栋梁弯曲，负重过甚——非常之时。须有所行动以纠偏，亨通。',
      keywords: ['非常之时', '担重', '独立', '果决'],
    },
    image: {
      classical: '泽灭木，大过；君子以独立不惧，遁世无闷。',
      modern_interpretation: '泽水淹没树木，大为过甚；君子据此独立而不惧，遁世而不闷。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '藉用白茅，无咎。',
        modern_interpretation: '以白茅垫底，郑重其事——过于谨慎，无咎。',
        changing_guidance: '此爻变动时，提示大事之前，再谨慎也不为过。',
      },
      {
        position: 2,
        name: '九二',
        classical: '枯杨生稊，老夫得其女妻，无不利。',
        modern_interpretation: '枯杨发新芽，老树逢春——刚过而得柔济，无所不利。',
        changing_guidance: '此爻变动时，提示引入新的活力，老局面也能翻新。',
      },
      {
        position: 3,
        name: '九三',
        classical: '栋桡，凶。',
        modern_interpretation: '栋梁弯曲将折，刚愎自用而无援——凶。',
        changing_guidance: '此爻变动时，警示别一个人硬扛，快找支撑。',
      },
      {
        position: 4,
        name: '九四',
        classical: '栋隆，吉。有它吝。',
        modern_interpretation: '栋梁隆起，足以承重——吉；若另有所图则有憾。',
        changing_guidance: '此爻变动时，提示把该扛的扛好，别分心他顾。',
      },
      {
        position: 5,
        name: '九五',
        classical: '枯杨生华，老妇得其士夫，无咎无誉。',
        modern_interpretation: '枯杨开花，绚烂而难久——无咎也无誉。',
        changing_guidance: '此爻变动时，提示表面的繁荣撑不久，别把它当依靠。',
      },
      {
        position: 6,
        name: '上六',
        classical: '过涉灭顶，凶，无咎。',
        modern_interpretation: '涉水过深至于灭顶——凶；但为大义赴险，虽凶无咎。',
        changing_guidance: '此爻变动时，提示明知代价仍要去做的事，想清楚再赴。',
      },
    ],
  },
  // #29 坎 — 水水
  {
    number: 29,
    name: { chinese: '坎', pinyin: 'kǎn', english: 'The Abysmal / Water' },
    trigrams: { upper: '坎 (水)', lower: '坎 (水)' },
    judgment: {
      classical: '习坎：有孚，维心亨，行有尚。',
      modern_interpretation: '重重险陷之中，唯有内心的诚信笃定能通达。带着这颗心行动，必被崇尚。',
      keywords: ['涉险', '信念', '沉着', '历练'],
    },
    image: {
      classical: '水洊至，习坎；君子以常德行，习教事。',
      modern_interpretation: '水流接连而至，险而不失其信；君子据此恒常其德行，反复研习教事。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '习坎，入于坎窞，凶。',
        modern_interpretation: '险中又陷入更深的坑洞——凶。',
        changing_guidance: '此爻变动时，警示越挣扎陷得越深，先停下来看清处境。',
      },
      {
        position: 2,
        name: '九二',
        classical: '坎有险，求小得。',
        modern_interpretation: '身在险中，先求小的进展。',
        changing_guidance: '此爻变动时，提示险境中别求全胜，积小步出坑。',
      },
      {
        position: 3,
        name: '六三',
        classical: '来之坎坎，险且枕，入于坎窞，勿用。',
        modern_interpretation: '进退皆险，暂且止息——此时不宜有所动作。',
        changing_guidance: '此爻变动时，提示动辄得咎的时候，不动是对的。',
      },
      {
        position: 4,
        name: '六四',
        classical: '樽酒簋贰，用缶，纳约自牖，终无咎。',
        modern_interpretation: '一樽酒、两簋饭、瓦器盛之，从窗牖间致意——险中至诚相交，终无咎。',
        changing_guidance: '此爻变动时，提示困境中的真诚最能打动人，形式从简无妨。',
      },
      {
        position: 5,
        name: '九五',
        classical: '坎不盈，祗既平，无咎。',
        modern_interpretation: '坎险将平未满，快要走出险境——无咎。',
        changing_guidance: '此爻变动时，提示险情正在消退，稳住最后一段。',
      },
      {
        position: 6,
        name: '上六',
        classical: '系用徽纆，寘于丛棘，三岁不得，凶。',
        modern_interpretation: '被绳索捆缚、置于丛棘，多年不得脱——凶。',
        changing_guidance: '此爻变动时，警示错误的路越走越紧，别等到被彻底困住。',
      },
    ],
  },
  // #30 离 — 火火
  {
    number: 30,
    name: { chinese: '离', pinyin: 'lí', english: 'The Clinging / Fire' },
    trigrams: { upper: '离 (火)', lower: '离 (火)' },
    judgment: {
      classical: '离：利贞，亨。畜牝牛，吉。',
      modern_interpretation: '附丽光明，守正则亨。像蓄养母牛般培养柔顺之德，吉。',
      keywords: ['光明', '依附', '柔顺', '传承'],
    },
    image: {
      classical: '明两作，离；大人以继明照于四方。',
      modern_interpretation: '光明接连升起；大人据此以延续的光明照临四方。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '履错然，敬之，无咎。',
        modern_interpretation: '起步时脚步交错纷乱；心存敬慎，无咎。',
        changing_guidance: '此爻变动时，提示开局忙乱不怕，敬慎能稳住。',
      },
      {
        position: 2,
        name: '六二',
        classical: '黄离，元吉。',
        modern_interpretation: '中正柔和的黄色光明——大吉。',
        changing_guidance: '此爻变动时，提示行中道、发温光，最是长久。',
      },
      {
        position: 3,
        name: '九三',
        classical: '日昃之离，不鼓缶而歌，则大耋之嗟，凶。',
        modern_interpretation: '夕阳西斜之光。不能安然歌咏面对迟暮，只剩衰老的哀叹——凶。',
        changing_guidance: '此爻变动时，提示接受一个阶段的落幕，以平常心交棒。',
      },
      {
        position: 4,
        name: '九四',
        classical: '突如其来如，焚如，死如，弃如。',
        modern_interpretation: '突然而来、气焰灼人者，如火骤燃，转瞬熄灭被弃。',
        changing_guidance: '此爻变动时，警示来得太猛的势头难以持久，别被裹挟。',
      },
      {
        position: 5,
        name: '六五',
        classical: '出涕沱若，戚嗟若，吉。',
        modern_interpretation: '泪如雨下、忧戚叹息——居危知惧，反而得吉。',
        changing_guidance: '此爻变动时，提示此刻的忧患感是清醒的表现。',
      },
      {
        position: 6,
        name: '上九',
        classical: '王用出征，有嘉折首，获匪其丑，无咎。',
        modern_interpretation: '王者出征，斩其首恶而不滥及从众——无咎。',
        changing_guidance: '此爻变动时，提示解决问题抓首要矛盾，不搞株连。',
      },
    ],
  },
  // #31 咸 — 泽山
  {
    number: 31,
    name: { chinese: '咸', pinyin: 'xián', english: 'Influence' },
    trigrams: { upper: '兑 (泽)', lower: '艮 (山)' },
    judgment: {
      classical: '咸：亨，利贞。取女吉。',
      modern_interpretation: '感应相通，亨通，守正有利。两情相感，如娶妻般吉。',
      keywords: ['感应', '真诚', '虚心', '相通'],
    },
    image: {
      classical: '山上有泽，咸；君子以虚受人。',
      modern_interpretation: '泽在山上，山虚而承泽；君子据此虚怀接纳他人。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '咸其拇。',
        modern_interpretation: '感应在脚拇指——心意初动，尚浅。',
        changing_guidance: '此爻变动时，提示心动刚起，先观察再行动。',
      },
      {
        position: 2,
        name: '六二',
        classical: '咸其腓，凶。居吉。',
        modern_interpretation: '感应到小腿，急欲妄动则凶；安居守静则吉。',
        changing_guidance: '此爻变动时，提示冲动先按住，静待对方回应。',
      },
      {
        position: 3,
        name: '九三',
        classical: '咸其股，执其随，往吝。',
        modern_interpretation: '感应到大腿，只知随人而动，前往有憾。',
        changing_guidance: '此爻变动时，警示别人动你就动，会失去自己的判断。',
      },
      {
        position: 4,
        name: '九四',
        classical: '贞吉，悔亡。憧憧往来，朋从尔思。',
        modern_interpretation: '守正即吉，悔恨消失。心思往来不定，朋友只会顺着你的念头走。',
        changing_guidance: '此爻变动时，提示感应贵在专一，摇摆会稀释真诚。',
      },
      {
        position: 5,
        name: '九五',
        classical: '咸其脢，无悔。',
        modern_interpretation: '感应到背脊，超然而不为私感所动——无悔。',
        changing_guidance: '此爻变动时，提示把感情放在更高处，不为一时悸动所困。',
      },
      {
        position: 6,
        name: '上六',
        classical: '咸其辅颊舌。',
        modern_interpretation: '感应只在口舌之间——徒有言语，缺乏真情。',
        changing_guidance: '此爻变动时，警示嘴上的功夫打动不了人，拿出实意。',
      },
    ],
  },
  // #32 恒 — 雷风
  {
    number: 32,
    name: { chinese: '恒', pinyin: 'héng', english: 'Duration' },
    trigrams: { upper: '震 (雷)', lower: '巽 (风)' },
    judgment: {
      classical: '恒：亨，无咎，利贞。利有攸往。',
      modern_interpretation: '恒久之道，亨通无咎，守正有利。恒并非不动，长久之道利于持续前行。',
      keywords: ['恒久', '定力', '持续', '不易其方'],
    },
    image: {
      classical: '雷风，恒；君子以立不易方。',
      modern_interpretation: '雷与风相与为恒；君子据此立身处世，不改易自己的原则方向。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '浚恒，贞凶，无攸利。',
        modern_interpretation: '一开始就苛求深固长久，欲速则凶，无所利。',
        changing_guidance: '此爻变动时，警示关系与事业都急不来，深度靠时间。',
      },
      {
        position: 2,
        name: '九二',
        classical: '悔亡。',
        modern_interpretation: '悔恨消失——以中道守恒，恰到好处。',
        changing_guidance: '此爻变动时，提示守住中道，已经在正确的路上。',
      },
      {
        position: 3,
        name: '九三',
        classical: '不恒其德，或承之羞，贞吝。',
        modern_interpretation: '不能恒守其德，迟早蒙羞。',
        changing_guidance: '此爻变动时，警示反复无常正在消耗你的信用。',
      },
      {
        position: 4,
        name: '九四',
        classical: '田无禽。',
        modern_interpretation: '猎场无禽——位置错了，恒守也无所获。',
        changing_guidance: '此爻变动时，提示坚持要看方向，错的地方换掉。',
      },
      {
        position: 5,
        name: '六五',
        classical: '恒其德，贞。妇人吉，夫子凶。',
        modern_interpretation: '恒守柔顺之德，对从人者吉，对当断者则不足。',
        changing_guidance: '此爻变动时，提示一味顺从算不上美德，该拿主意时要拿。',
      },
      {
        position: 6,
        name: '上六',
        classical: '振恒，凶。',
        modern_interpretation: '在该安定时躁动不安——凶。',
        changing_guidance: '此爻变动时，警示高位求变最忌轻率，先稳住再图变。',
      },
    ],
  },
]
