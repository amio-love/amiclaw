// Hexagrams #49–#56 — King Wen order.
// Classical texts follow the received text (通行本); authored fields match the
// register of the original entries.

import type { HexagramEntry } from '../schema'

export const HEXAGRAMS_49_56: HexagramEntry[] = [
  // #49 革 — 泽火
  {
    number: 49,
    name: { chinese: '革', pinyin: 'gé', english: 'Revolution' },
    trigrams: { upper: '兑 (泽)', lower: '离 (火)' },
    judgment: {
      classical: '革：己日乃孚，元亨，利贞，悔亡。',
      modern_interpretation: '变革之道，须待时机成熟、民心相信才动——大亨通，守正有利，悔恨消散。',
      keywords: ['变革', '时机', '取信', '除旧'],
    },
    image: {
      classical: '泽中有火，革；君子以治历明时。',
      modern_interpretation: '泽中有火，水火相息而生变；君子据此修治历法、明辨时序。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '巩用黄牛之革。',
        modern_interpretation: '以黄牛之革牢牢束住——变革未到时机，先稳固自守。',
        changing_guidance: '此爻变动时，提示还没到动手的时候，按住。',
      },
      {
        position: 2,
        name: '六二',
        classical: '己日乃革之，征吉，无咎。',
        modern_interpretation: '时机已至，方才变革——前行即吉，无咎。',
        changing_guidance: '此爻变动时，提示条件成熟了，放手去改。',
      },
      {
        position: 3,
        name: '九三',
        classical: '征凶，贞厉。革言三就，有孚。',
        modern_interpretation: '冒进则凶，守正亦须戒惧。变革之议再三斟酌、反复验证，方能取信。',
        changing_guidance: '此爻变动时，提示大改之前多论证几轮，信任是改出来的。',
      },
      {
        position: 4,
        name: '九四',
        classical: '悔亡，有孚改命，吉。',
        modern_interpretation: '悔恨消散，以诚信变革天命——吉。',
        changing_guidance: '此爻变动时，提示根本性的转向，此刻可以做了。',
      },
      {
        position: 5,
        name: '九五',
        classical: '大人虎变，未占有孚。',
        modern_interpretation: '大人之变如虎纹焕然，不必占问也自有公信。',
        changing_guidance: '此爻变动时，提示让改变鲜明可见，众人自然信服。',
      },
      {
        position: 6,
        name: '上六',
        classical: '君子豹变，小人革面。征凶，居贞吉。',
        modern_interpretation:
          '君子之变如豹纹渐美，小人也随之改观。变革既成，再进则凶，安守成果则吉。',
        changing_guidance: '此爻变动时，提示改革到位就收手，巩固比继续折腾重要。',
      },
    ],
  },
  // #50 鼎 — 火风
  {
    number: 50,
    name: { chinese: '鼎', pinyin: 'dǐng', english: 'The Cauldron' },
    trigrams: { upper: '离 (火)', lower: '巽 (风)' },
    judgment: {
      classical: '鼎：元吉，亨。',
      modern_interpretation: '鼎新之象，化生为熟、养贤育才——大吉，亨通。',
      keywords: ['鼎新', '养贤', '安重', '各安其位'],
    },
    image: {
      classical: '木上有火，鼎；君子以正位凝命。',
      modern_interpretation: '木上燃火，烹饪成新；君子据此端正位分、凝聚使命。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '鼎颠趾，利出否。得妾以其子，无咎。',
        modern_interpretation: '鼎翻了脚，倒出的是积秽——除旧纳新，因祸得福，无咎。',
        changing_guidance: '此爻变动时，提示翻倒重来未必是坏事，正好清空旧秽。',
      },
      {
        position: 2,
        name: '九二',
        classical: '鼎有实，我仇有疾，不我能即，吉。',
        modern_interpretation: '鼎中有实，自守充盈；嫉恨者无法近身——吉。',
        changing_guidance: '此爻变动时，提示专注自己的实货，非议近不了身。',
      },
      {
        position: 3,
        name: '九三',
        classical: '鼎耳革，其行塞，雉膏不食。方雨亏悔，终吉。',
        modern_interpretation: '鼎耳变形，抬举不得，美味无人享用；待到阴阳调和，悔憾消解，终吉。',
        changing_guidance: '此爻变动时，提示才具暂时没被抬举，保持成色，时候会到。',
      },
      {
        position: 4,
        name: '九四',
        classical: '鼎折足，覆公餗，其形渥，凶。',
        modern_interpretation: '鼎足折断，打翻了公家的珍馐，狼狈不堪——凶。',
        changing_guidance: '此爻变动时，警示担子超出了承受力，赶紧减载或求援。',
      },
      {
        position: 5,
        name: '六五',
        classical: '鼎黄耳金铉，利贞。',
        modern_interpretation: '鼎配黄耳金铉，中正而堪重任——守正有利。',
        changing_guidance: '此爻变动时，提示以中正之姿承接大任。',
      },
      {
        position: 6,
        name: '上九',
        classical: '鼎玉铉，大吉，无不利。',
        modern_interpretation: '鼎配玉铉，刚柔相济至于至善——大吉，无所不利。',
        changing_guidance: '此爻变动时，提示功成之际，以温润收束全局。',
      },
    ],
  },
  // #51 震 — 雷雷
  {
    number: 51,
    name: { chinese: '震', pinyin: 'zhèn', english: 'The Arousing / Thunder' },
    trigrams: { upper: '震 (雷)', lower: '震 (雷)' },
    judgment: {
      classical: '震：亨。震来虩虩，笑言哑哑。震惊百里，不丧匕鬯。',
      modern_interpretation:
        '震动之时，亨通。惊雷乍起而心存戒惧，过后笑语如常；纵然震惊百里，主祭者手中的礼器也不失——处变不惊。',
      keywords: ['震动', '戒惧', '镇定', '修省'],
    },
    image: {
      classical: '洊雷，震；君子以恐惧修省。',
      modern_interpretation: '雷声接连而至；君子据此心怀敬畏，反省修身。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '震来虩虩，后笑言哑哑，吉。',
        modern_interpretation: '雷来时惶恐戒惧，过后谈笑自如——先惧后安，吉。',
        changing_guidance: '此爻变动时，提示把惊吓转成警醒，反而因祸得福。',
      },
      {
        position: 2,
        name: '六二',
        classical: '震来厉，亿丧贝，跻于九陵。勿逐，七日得。',
        modern_interpretation: '震来凶猛，财物尽失，避于高陵。不必追寻，时候到了自会失而复得。',
        changing_guidance: '此爻变动时，提示先保命保本，丢掉的以后会回来。',
      },
      {
        position: 3,
        name: '六三',
        classical: '震苏苏，震行无眚。',
        modern_interpretation: '震得惶惶不安；因惧而行、及时避开，可无灾祸。',
        changing_guidance: '此爻变动时，提示不安是信号，照它的提示挪个位置。',
      },
      {
        position: 4,
        name: '九四',
        classical: '震遂泥。',
        modern_interpretation: '震动之力陷入泥中——威势不振。',
        changing_guidance: '此爻变动时，警示阵仗大而行动软，先把自己拔出泥。',
      },
      {
        position: 5,
        name: '六五',
        classical: '震往来厉，亿无丧，有事。',
        modern_interpretation: '震动往来皆险；居中自守，大体无失，尚可任事。',
        changing_guidance: '此爻变动时，提示动荡反复时守住中位，照常做事。',
      },
      {
        position: 6,
        name: '上六',
        classical: '震索索，视矍矍，征凶。震不于其躬，于其邻，无咎。婚媾有言。',
        modern_interpretation:
          '震得两腿发软、目光惶惶，此时前行必凶。雷未及身、先见邻戒，预为之备则无咎。',
        changing_guidance: '此爻变动时，提示看到别人挨的雷，就是给你的预警。',
      },
    ],
  },
  // #52 艮 — 山山
  {
    number: 52,
    name: { chinese: '艮', pinyin: 'gèn', english: 'Keeping Still / Mountain' },
    trigrams: { upper: '艮 (山)', lower: '艮 (山)' },
    judgment: {
      classical: '艮其背，不获其身；行其庭，不见其人。无咎。',
      modern_interpretation:
        '止于所当止——止于背后，不为身前之欲所牵；行于庭院，不为他人所扰。无咎。',
      keywords: ['知止', '安定', '专注', '不逾位'],
    },
    image: {
      classical: '兼山，艮；君子以思不出其位。',
      modern_interpretation: '两山相重，止而又止；君子据此思虑不越出自己的本位。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '艮其趾，无咎。利永贞。',
        modern_interpretation: '止于脚趾，欲动之初即止——无咎，宜长守正道。',
        changing_guidance: '此爻变动时，提示第一步就停下来，是最便宜的克制。',
      },
      {
        position: 2,
        name: '六二',
        classical: '艮其腓，不拯其随，其心不快。',
        modern_interpretation: '止于小腿，想停却身不由己地跟着走——心中不快。',
        changing_guidance: '此爻变动时，提示被裹挟着停不下来，先脱离那股拉力。',
      },
      {
        position: 3,
        name: '九三',
        classical: '艮其限，列其夤，厉薰心。',
        modern_interpretation: '强行止于腰际，上下断裂，危厉灼心——硬止伤身。',
        changing_guidance: '此爻变动时，警示压抑到僵硬的克制会内伤，松一松。',
      },
      {
        position: 4,
        name: '六四',
        classical: '艮其身，无咎。',
        modern_interpretation: '止于全身，安然自止——无咎。',
        changing_guidance: '此爻变动时，提示把整个人安顿下来，静得住。',
      },
      {
        position: 5,
        name: '六五',
        classical: '艮其辅，言有序，悔亡。',
        modern_interpretation: '止于口，说话有分寸有次序——悔恨消散。',
        changing_guidance: '此爻变动时，提示管住表达的冲动，话说在点上。',
      },
      {
        position: 6,
        name: '上九',
        classical: '敦艮，吉。',
        modern_interpretation: '敦厚笃实地知止，止得安稳长久——吉。',
        changing_guidance: '此爻变动时，提示把「知止」修成品格，就是吉。',
      },
    ],
  },
  // #53 渐 — 风山
  {
    number: 53,
    name: { chinese: '渐', pinyin: 'jiàn', english: 'Development' },
    trigrams: { upper: '巽 (风)', lower: '艮 (山)' },
    judgment: {
      classical: '渐：女归吉，利贞。',
      modern_interpretation: '循序渐进，如女子出嫁依礼而行——吉，守正有利。',
      keywords: ['渐进', '次第', '依礼', '积累'],
    },
    image: {
      classical: '山上有木，渐；君子以居贤德善俗。',
      modern_interpretation: '山上之木渐渐生长；君子据此渐养贤德、渐善风俗。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '鸿渐于干，小子厉，有言，无咎。',
        modern_interpretation: '鸿雁渐进于水滨，起步维艰，虽有非议——无咎。',
        changing_guidance: '此爻变动时，提示起步慢、被人说几句，都正常。',
      },
      {
        position: 2,
        name: '六二',
        classical: '鸿渐于磐，饮食衎衎，吉。',
        modern_interpretation: '鸿雁渐进于磐石，安稳和乐——吉。',
        changing_guidance: '此爻变动时，提示站上了稳固的一级，享受此刻的从容。',
      },
      {
        position: 3,
        name: '九三',
        classical: '鸿渐于陆，夫征不复，妇孕不育，凶。利御寇。',
        modern_interpretation: '鸿雁误进于高地，冒进失序则两败俱伤——凶；宜守不宜攻。',
        changing_guidance: '此爻变动时，警示跳过了该走的次序，退回防守。',
      },
      {
        position: 4,
        name: '六四',
        classical: '鸿渐于木，或得其桷，无咎。',
        modern_interpretation: '鸿雁渐进于树，寻得平枝可栖——无咎。',
        changing_guidance: '此爻变动时，提示在不利的位置里找一处可栖的平衡点。',
      },
      {
        position: 5,
        name: '九五',
        classical: '鸿渐于陵，妇三岁不孕，终莫之胜，吉。',
        modern_interpretation: '鸿雁渐进于高陵，虽久受阻隔，正当的结合终不可阻——吉。',
        changing_guidance: '此爻变动时，提示对的事被隔了再久，终会成。',
      },
      {
        position: 6,
        name: '上九',
        classical: '鸿渐于陆，其羽可用为仪，吉。',
        modern_interpretation: '鸿雁高翔于云路，其羽可为仪范——功成身退，吉。',
        changing_guidance: '此爻变动时，提示走完全程的姿态，本身就是示范。',
      },
    ],
  },
  // #54 归妹 — 雷泽
  {
    number: 54,
    name: { chinese: '归妹', pinyin: 'guī mèi', english: 'The Marrying Maiden' },
    trigrams: { upper: '震 (雷)', lower: '兑 (泽)' },
    judgment: {
      classical: '归妹：征凶，无攸利。',
      modern_interpretation: '少女急嫁，悦动失序——以此而进则凶，无所利。情之所动，更须守礼守序。',
      keywords: ['失序', '名分', '克制', '慎始'],
    },
    image: {
      classical: '泽上有雷，归妹；君子以永终知敝。',
      modern_interpretation: '雷动于泽上，悦而随动；君子据此思虑久远，善始更求善终。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '归妹以娣，跛能履，征吉。',
        modern_interpretation: '以侧室之位随嫁，如跛者尚能行——安于其分，前行可吉。',
        changing_guidance: '此爻变动时，提示位置不理想也能有所作为，先把分内事走好。',
      },
      {
        position: 2,
        name: '九二',
        classical: '眇能视，利幽人之贞。',
        modern_interpretation: '如眇者尚能视物——处境有缺，宜如幽居者般静守其正。',
        changing_guidance: '此爻变动时，提示条件不全时，守住自己的清明。',
      },
      {
        position: 3,
        name: '六三',
        classical: '归妹以须，反归以娣。',
        modern_interpretation: '急于求归而失身份，不如退而以正当之位相从。',
        changing_guidance: '此爻变动时，提示别为着急降低自己，退一步等正当的位置。',
      },
      {
        position: 4,
        name: '九四',
        classical: '归妹愆期，迟归有时。',
        modern_interpretation: '婚期延迟——迟一些，是在等对的时机。',
        changing_guidance: '此爻变动时，提示晚一点没关系，值得的事不怕等。',
      },
      {
        position: 5,
        name: '六五',
        classical: '帝乙归妹，其君之袂不如其娣之袂良。月几望，吉。',
        modern_interpretation:
          '帝乙嫁妹，正主的衣饰反不如陪嫁华美——尊贵而尚俭，如月近满而不盈，吉。',
        changing_guidance: '此爻变动时，提示身份越高越无须妆点，谦俭最贵。',
      },
      {
        position: 6,
        name: '上六',
        classical: '女承筐无实，士刲羊无血，无攸利。',
        modern_interpretation: '女子捧筐而空、男子宰羊无血——徒具形式而无实质，无所利。',
        changing_guidance: '此爻变动时，警示只剩仪式感的关系或事业，先补回实质。',
      },
    ],
  },
  // #55 丰 — 雷火
  {
    number: 55,
    name: { chinese: '丰', pinyin: 'fēng', english: 'Abundance' },
    trigrams: { upper: '震 (雷)', lower: '离 (火)' },
    judgment: {
      classical: '丰：亨，王假之。勿忧，宜日中。',
      modern_interpretation: '丰盛之时，亨通，王者方能至此盛境。不必忧虑，如日当中天，正宜普照。',
      keywords: ['丰盛', '日中', '普照', '盛极防衰'],
    },
    image: {
      classical: '雷电皆至，丰；君子以折狱致刑。',
      modern_interpretation: '雷电俱至，威明兼备；君子据此明断狱讼、施行刑罚。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '遇其配主，虽旬无咎，往有尚。',
        modern_interpretation: '遇到旗鼓相当的搭档，均等而无咎——同往必受推崇。',
        changing_guidance: '此爻变动时，提示遇到对等的伙伴，是丰盛的开端。',
      },
      {
        position: 2,
        name: '六二',
        classical: '丰其蔀，日中见斗。往得疑疾，有孚发若，吉。',
        modern_interpretation: '光明被遮，白昼如见星斗；此时前往徒遭猜忌，以诚信感发对方则吉。',
        changing_guidance: '此爻变动时，提示被遮蔽时不辩解，用诚意一点点透光。',
      },
      {
        position: 3,
        name: '九三',
        classical: '丰其沛，日中见沬。折其右肱，无咎。',
        modern_interpretation: '遮蔽更甚，白昼如见微星；如断右臂难有作为——过不在己，无咎。',
        changing_guidance: '此爻变动时，提示施展不开时先保全自己，不算过错。',
      },
      {
        position: 4,
        name: '九四',
        classical: '丰其蔀，日中见斗。遇其夷主，吉。',
        modern_interpretation: '昏暗之中遇见同明之主，彼此相济——吉。',
        changing_guidance: '此爻变动时，提示黑暗里找到同道，光就成倍。',
      },
      {
        position: 5,
        name: '六五',
        classical: '来章，有庆誉，吉。',
        modern_interpretation: '招致天下明贤之士，有福庆、有声誉——吉。',
        changing_guidance: '此爻变动时，提示把有才华的人请进来，是此刻最好的动作。',
      },
      {
        position: 6,
        name: '上六',
        classical: '丰其屋，蔀其家，窥其户，阒其无人，三岁不觌，凶。',
        modern_interpretation: '屋宇高大却自蔽其家，门内空寂无人，久不见人影——盛极自闭，凶。',
        changing_guidance: '此爻变动时，警示丰盛若变成高墙，人心就散了。',
      },
    ],
  },
  // #56 旅 — 火山
  {
    number: 56,
    name: { chinese: '旅', pinyin: 'lǚ', english: 'The Wanderer' },
    trigrams: { upper: '离 (火)', lower: '艮 (山)' },
    judgment: {
      classical: '旅：小亨，旅贞吉。',
      modern_interpretation: '行旅在外，小有亨通；旅途之中守正，才得吉。',
      keywords: ['行旅', '谦柔', '寄居', '谨慎'],
    },
    image: {
      classical: '山上有火，旅；君子以明慎用刑而不留狱。',
      modern_interpretation: '火行山上，过而不留；君子据此明慎地用刑，而不滞留狱讼。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '旅琐琐，斯其所取灾。',
        modern_interpretation: '旅途中猥琐计较于琐屑，正是自取其灾。',
        changing_guidance: '此爻变动时，警示在外别纠缠小事，格局放大。',
      },
      {
        position: 2,
        name: '六二',
        classical: '旅即次，怀其资，得童仆贞。',
        modern_interpretation: '旅途得安身之所，怀有资财，又得忠实的僮仆——安稳。',
        changing_guidance: '此爻变动时，提示在外站稳脚跟，先安顿好落脚点与帮手。',
      },
      {
        position: 3,
        name: '九三',
        classical: '旅焚其次，丧其童仆，贞厉。',
        modern_interpretation: '客舍被焚，僮仆离散——旅途中傲慢刚愎，处境危殆。',
        changing_guidance: '此爻变动时，警示寄人篱下还盛气凌人，会失去所有依托。',
      },
      {
        position: 4,
        name: '九四',
        classical: '旅于处，得其资斧，我心不快。',
        modern_interpretation: '暂得栖身之处，也有资财器用，心里却不畅快——终非其所。',
        changing_guidance: '此爻变动时，提示眼下的安顿只是权宜，心里的方向别丢。',
      },
      {
        position: 5,
        name: '六五',
        classical: '射雉，一矢亡，终以誉命。',
        modern_interpretation: '射雉虽失一箭，终获美誉与任命——小损换来大的立足。',
        changing_guidance: '此爻变动时，提示付出点代价融入当地，值得。',
      },
      {
        position: 6,
        name: '上九',
        classical: '鸟焚其巢，旅人先笑后号咷。丧牛于易，凶。',
        modern_interpretation: '鸟巢被焚，先笑后哭；在轻忽中失去了赖以行路的牛——客居而骄，凶。',
        changing_guidance: '此爻变动时，警示身在客位而自居其主，最后会失去落脚处。',
      },
    ],
  },
]
