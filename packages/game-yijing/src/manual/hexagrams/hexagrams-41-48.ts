// Hexagrams #41–#48 — King Wen order.
// Classical texts follow the received text (通行本); authored fields match the
// register of the original entries.

import type { HexagramEntry } from '../schema'

export const HEXAGRAMS_41_48: HexagramEntry[] = [
  // #41 损 — 山泽
  {
    number: 41,
    name: { chinese: '损', pinyin: 'sǔn', english: 'Decrease' },
    trigrams: { upper: '艮 (山)', lower: '兑 (泽)' },
    judgment: {
      classical: '损：有孚，元吉，无咎，可贞。利有攸往。曷之用？二簋可用享。',
      modern_interpretation:
        '减损之道，只要心怀诚信，大吉无咎，可以守正前行。用什么祭献？两簋薄礼也足以致敬——诚意胜过丰盛。',
      keywords: ['减损', '诚意', '节制', '取舍'],
    },
    image: {
      classical: '山下有泽，损；君子以惩忿窒欲。',
      modern_interpretation: '山下有泽，损下益上；君子据此克制忿怒、遏止贪欲。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '已事遄往，无咎。酌损之。',
        modern_interpretation: '完成自己的事就快去助人，无咎；但要斟酌分寸，量力而损。',
        changing_guidance: '此爻变动时，提示帮忙要及时，也要有度。',
      },
      {
        position: 2,
        name: '九二',
        classical: '利贞，征凶。弗损益之。',
        modern_interpretation: '守正有利，冒进则凶。不必自损，守住本分就是对人最好的助益。',
        changing_guidance: '此爻变动时，提示不必牺牲自己去成全，站稳即是支持。',
      },
      {
        position: 3,
        name: '六三',
        classical: '三人行，则损一人；一人行，则得其友。',
        modern_interpretation: '三人同行必损一人，一人独行反得其友——专一才有真正的同伴。',
        changing_guidance: '此爻变动时，提示关系贵精不贵多。',
      },
      {
        position: 4,
        name: '六四',
        classical: '损其疾，使遄有喜，无咎。',
        modern_interpretation: '减损自己的毛病，越快越好——有喜而无咎。',
        changing_guidance: '此爻变动时，提示改掉那个明知道的毛病，就是当下最大的增益。',
      },
      {
        position: 5,
        name: '六五',
        classical: '或益之十朋之龟，弗克违，元吉。',
        modern_interpretation: '有人送来十朋大龟般的厚益，辞也辞不掉——大吉。',
        changing_guidance: '此爻变动时，提示诚心自守的人，福气会自己找来。',
      },
      {
        position: 6,
        name: '上九',
        classical: '弗损益之，无咎，贞吉。利有攸往，得臣无家。',
        modern_interpretation: '不损人而能益人，无咎，守正即吉；天下归心，得众而无私。',
        changing_guidance: '此爻变动时，提示以不损人的方式成事，人心自来。',
      },
    ],
  },
  // #42 益 — 风雷
  {
    number: 42,
    name: { chinese: '益', pinyin: 'yì', english: 'Increase' },
    trigrams: { upper: '巽 (风)', lower: '震 (雷)' },
    judgment: {
      classical: '益：利有攸往，利涉大川。',
      modern_interpretation: '增益之时，利于有所前往，值得涉险成事。',
      keywords: ['增益', '迁善', '行动', '共赢'],
    },
    image: {
      classical: '风雷，益；君子以见善则迁，有过则改。',
      modern_interpretation: '风雷相助，其势愈增；君子据此见善即学、有过即改。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '利用为大作，元吉，无咎。',
        modern_interpretation: '得势得助，适合大干一场——大吉，无咎。',
        changing_guidance: '此爻变动时，提示资源到位了，放手去做大事。',
      },
      {
        position: 2,
        name: '六二',
        classical: '或益之十朋之龟，弗克违。永贞吉。王用享于帝，吉。',
        modern_interpretation: '厚益自来，辞不掉；长守正道即吉，至诚可以通天。',
        changing_guidance: '此爻变动时，提示保持谦虚正直，好事会持续。',
      },
      {
        position: 3,
        name: '六三',
        classical: '益之用凶事，无咎。有孚中行，告公用圭。',
        modern_interpretation: '在患难之事上受益成长，无咎；只要诚信中正、光明磊落。',
        changing_guidance: '此爻变动时，提示危机也是滋养，用得正当就是增益。',
      },
      {
        position: 4,
        name: '六四',
        classical: '中行告公从，利用为依迁国。',
        modern_interpretation: '行中道而进言，得到信从——可以托付迁国大事。',
        changing_guidance: '此爻变动时，提示以公心提议，大变动也能获得支持。',
      },
      {
        position: 5,
        name: '九五',
        classical: '有孚惠心，勿问元吉。有孚惠我德。',
        modern_interpretation: '以诚心惠泽于人，不必问也知大吉；人们也会以诚回报。',
        changing_guidance: '此爻变动时，提示真心利他，回响自然到来。',
      },
      {
        position: 6,
        name: '上九',
        classical: '莫益之，或击之，立心勿恒，凶。',
        modern_interpretation: '无人再助，反有人攻击——居心不恒、求益无厌者凶。',
        changing_guidance: '此爻变动时，警示索取太久没有回馈，关系正在反噬。',
      },
    ],
  },
  // #43 夬 — 泽天
  {
    number: 43,
    name: { chinese: '夬', pinyin: 'guài', english: 'Breakthrough' },
    trigrams: { upper: '兑 (泽)', lower: '乾 (天)' },
    judgment: {
      classical: '夬：扬于王庭，孚号有厉。告自邑，不利即戎。利有攸往。',
      modern_interpretation:
        '决断清除之时——把问题公开于庭，诚心疾呼并警示危险；先从自己处着手，不宜诉诸武力。利于前行。',
      keywords: ['决断', '公开', '除弊', '不恃武'],
    },
    image: {
      classical: '泽上于天，夬；君子以施禄及下，居德则忌。',
      modern_interpretation: '泽水升于天上，势将决降；君子据此施惠于下，忌讳居功自傲。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '壮于前趾，往不胜为咎。',
        modern_interpretation: '逞强于脚趾就冒进，力不能胜，前往即咎。',
        changing_guidance: '此爻变动时，警示没有胜算的冲锋，只会把自己搭进去。',
      },
      {
        position: 2,
        name: '九二',
        classical: '惕号，莫夜有戎，勿恤。',
        modern_interpretation: '警惕呼号，即使夜半有兵戎，也不足忧——有备无患。',
        changing_guidance: '此爻变动时，提示把预警做足，就不怕突发。',
      },
      {
        position: 3,
        name: '九三',
        classical: '壮于頄，有凶。君子夬夬独行，遇雨若濡，有愠，无咎。',
        modern_interpretation: '怒形于色则凶。君子决意独行，蒙受误解如遇雨湿身，虽有愠也无咎。',
        changing_guidance: '此爻变动时，提示决心放在心里，脸色不必带出来。',
      },
      {
        position: 4,
        name: '九四',
        classical: '臀无肤，其行次且。牵羊悔亡，闻言不信。',
        modern_interpretation: '坐立不安、行走踌躇；若能被引导而随行，悔可消——可惜听劝而不信。',
        changing_guidance: '此爻变动时，提示有人在给你指路，这次试着听进去。',
      },
      {
        position: 5,
        name: '九五',
        classical: '苋陆夬夬，中行无咎。',
        modern_interpretation: '如斩除苋陆般果断清除积弊，行于中道则无咎。',
        changing_guidance: '此爻变动时，提示对亲近的积习也要下决心，但守住中道。',
      },
      {
        position: 6,
        name: '上六',
        classical: '无号，终有凶。',
        modern_interpretation: '恶贯将尽，哭号也无用——终有凶。',
        changing_guidance: '此爻变动时，警示侥幸撑不到最后，早做了断。',
      },
    ],
  },
  // #44 姤 — 天风
  {
    number: 44,
    name: { chinese: '姤', pinyin: 'gòu', english: 'Coming to Meet' },
    trigrams: { upper: '乾 (天)', lower: '巽 (风)' },
    judgment: {
      classical: '姤：女壮，勿用取女。',
      modern_interpretation: '不期而遇之时，阴柔初长而势将壮大——迎面而来的诱惑不可轻纳。',
      keywords: ['遇合', '警觉', '防微', '辨别'],
    },
    image: {
      classical: '天下有风，姤；后以施命诰四方。',
      modern_interpretation: '风行天下，无物不遇；君主据此发布政令、告谕四方。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '系于金柅，贞吉。有攸往，见凶，羸豕孚蹢躅。',
        modern_interpretation:
          '把它系在金属的车闸上，守正即吉；放任前行则见凶——弱豕虽瘦，躁动难安。',
        changing_guidance: '此爻变动时，提示苗头一露就要按住，别放它长大。',
      },
      {
        position: 2,
        name: '九二',
        classical: '包有鱼，无咎，不利宾。',
        modern_interpretation: '厨中有鱼，先行包容掌控，无咎；但不可任其面客张扬。',
        changing_guidance: '此爻变动时，提示把风险收在自己可控的范围内。',
      },
      {
        position: 3,
        name: '九三',
        classical: '臀无肤，其行次且，厉，无大咎。',
        modern_interpretation: '坐立难安、行走踌躇——处境危殆，但尚无大咎。',
        changing_guidance: '此爻变动时，提示进退失据的时候，先求不犯大错。',
      },
      {
        position: 4,
        name: '九四',
        classical: '包无鱼，起凶。',
        modern_interpretation: '厨中之鱼已失——该掌控的失了控，起而争之则凶。',
        changing_guidance: '此爻变动时，警示失去的势不必强争，先反省为何失去。',
      },
      {
        position: 5,
        name: '九五',
        classical: '以杞包瓜，含章，有陨自天。',
        modern_interpretation: '以高大的杞树荫护甜瓜，内含章美——福分自天而降。',
        changing_guidance: '此爻变动时，提示厚德庇护他人，机运自会垂青。',
      },
      {
        position: 6,
        name: '上九',
        classical: '姤其角，吝，无咎。',
        modern_interpretation: '相遇于角，高亢而无所遇——有憾，但无咎。',
        changing_guidance: '此爻变动时，提示曲高和寡是代价，认了它就不算错。',
      },
    ],
  },
  // #45 萃 — 泽地
  {
    number: 45,
    name: { chinese: '萃', pinyin: 'cuì', english: 'Gathering Together' },
    trigrams: { upper: '兑 (泽)', lower: '坤 (地)' },
    judgment: {
      classical: '萃：亨。王假有庙，利见大人，亨，利贞。用大牲吉，利有攸往。',
      modern_interpretation:
        '会聚之时，亨通。王者至宗庙聚合人心，宜见大人，守正有利；以丰盛之礼相聚则吉，利于前行。',
      keywords: ['聚合', '凝心', '郑重', '备患'],
    },
    image: {
      classical: '泽上于地，萃；君子以除戎器，戒不虞。',
      modern_interpretation: '泽水聚于地上；君子据此修治兵器，戒备意外——人聚之处必防不虞。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '有孚不终，乃乱乃萃。若号，一握为笑，勿恤，往无咎。',
        modern_interpretation: '诚信不能坚持到底，聚了又乱。只要呼求正应，转忧为笑，前往无咎。',
        changing_guidance: '此爻变动时，提示动摇时向可信的人求助，别自己乱。',
      },
      {
        position: 2,
        name: '六二',
        classical: '引吉，无咎。孚乃利用禴。',
        modern_interpretation: '被引荐而聚，吉而无咎；心有诚信，薄祭也可通神。',
        changing_guidance: '此爻变动时，提示顺着善缘走，诚意重于形式。',
      },
      {
        position: 3,
        name: '六三',
        classical: '萃如嗟如，无攸利。往无咎，小吝。',
        modern_interpretation: '想聚而无所应，叹息无利；主动前往依附正者，无咎，小有憾而已。',
        changing_guidance: '此爻变动时，提示没人来找你，就主动去找对的人。',
      },
      {
        position: 4,
        name: '九四',
        classical: '大吉，无咎。',
        modern_interpretation: '广聚人心于正道，唯大吉方能无咎。',
        changing_guidance: '此爻变动时，提示位置微妙，把事做到无可挑剔。',
      },
      {
        position: 5,
        name: '九五',
        classical: '萃有位，无咎。匪孚，元永贞，悔亡。',
        modern_interpretation: '居正位而聚众，无咎；尚有人未信服，长守正德，悔自消散。',
        changing_guidance: '此爻变动时，提示未服者不必强求，以持久的正来赢得。',
      },
      {
        position: 6,
        name: '上六',
        classical: '赍咨涕洟，无咎。',
        modern_interpretation: '叹息流泪，居聚之终而不安；知惧如此，无咎。',
        changing_guidance: '此爻变动时，提示聚散有时，伤感之后妥善收场。',
      },
    ],
  },
  // #46 升 — 地风
  {
    number: 46,
    name: { chinese: '升', pinyin: 'shēng', english: 'Pushing Upward' },
    trigrams: { upper: '坤 (地)', lower: '巽 (风)' },
    judgment: {
      classical: '升：元亨。用见大人，勿恤。南征吉。',
      modern_interpretation: '上升之时，大为亨通。宜进见大人，不必忧虑；向光明处进发，吉。',
      keywords: ['上升', '积累', '顺势', '拾级'],
    },
    image: {
      classical: '地中生木，升；君子以顺德，积小以高大。',
      modern_interpretation: '树木从地中生长而上；君子据此顺养德行，积小步而成高大。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '允升，大吉。',
        modern_interpretation: '得到信任而随之上升——大吉。',
        changing_guidance: '此爻变动时，提示跟着值得信任的人一起上行。',
      },
      {
        position: 2,
        name: '九二',
        classical: '孚乃利用禴，无咎。',
        modern_interpretation: '心怀诚信，薄礼也可通达——无咎。',
        changing_guidance: '此爻变动时，提示实力加诚意，无须包装。',
      },
      {
        position: 3,
        name: '九三',
        classical: '升虚邑。',
        modern_interpretation: '上升如入无人之邑，畅行无阻。',
        changing_guidance: '此爻变动时，提示通道正开着，顺畅时更要专注。',
      },
      {
        position: 4,
        name: '六四',
        classical: '王用亨于岐山，吉，无咎。',
        modern_interpretation: '如王者祭享于岐山，以顺德承事——吉，无咎。',
        changing_guidance: '此爻变动时，提示按部就班地尽本分，就是上升。',
      },
      {
        position: 5,
        name: '六五',
        classical: '贞吉，升阶。',
        modern_interpretation: '守正即吉，如拾阶而上。',
        changing_guidance: '此爻变动时，提示一步一个台阶，别跳级。',
      },
      {
        position: 6,
        name: '上六',
        classical: '冥升，利于不息之贞。',
        modern_interpretation: '昏昧地一味求升，唯有把这股劲用于不息的自修，才有利。',
        changing_guidance: '此爻变动时，警示向上的执念该转向了——升外物不如升自己。',
      },
    ],
  },
  // #47 困 — 泽水
  {
    number: 47,
    name: { chinese: '困', pinyin: 'kùn', english: 'Oppression' },
    trigrams: { upper: '兑 (泽)', lower: '坎 (水)' },
    judgment: {
      classical: '困：亨。贞，大人吉，无咎。有言不信。',
      modern_interpretation:
        '受困之时，仍可亨通。守正自持，大人处困而吉，无咎。此时言语难以取信，多说无益。',
      keywords: ['困境', '守志', '寡言', '自持'],
    },
    image: {
      classical: '泽无水，困；君子以致命遂志。',
      modern_interpretation: '泽中无水，困乏之象；君子据此舍身命也要贯彻其志。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '臀困于株木，入于幽谷，三岁不觌。',
        modern_interpretation: '困坐于枯木，退入幽谷，久不见天日——困而自弃则愈困。',
        changing_guidance: '此爻变动时，警示别往更暗处退，先朝有光的方向挪一步。',
      },
      {
        position: 2,
        name: '九二',
        classical: '困于酒食，朱绂方来，利用亨祀。征凶，无咎。',
        modern_interpretation: '困于酒食未足之际，荣禄将至；以诚敬自守则可，急进则凶。',
        changing_guidance: '此爻变动时，提示转机在路上，别在黎明前乱动。',
      },
      {
        position: 3,
        name: '六三',
        classical: '困于石，据于蒺藜，入于其宫，不见其妻，凶。',
        modern_interpretation: '困于巨石、据于蒺藜，进退皆伤，归家也无所依——凶。',
        changing_guidance: '此爻变动时，警示眼下的路全是硬伤，彻底换个方向。',
      },
      {
        position: 4,
        name: '九四',
        classical: '来徐徐，困于金车，吝，有终。',
        modern_interpretation: '迟迟而来，被富贵之车所阻——虽有憾，终能相合。',
        changing_guidance: '此爻变动时，提示该来的援手迟到了些，但会到。',
      },
      {
        position: 5,
        name: '九五',
        classical: '劓刖，困于赤绂，乃徐有说，利用祭祀。',
        modern_interpretation: '上下受创，困于权位之间；徐徐图之，终得解脱——以至诚自守。',
        changing_guidance: '此爻变动时，提示高位之困急不得，以诚缓解。',
      },
      {
        position: 6,
        name: '上六',
        classical: '困于葛藟，于臲卼，曰动悔有悔，征吉。',
        modern_interpretation: '困于纠缠的藤蔓、立于摇摇欲坠之处；悔悟既生，动而求出则吉。',
        changing_guidance: '此爻变动时，提示困到尽头，行动本身就是出路。',
      },
    ],
  },
  // #48 井 — 水风
  {
    number: 48,
    name: { chinese: '井', pinyin: 'jǐng', english: 'The Well' },
    trigrams: { upper: '坎 (水)', lower: '巽 (风)' },
    judgment: {
      classical: '井：改邑不改井，无丧无得，往来井井。汔至亦未繘井，羸其瓶，凶。',
      modern_interpretation:
        '村邑可迁，井不可移；井水不增不减，供往来者汲用。若汲水将成却断了绳、破了瓶，功亏一篑——凶。',
      keywords: ['滋养', '恒常', '有始有终', '公共'],
    },
    image: {
      classical: '木上有水，井；君子以劳民劝相。',
      modern_interpretation: '木桶提水而上；君子据此慰劳民众、劝勉相助。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '井泥不食，旧井无禽。',
        modern_interpretation: '井底淤泥不可食，废井连禽鸟也不顾。',
        changing_guidance: '此爻变动时，警示久不自新的价值会被遗忘，先清淤。',
      },
      {
        position: 2,
        name: '九二',
        classical: '井谷射鲋，瓮敝漏。',
        modern_interpretation: '井水只够射小鱼，瓮破而漏——有才而不得其用。',
        changing_guidance: '此爻变动时，提示别让才能从破瓮里漏光，找能承接的容器。',
      },
      {
        position: 3,
        name: '九三',
        classical: '井渫不食，为我心恻。可用汲，王明并受其福。',
        modern_interpretation: '井已淘净却无人饮用，令人心恻；一旦被明主汲用，众人同受其福。',
        changing_guidance: '此爻变动时，提示准备已就绪，缺的是被看见——主动让人知道。',
      },
      {
        position: 4,
        name: '六四',
        classical: '井甃，无咎。',
        modern_interpretation: '修砌井壁，暂不供水——自修其身，无咎。',
        changing_guidance: '此爻变动时，提示阶段性的自我修整，值得。',
      },
      {
        position: 5,
        name: '九五',
        classical: '井冽，寒泉食。',
        modern_interpretation: '井水清冽，寒泉可食——德泽清明，人人受益。',
        changing_guidance: '此爻变动时，提示把最好的东西供出来，这就是价值。',
      },
      {
        position: 6,
        name: '上六',
        classical: '井收勿幕，有孚元吉。',
        modern_interpretation: '井功已成，敞开不盖，诚信惠人——大吉。',
        changing_guidance: '此爻变动时，提示成果开放共享，福泽最大。',
      },
    ],
  },
]
