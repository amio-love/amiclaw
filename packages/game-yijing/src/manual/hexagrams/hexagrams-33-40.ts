// Hexagrams #33–#40 — King Wen order.
// Classical texts follow the received text (通行本); authored fields match the
// register of the original entries.

import type { HexagramEntry } from '../schema'

export const HEXAGRAMS_33_40: HexagramEntry[] = [
  // #33 遯 — 天山
  {
    number: 33,
    name: { chinese: '遯', pinyin: 'dùn', english: 'Retreat' },
    trigrams: { upper: '乾 (天)', lower: '艮 (山)' },
    judgment: {
      classical: '遯：亨。小利贞。',
      modern_interpretation: '退避之时，亨通。识时而退，小处守正尚有利。',
      keywords: ['退避', '识时', '保全', '距离'],
    },
    image: {
      classical: '天下有山，遯；君子以远小人，不恶而严。',
      modern_interpretation: '天下有山，天高而山退；君子据此疏远小人，不出恶声而自有威严。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '遯尾，厉。勿用有攸往。',
        modern_interpretation: '退避落在末尾，处境危险；此时不宜再有所前往。',
        changing_guidance: '此爻变动时，警示撤得太迟了，先原地隐忍别乱动。',
      },
      {
        position: 2,
        name: '六二',
        classical: '执之用黄牛之革，莫之胜说。',
        modern_interpretation: '以黄牛皮革束系，坚不可解——守持之志无可动摇。',
        changing_guidance: '此爻变动时，提示认定要守的东西，就守到底。',
      },
      {
        position: 3,
        name: '九三',
        classical: '系遯，有疾厉。畜臣妾吉。',
        modern_interpretation: '心有系恋而难退，疲惫危殆；此时只宜料理身边小事。',
        changing_guidance: '此爻变动时，提示牵绊让你走不脱，先减负再退。',
      },
      {
        position: 4,
        name: '九四',
        classical: '好遯，君子吉，小人否。',
        modern_interpretation: '有所好而能舍之退避，君子做得到，小人做不到。',
        changing_guidance: '此爻变动时，提示舍得放下喜欢的东西，才退得干净。',
      },
      {
        position: 5,
        name: '九五',
        classical: '嘉遯，贞吉。',
        modern_interpretation: '恰到好处的退避，守正即吉。',
        changing_guidance: '此爻变动时，提示体面地退场，正当其时。',
      },
      {
        position: 6,
        name: '上九',
        classical: '肥遯，无不利。',
        modern_interpretation: '高飞远退，从容无碍——无所不利。',
        changing_guidance: '此爻变动时，提示彻底抽身，海阔天空。',
      },
    ],
  },
  // #34 大壮 — 雷天
  {
    number: 34,
    name: { chinese: '大壮', pinyin: 'dà zhuàng', english: 'Great Power' },
    trigrams: { upper: '震 (雷)', lower: '乾 (天)' },
    judgment: {
      classical: '大壮：利贞。',
      modern_interpretation: '阳刚大盛之时，守正有利。力量越大，越须用在正道上。',
      keywords: ['强盛', '克制', '守礼', '慎用力'],
    },
    image: {
      classical: '雷在天上，大壮；君子以非礼弗履。',
      modern_interpretation: '雷震于天上，声威壮盛；君子据此凡不合礼义之事，一步也不踏。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '壮于趾，征凶，有孚。',
        modern_interpretation: '力量用在脚趾上就急于前冲，前行必凶。',
        changing_guidance: '此爻变动时，警示底层发力最忌冒进，稳住。',
      },
      {
        position: 2,
        name: '九二',
        classical: '贞吉。',
        modern_interpretation: '刚而能中，守正即吉。',
        changing_guidance: '此爻变动时，提示强的时候更要守正，这就够了。',
      },
      {
        position: 3,
        name: '九三',
        classical: '小人用壮，君子用罔。贞厉。羝羊触藩，羸其角。',
        modern_interpretation: '小人恃力蛮干，君子不屑为之。如公羊抵藩篱，角被卡住——逞强有危。',
        changing_guidance: '此爻变动时，警示硬顶只会卡死自己，绕开或等待。',
      },
      {
        position: 4,
        name: '九四',
        classical: '贞吉，悔亡。藩决不羸，壮于大舆之輹。',
        modern_interpretation: '守正即吉，悔恨消散。藩篱冲开而角不缠，力量如大车之轴——通行无阻。',
        changing_guidance: '此爻变动时，提示障碍已破，可以放开走了。',
      },
      {
        position: 5,
        name: '六五',
        classical: '丧羊于易，无悔。',
        modern_interpretation: '在平易之地失了羊，刚壮之气消于无形——无悔。',
        changing_guidance: '此爻变动时，提示凡事无须用强，柔一点没有损失。',
      },
      {
        position: 6,
        name: '上六',
        classical: '羝羊触藩，不能退，不能遂，无攸利。艰则吉。',
        modern_interpretation: '公羊抵藩，进退两难，无所利；知艰而自省，则可转吉。',
        changing_guidance: '此爻变动时，提示承认卡住了，认真想退路，反而有解。',
      },
    ],
  },
  // #35 晋 — 火地
  {
    number: 35,
    name: { chinese: '晋', pinyin: 'jìn', english: 'Progress' },
    trigrams: { upper: '离 (火)', lower: '坤 (地)' },
    judgment: {
      classical: '晋：康侯用锡马蕃庶，昼日三接。',
      modern_interpretation: '上进之时，如受宠的诸侯获赐车马、一日三次被接见——晋升的通道敞开。',
      keywords: ['上进', '受任', '光明', '自昭'],
    },
    image: {
      classical: '明出地上，晋；君子以自昭明德。',
      modern_interpretation: '太阳升出地面，光明渐盛；君子据此自我彰明光明的德行。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '晋如摧如，贞吉。罔孚，裕无咎。',
        modern_interpretation: '上进受挫，守正即吉；未获信任时，从容宽裕以待，无咎。',
        changing_guidance: '此爻变动时，提示暂时未被认可没关系，把心态放宽。',
      },
      {
        position: 2,
        name: '六二',
        classical: '晋如愁如，贞吉。受兹介福，于其王母。',
        modern_interpretation: '上进而忧愁，守正即吉；大福自会从尊长处来。',
        changing_guidance: '此爻变动时，提示稳步向前，该有的认可不会缺席。',
      },
      {
        position: 3,
        name: '六三',
        classical: '众允，悔亡。',
        modern_interpretation: '获得众人信任，悔恨消散。',
        changing_guidance: '此爻变动时，提示带着众人的信任前进，底气在此。',
      },
      {
        position: 4,
        name: '九四',
        classical: '晋如鼫鼠，贞厉。',
        modern_interpretation: '上进却如贪而畏人的鼫鼠，患得患失——有危。',
        changing_guidance: '此爻变动时，警示又想要又不敢，这个姿态最危险。',
      },
      {
        position: 5,
        name: '六五',
        classical: '悔亡，失得勿恤。往吉，无不利。',
        modern_interpretation: '悔恨消散，得失无须挂怀；前往即吉，无所不利。',
        changing_guidance: '此爻变动时，提示放下得失心，反而走得最远。',
      },
      {
        position: 6,
        name: '上九',
        classical: '晋其角，维用伐邑，厉吉，无咎，贞吝。',
        modern_interpretation: '上进到了尽头，锐气只宜用来整治自己的领地；虽有危而吉，但终究有憾。',
        changing_guidance: '此爻变动时，提示扩张到头了，把劲儿用在内部治理上。',
      },
    ],
  },
  // #36 明夷 — 地火
  {
    number: 36,
    name: { chinese: '明夷', pinyin: 'míng yí', english: 'Darkening of the Light' },
    trigrams: { upper: '坤 (地)', lower: '离 (火)' },
    judgment: {
      classical: '明夷：利艰贞。',
      modern_interpretation: '光明受损、暗世当头——利于在艰难中坚守正道，藏明于内。',
      keywords: ['晦暗', '守志', '藏锋', '内明'],
    },
    image: {
      classical: '明入地中，明夷；君子以莅众，用晦而明。',
      modern_interpretation: '光明沉入地中；君子据此治众理事，外表晦藏而内心明澈。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '明夷于飞，垂其翼。君子于行，三日不食。有攸往，主人有言。',
        modern_interpretation:
          '光明受伤如鸟垂翼而飞。君子急于远行避难，三日顾不上吃饭，还要遭人议论。',
        changing_guidance: '此爻变动时，提示避开锋芒要趁早，代价再大也值得。',
      },
      {
        position: 2,
        name: '六二',
        classical: '明夷，夷于左股，用拯马壮，吉。',
        modern_interpretation: '左腿受伤，借强壮的马得以自救——吉。',
        changing_guidance: '此爻变动时，提示受了伤先自救，找得力的支撑。',
      },
      {
        position: 3,
        name: '九三',
        classical: '明夷于南狩，得其大首，不可疾贞。',
        modern_interpretation: '南征狩猎，擒获元凶；但拨乱反正不可操之过急。',
        changing_guidance: '此爻变动时，提示除弊要抓住根源，节奏放稳。',
      },
      {
        position: 4,
        name: '六四',
        classical: '入于左腹，获明夷之心，于出门庭。',
        modern_interpretation: '深入腹地，看清了黑暗的内情，于是决然离去。',
        changing_guidance: '此爻变动时，提示看透了就走，无须恋栈。',
      },
      {
        position: 5,
        name: '六五',
        classical: '箕子之明夷，利贞。',
        modern_interpretation: '像箕子那样身处暗世、佯晦守明——利于坚守正道。',
        changing_guidance: '此爻变动时，提示大环境不容明言时，护住内心的光。',
      },
      {
        position: 6,
        name: '上六',
        classical: '不明晦，初登于天，后入于地。',
        modern_interpretation: '不发光反成全然的黑暗——起初高登于天，最终坠入于地。',
        changing_guidance: '此爻变动时，警示背离光明的巅峰终会坠落。',
      },
    ],
  },
  // #37 家人 — 风火
  {
    number: 37,
    name: { chinese: '家人', pinyin: 'jiā rén', english: 'The Family' },
    trigrams: { upper: '巽 (风)', lower: '离 (火)' },
    judgment: {
      classical: '家人：利女贞。',
      modern_interpretation: '治家之道，利于主内者守正。家道正，则天下之本正。',
      keywords: ['治家', '本分', '言行有恒', '由内而外'],
    },
    image: {
      classical: '风自火出，家人；君子以言有物而行有恒。',
      modern_interpretation: '风从火出，由内及外；君子据此说话有实据、行事有恒常。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '闲有家，悔亡。',
        modern_interpretation: '治家之初就立好规矩，悔恨消散。',
        changing_guidance: '此爻变动时，提示规矩趁早立，之后省去无数麻烦。',
      },
      {
        position: 2,
        name: '六二',
        classical: '无攸遂，在中馈，贞吉。',
        modern_interpretation: '不自专擅断，安守本职之内——守正即吉。',
        changing_guidance: '此爻变动时，提示把自己的一摊先做好，就是贡献。',
      },
      {
        position: 3,
        name: '九三',
        classical: '家人嗃嗃，悔厉，吉。妇子嘻嘻，终吝。',
        modern_interpretation: '治家过严，虽有悔厉，终归是吉；一味嬉笑放纵，反而有憾。',
        changing_guidance: '此爻变动时，提示严一点好过散掉，但注意火候。',
      },
      {
        position: 4,
        name: '六四',
        classical: '富家，大吉。',
        modern_interpretation: '使家道富厚——大吉。',
        changing_guidance: '此爻变动时，提示经营好共同的家底，人人受益。',
      },
      {
        position: 5,
        name: '九五',
        classical: '王假有家，勿恤，吉。',
        modern_interpretation: '王者以德感格其家，无须忧虑——吉。',
        changing_guidance: '此爻变动时，提示以身作则，家人自然相安。',
      },
      {
        position: 6,
        name: '上九',
        classical: '有孚威如，终吉。',
        modern_interpretation: '以诚信立身，自有威望——终吉。',
        changing_guidance: '此爻变动时，提示威信来自言出必行。',
      },
    ],
  },
  // #38 睽 — 火泽
  {
    number: 38,
    name: { chinese: '睽', pinyin: 'kuí', english: 'Opposition' },
    trigrams: { upper: '离 (火)', lower: '兑 (泽)' },
    judgment: {
      classical: '睽：小事吉。',
      modern_interpretation: '乖离对立之时，大事难合，从小事求同——小事吉。',
      keywords: ['分歧', '求同', '小步', '和而不同'],
    },
    image: {
      classical: '上火下泽，睽；君子以同而异。',
      modern_interpretation: '火向上、泽向下，性相违背；君子据此求大同而存小异。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '悔亡。丧马勿逐，自复。见恶人，无咎。',
        modern_interpretation: '悔恨消散。马跑了不必追，自会回来；该见的人即使不投缘也见，无咎。',
        changing_guidance: '此爻变动时，提示不强求、不回避，关系自有回环。',
      },
      {
        position: 2,
        name: '九二',
        classical: '遇主于巷，无咎。',
        modern_interpretation: '在小巷偶遇同道之主，殊途相逢——无咎。',
        changing_guidance: '此爻变动时，提示正式渠道走不通，不妨在非正式场合相见。',
      },
      {
        position: 3,
        name: '六三',
        classical: '见舆曳，其牛掣，其人天且劓。无初有终。',
        modern_interpretation: '车被拖、牛被拉，人受刑伤——处处掣肘。虽无好的开始，却有好的结局。',
        changing_guidance: '此爻变动时，提示眼下的阻碍撑过去，结局站在你这边。',
      },
      {
        position: 4,
        name: '九四',
        classical: '睽孤，遇元夫，交孚，厉无咎。',
        modern_interpretation: '孤立无援之际遇到可信的同道，彼此以诚相交——虽危无咎。',
        changing_guidance: '此爻变动时，提示孤立时更要识别真正的盟友。',
      },
      {
        position: 5,
        name: '六五',
        classical: '悔亡。厥宗噬肤，往何咎？',
        modern_interpretation: '悔恨消散。同宗之人亲密相合，前往有什么过错？',
        changing_guidance: '此爻变动时，提示信任已经建立，放心走近一步。',
      },
      {
        position: 6,
        name: '上九',
        classical: '睽孤，见豕负涂，载鬼一车。先张之弧，后说之弧。匪寇婚媾，往遇雨则吉。',
        modern_interpretation:
          '乖离至极，满眼猜疑幻象，先张弓又放下——原来对方是来结好的。疑云化雨则吉。',
        changing_guidance: '此爻变动时，提示放下最深的猜疑，误会解开即是转机。',
      },
    ],
  },
  // #39 蹇 — 水山
  {
    number: 39,
    name: { chinese: '蹇', pinyin: 'jiǎn', english: 'Obstruction' },
    trigrams: { upper: '坎 (水)', lower: '艮 (山)' },
    judgment: {
      classical: '蹇：利西南，不利东北。利见大人，贞吉。',
      modern_interpretation:
        '前有险阻，行路艰难。宜走平易之路，不宜硬闯险地；宜求贤者相助，守正即吉。',
      keywords: ['险阻', '反身', '借力', '择路'],
    },
    image: {
      classical: '山上有水，蹇；君子以反身修德。',
      modern_interpretation: '山上有水，行路维艰；君子据此反求诸己、修养德行。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '往蹇来誉。',
        modern_interpretation: '前往则陷于难，归来反得称誉。',
        changing_guidance: '此爻变动时，提示此路不通就回来，回来不丢人。',
      },
      {
        position: 2,
        name: '六二',
        classical: '王臣蹇蹇，匪躬之故。',
        modern_interpretation: '为公事而不避艰险，所为并非一己之私。',
        changing_guidance: '此爻变动时，提示为该做的事赴难，问心无愧。',
      },
      {
        position: 3,
        name: '九三',
        classical: '往蹇来反。',
        modern_interpretation: '前往有难，返回安处。',
        changing_guidance: '此爻变动时，提示退回可靠的据点，安顿好再说。',
      },
      {
        position: 4,
        name: '六四',
        classical: '往蹇来连。',
        modern_interpretation: '前往有难，归来与众相连——结伴共渡。',
        changing_guidance: '此爻变动时，提示一个人闯不过去，回来找同伴。',
      },
      {
        position: 5,
        name: '九五',
        classical: '大蹇朋来。',
        modern_interpretation: '大难之中，朋友来助。',
        changing_guidance: '此爻变动时，提示大困之时会看清谁与你同行。',
      },
      {
        position: 6,
        name: '上六',
        classical: '往蹇来硕，吉。利见大人。',
        modern_interpretation: '前往有难，归来却有大收获——吉，宜见贤者。',
        changing_guidance: '此爻变动时，提示从险阻中带回的经验，是最大的所得。',
      },
    ],
  },
  // #40 解 — 雷水
  {
    number: 40,
    name: { chinese: '解', pinyin: 'xiè', english: 'Deliverance' },
    trigrams: { upper: '震 (雷)', lower: '坎 (水)' },
    judgment: {
      classical: '解：利西南。无所往，其来复吉。有攸往，夙吉。',
      modern_interpretation: '险难消解之时。无事则安然复常即吉；有事要办，趁早为吉。',
      keywords: ['解困', '宽宥', '及时', '复常'],
    },
    image: {
      classical: '雷雨作，解；君子以赦过宥罪。',
      modern_interpretation: '雷雨大作，郁结尽解；君子据此赦免过失、宽宥罪愆。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '无咎。',
        modern_interpretation: '难既解，安静守常——无咎。',
        changing_guidance: '此爻变动时，提示危机刚过，什么都不折腾最好。',
      },
      {
        position: 2,
        name: '九二',
        classical: '田获三狐，得黄矢，贞吉。',
        modern_interpretation: '田猎获三狐、得金箭——除去隐患而得中直之道，守正即吉。',
        changing_guidance: '此爻变动时，提示清除藏着的隐患，用光明正当的方式。',
      },
      {
        position: 3,
        name: '六三',
        classical: '负且乘，致寇至，贞吝。',
        modern_interpretation: '背着重物又坐大车，招摇而招来盗寇——名不副实必有憾。',
        changing_guidance: '此爻变动时，警示占着与自己不相称的位置，麻烦会找上门。',
      },
      {
        position: 4,
        name: '九四',
        classical: '解而拇，朋至斯孚。',
        modern_interpretation: '解开脚趾上的纠缠，摆脱不当的依附，真朋友才会以诚相来。',
        changing_guidance: '此爻变动时，提示断开消耗你的关系，好的关系才进得来。',
      },
      {
        position: 5,
        name: '六五',
        classical: '君子维有解，吉。有孚于小人。',
        modern_interpretation: '君子自解其结，吉；小人见之也心服而退。',
        changing_guidance: '此爻变动时，提示以自身的清明化解纠葛，无须硬碰。',
      },
      {
        position: 6,
        name: '上六',
        classical: '公用射隼于高墉之上，获之，无不利。',
        modern_interpretation: '在高墙上射下鸷鸟，一举而获——待时而动，无所不利。',
        changing_guidance: '此爻变动时，提示工具在手、时机已到，果断出手。',
      },
    ],
  },
]
