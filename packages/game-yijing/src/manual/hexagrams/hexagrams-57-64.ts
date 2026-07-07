// Hexagrams #57–#64 — King Wen order.
// Classical texts follow the received text (通行本); authored fields match the
// register of the original entries.

import type { HexagramEntry } from '../schema'

export const HEXAGRAMS_57_64: HexagramEntry[] = [
  // #57 巽 — 风风
  {
    number: 57,
    name: { chinese: '巽', pinyin: 'xùn', english: 'The Gentle / Wind' },
    trigrams: { upper: '巽 (风)', lower: '巽 (风)' },
    judgment: {
      classical: '巽：小亨。利有攸往，利见大人。',
      modern_interpretation: '谦逊顺入，小有亨通。利于有所前往，宜追随贤明之人。',
      keywords: ['顺入', '谦逊', '申命', '有主见'],
    },
    image: {
      classical: '随风，巽；君子以申命行事。',
      modern_interpretation: '风相随而至，无孔不入；君子据此反复申明政令，贯彻行事。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '进退，利武人之贞。',
        modern_interpretation: '进退犹疑——过于卑顺则无主见，宜以武人般的果决守正。',
        changing_guidance: '此爻变动时，提示顺从太久失了主意，给自己一点果断。',
      },
      {
        position: 2,
        name: '九二',
        classical: '巽在床下，用史巫纷若，吉，无咎。',
        modern_interpretation: '谦卑到床下，又能借祝史沟通幽明、表白诚意——吉，无咎。',
        changing_guidance: '此爻变动时，提示放低身段沟通，诚意说透就好。',
      },
      {
        position: 3,
        name: '九三',
        classical: '频巽，吝。',
        modern_interpretation: '勉强地一再屈从，心不甘而屡失据——有憾。',
        changing_guidance: '此爻变动时，警示不情愿的顺从既伤己也误事。',
      },
      {
        position: 4,
        name: '六四',
        classical: '悔亡，田获三品。',
        modern_interpretation: '悔恨消散，田猎获三等之物——柔顺得正，上下皆有所获。',
        changing_guidance: '此爻变动时，提示居中协调的位置，正在给各方带来收获。',
      },
      {
        position: 5,
        name: '九五',
        classical: '贞吉，悔亡，无不利。无初有终。先庚三日，后庚三日，吉。',
        modern_interpretation:
          '守正即吉，悔恨消散。虽无好的开端，却有好的结局；发令前后反复丁宁——吉。',
        changing_guidance: '此爻变动时，提示改令申命要前思后想，交代周全。',
      },
      {
        position: 6,
        name: '上九',
        classical: '巽在床下，丧其资斧，贞凶。',
        modern_interpretation: '卑顺至极，连自己的资财利器都丧失了——凶。',
        changing_guidance: '此爻变动时，警示讨好到失去底线，最先失去的是自己。',
      },
    ],
  },
  // #58 兑 — 泽泽
  {
    number: 58,
    name: { chinese: '兑', pinyin: 'duì', english: 'The Joyous / Lake' },
    trigrams: { upper: '兑 (泽)', lower: '兑 (泽)' },
    judgment: {
      classical: '兑：亨，利贞。',
      modern_interpretation: '喜悦之道，亨通；喜悦须以正道为本，守正有利。',
      keywords: ['喜悦', '真诚', '讲习', '不媚'],
    },
    image: {
      classical: '丽泽，兑；君子以朋友讲习。',
      modern_interpretation: '两泽相连，交相滋润；君子据此与朋友讲习切磋，共同增益。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '和兑，吉。',
        modern_interpretation: '平和中正的喜悦——吉。',
        changing_guidance: '此爻变动时，提示不带企图的和气，最能安人。',
      },
      {
        position: 2,
        name: '九二',
        classical: '孚兑，吉，悔亡。',
        modern_interpretation: '诚信的喜悦，吉，悔恨消散。',
        changing_guidance: '此爻变动时，提示高兴也高兴得真诚，不敷衍。',
      },
      {
        position: 3,
        name: '六三',
        classical: '来兑，凶。',
        modern_interpretation: '主动凑上来讨欢心的喜悦——凶。',
        changing_guidance: '此爻变动时，警示为取悦而来的快乐，代价在后面。',
      },
      {
        position: 4,
        name: '九四',
        classical: '商兑未宁，介疾有喜。',
        modern_interpretation: '权衡该悦于何者而心未安；守住界限、远离谄邪，终有喜。',
        changing_guidance: '此爻变动时，提示在正与不正之间摇摆时，选正的那边。',
      },
      {
        position: 5,
        name: '九五',
        classical: '孚于剥，有厉。',
        modern_interpretation: '信任了侵蚀你的人——有危。',
        changing_guidance: '此爻变动时，警示身边最会哄你的人，未必是对你好的人。',
      },
      {
        position: 6,
        name: '上六',
        classical: '引兑。',
        modern_interpretation: '引诱而来的喜悦，漫无归宿。',
        changing_guidance: '此爻变动时，提示被牵着走的快乐停一停，问问自己要什么。',
      },
    ],
  },
  // #59 涣 — 风水
  {
    number: 59,
    name: { chinese: '涣', pinyin: 'huàn', english: 'Dispersion' },
    trigrams: { upper: '巽 (风)', lower: '坎 (水)' },
    judgment: {
      classical: '涣：亨。王假有庙，利涉大川，利贞。',
      modern_interpretation: '涣散之时，亨通可期。王者至宗庙以聚合人心，利于涉险渡难，守正有利。',
      keywords: ['聚散', '凝心', '化解', '共渡'],
    },
    image: {
      classical: '风行水上，涣；先王以享于帝，立庙。',
      modern_interpretation: '风行水上，波纹散开；先王据此祭享天帝、建立宗庙，以聚拢涣散的人心。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '用拯马壮，吉。',
        modern_interpretation: '涣散之初，借强壮之马及时拯救——吉。',
        changing_guidance: '此爻变动时，提示散的苗头刚起，快借力把它拉回来。',
      },
      {
        position: 2,
        name: '九二',
        classical: '涣奔其机，悔亡。',
        modern_interpretation: '涣散中奔向可依凭之处，悔恨消散。',
        changing_guidance: '此爻变动时，提示乱局中先找到自己的支点。',
      },
      {
        position: 3,
        name: '六三',
        classical: '涣其躬，无悔。',
        modern_interpretation: '涣散己私、舍身赴众——无悔。',
        changing_guidance: '此爻变动时，提示把「我」放小一点，局面就开了。',
      },
      {
        position: 4,
        name: '六四',
        classical: '涣其群，元吉。涣有丘，匪夷所思。',
        modern_interpretation: '涣散朋党小群而成大聚——大吉；散而复聚如丘，超乎常人所料。',
        changing_guidance: '此爻变动时，提示打散小圈子，反而聚成更大的整体。',
      },
      {
        position: 5,
        name: '九五',
        classical: '涣汗其大号，涣王居，无咎。',
        modern_interpretation: '号令如汗发于身、一出不返；散尽积聚以济天下——无咎。',
        changing_guidance: '此爻变动时，提示关键号令一言既出就要兑现，倾力以赴。',
      },
      {
        position: 6,
        name: '上九',
        classical: '涣其血，去逖出，无咎。',
        modern_interpretation: '远离伤害、走出险境——无咎。',
        changing_guidance: '此爻变动时，提示离开会让你受伤的地方，走远一点。',
      },
    ],
  },
  // #60 节 — 水泽
  {
    number: 60,
    name: { chinese: '节', pinyin: 'jié', english: 'Limitation' },
    trigrams: { upper: '坎 (水)', lower: '兑 (泽)' },
    judgment: {
      classical: '节：亨。苦节不可贞。',
      modern_interpretation: '节制之道，亨通。但节制到苦涩难堪的程度，就不可长守了。',
      keywords: ['节制', '分寸', '可持续', '不自苦'],
    },
    image: {
      classical: '泽上有水，节；君子以制数度，议德行。',
      modern_interpretation: '泽上有水，满则须节；君子据此制定制度分寸，衡量德行。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '不出户庭，无咎。',
        modern_interpretation: '知道通道不畅便不出门户——无咎。',
        changing_guidance: '此爻变动时，提示该收着的时候就收着，不出手也是判断。',
      },
      {
        position: 2,
        name: '九二',
        classical: '不出门庭，凶。',
        modern_interpretation: '该出门时仍闭门不出，错失时机——凶。',
        changing_guidance: '此爻变动时，警示节制过头成了错过，该动就动。',
      },
      {
        position: 3,
        name: '六三',
        classical: '不节若，则嗟若，无咎。',
        modern_interpretation: '不知节制，事后嗟叹自悔；能自悔则无咎可归。',
        changing_guidance: '此爻变动时，提示这声叹息是学费，下次收着点。',
      },
      {
        position: 4,
        name: '六四',
        classical: '安节，亨。',
        modern_interpretation: '安然自适的节制，不觉勉强——亨通。',
        changing_guidance: '此爻变动时，提示把节制过成习惯，就不辛苦了。',
      },
      {
        position: 5,
        name: '九五',
        classical: '甘节，吉，往有尚。',
        modern_interpretation: '甘美的节制，自己受用、他人乐从——吉，前往必受推崇。',
        changing_guidance: '此爻变动时，提示让自律成为让人愿意跟随的样子。',
      },
      {
        position: 6,
        name: '上六',
        classical: '苦节，贞凶，悔亡。',
        modern_interpretation: '苦涩的节制，长守则凶；及时知悔，悔恨可消。',
        changing_guidance: '此爻变动时，警示自苦式的坚持该松绑了。',
      },
    ],
  },
  // #61 中孚 — 风泽
  {
    number: 61,
    name: { chinese: '中孚', pinyin: 'zhōng fú', english: 'Inner Truth' },
    trigrams: { upper: '巽 (风)', lower: '兑 (泽)' },
    judgment: {
      classical: '中孚：豚鱼吉，利涉大川，利贞。',
      modern_interpretation: '诚信发自中心，连豚鱼般微贱之物都能感化——吉。利于涉险渡难，守正有利。',
      keywords: ['诚信', '感通', '由衷', '及物'],
    },
    image: {
      classical: '泽上有风，中孚；君子以议狱缓死。',
      modern_interpretation: '风行泽上，感而应之；君子据此审议狱讼、慎缓死刑。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '虞吉，有它不燕。',
        modern_interpretation: '审度可信而后信，吉；三心二意则不得安宁。',
        changing_guidance: '此爻变动时，提示信任之前先看准，认了就安心托付。',
      },
      {
        position: 2,
        name: '九二',
        classical: '鸣鹤在阴，其子和之。我有好爵，吾与尔靡之。',
        modern_interpretation:
          '鹤鸣于幽阴之处，其子自然应和；有好酒愿与你共享——至诚相感，不在远近。',
        changing_guidance: '此爻变动时，提示由衷的声音自会有人应和。',
      },
      {
        position: 3,
        name: '六三',
        classical: '得敌，或鼓或罢，或泣或歌。',
        modern_interpretation:
          '遇上势均力敌者，忽而击鼓忽而罢兵，忽而哭忽而歌——把心绪系于外物，便失了主张。',
        changing_guidance: '此爻变动时，警示情绪随对手起落，说明重心已不在自己。',
      },
      {
        position: 4,
        name: '六四',
        classical: '月几望，马匹亡，无咎。',
        modern_interpretation: '月近满而不盈，舍弃同侪之私而上从于正——无咎。',
        changing_guidance: '此爻变动时，提示接近圆满时更要克制，取正舍私。',
      },
      {
        position: 5,
        name: '九五',
        classical: '有孚挛如，无咎。',
        modern_interpretation: '以诚信把人心紧紧连在一起——无咎。',
        changing_guidance: '此爻变动时，提示做那个把大家系在一起的人。',
      },
      {
        position: 6,
        name: '上九',
        classical: '翰音登于天，贞凶。',
        modern_interpretation: '鸡鸣之声硬要登天，虚声高扬而实不至——凶。',
        changing_guidance: '此爻变动时，警示名声跑到实力前面去了，赶紧补实。',
      },
    ],
  },
  // #62 小过 — 雷山
  {
    number: 62,
    name: { chinese: '小过', pinyin: 'xiǎo guò', english: 'Small Exceeding' },
    trigrams: { upper: '震 (雷)', lower: '艮 (山)' },
    judgment: {
      classical: '小过：亨，利贞。可小事，不可大事。飞鸟遗之音，不宜上，宜下，大吉。',
      modern_interpretation:
        '小有过越之时，亨通，守正有利。可做小事，不可做大事；如飞鸟留音，宜下不宜上——放低姿态，大吉。',
      keywords: ['小事', '放低', '务实', '过犹不及'],
    },
    image: {
      classical: '山上有雷，小过；君子以行过乎恭，丧过乎哀，用过乎俭。',
      modern_interpretation:
        '雷在山上，声过其常；君子据此行事恭敬得稍过些，居丧哀戚得稍过些，用度节俭得稍过些。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '飞鸟以凶。',
        modern_interpretation: '小鸟不安于枝，急于高飞——凶。',
        changing_guidance: '此爻变动时，警示翅膀还没硬就往上冲，先落回来。',
      },
      {
        position: 2,
        name: '六二',
        classical: '过其祖，遇其妣；不及其君，遇其臣。无咎。',
        modern_interpretation: '越过祖辈而遇祖母，不及于君而安于臣位——过而有度，无咎。',
        changing_guidance: '此爻变动时，提示往前走但不越本分，刚好。',
      },
      {
        position: 3,
        name: '九三',
        classical: '弗过防之，从或戕之，凶。',
        modern_interpretation: '不肯多加防备，放任而行，恐遭伤害——凶。',
        changing_guidance: '此爻变动时，警示此刻宁可防过头，不可少设防。',
      },
      {
        position: 4,
        name: '九四',
        classical: '无咎，弗过遇之。往厉必戒，勿用永贞。',
        modern_interpretation: '无咎，不越分而恰如其分地相处；前往有危须戒惧，也不可一味固守。',
        changing_guidance: '此爻变动时，提示进要谨慎，守也别守死，随时势调整。',
      },
      {
        position: 5,
        name: '六五',
        classical: '密云不雨，自我西郊。公弋取彼在穴。',
        modern_interpretation: '浓云不雨，时机未成；王公射取穴中之物——从低处、实处取用人才与办法。',
        changing_guidance: '此爻变动时，提示大动作等不来，先从近处实处下手。',
      },
      {
        position: 6,
        name: '上六',
        classical: '弗遇过之，飞鸟离之，凶。是谓灾眚。',
        modern_interpretation: '不知收敛而越飞越高，如飞鸟自投罗网——凶，这就叫自招灾祸。',
        changing_guidance: '此爻变动时，警示越过了所有的度，回头是唯一的路。',
      },
    ],
  },
  // #63 既济 — 水火
  {
    number: 63,
    name: { chinese: '既济', pinyin: 'jì jì', english: 'After Completion' },
    trigrams: { upper: '坎 (水)', lower: '离 (火)' },
    judgment: {
      classical: '既济：亨，小利贞。初吉终乱。',
      modern_interpretation:
        '大事已成，亨通，小处仍须守正。起初皆吉，若懈怠则终归于乱——成了，更要守。',
      keywords: ['已成', '守成', '慎终', '防乱'],
    },
    image: {
      classical: '水在火上，既济；君子以思患而豫防之。',
      modern_interpretation: '水在火上，烹煮已成；君子据此思虑后患，预先防备。',
    },
    lines: [
      {
        position: 1,
        name: '初九',
        classical: '曳其轮，濡其尾，无咎。',
        modern_interpretation: '拖住车轮、沾湿尾巴，放慢过河的速度——无咎。',
        changing_guidance: '此爻变动时，提示成功的开局更要压住速度。',
      },
      {
        position: 2,
        name: '六二',
        classical: '妇丧其茀，勿逐，七日得。',
        modern_interpretation: '妇人丢了车帷，不必追寻，七日自得。',
        changing_guidance: '此爻变动时，提示暂时失去的体面不必急着找回，时候到了自然回来。',
      },
      {
        position: 3,
        name: '九三',
        classical: '高宗伐鬼方，三年克之。小人勿用。',
        modern_interpretation: '高宗伐鬼方，三年方克——大事之成极耗心力；成后切不可任用小人。',
        changing_guidance: '此爻变动时，提示打下来的成果，别交到错的人手里。',
      },
      {
        position: 4,
        name: '六四',
        classical: '繻有衣袽，终日戒。',
        modern_interpretation: '船有缝隙，备好堵漏的碎絮，整日戒备。',
        changing_guidance: '此爻变动时，提示检查那条你知道的裂缝，备好补丁。',
      },
      {
        position: 5,
        name: '九五',
        classical: '东邻杀牛，不如西邻之禴祭，实受其福。',
        modern_interpretation: '东邻杀牛盛祭，不如西邻薄祭而诚——实惠之福归于至诚。',
        changing_guidance: '此爻变动时，提示排场不如诚意，实在的投入才有实在的回报。',
      },
      {
        position: 6,
        name: '上六',
        classical: '濡其首，厉。',
        modern_interpretation: '过河过到头也浸入水中——沉溺于既成，危险。',
        changing_guidance: '此爻变动时，警示别在庆功里泡太久，风险已在聚集。',
      },
    ],
  },
  // #64 未济 — 火水
  {
    number: 64,
    name: { chinese: '未济', pinyin: 'wèi jì', english: 'Before Completion' },
    trigrams: { upper: '离 (火)', lower: '坎 (水)' },
    judgment: {
      classical: '未济：亨。小狐汔济，濡其尾，无攸利。',
      modern_interpretation:
        '事尚未成，仍可亨通。小狐过河将成之际沾湿了尾巴——差最后一步而失，无所利。未竟之时，慎终如始。',
      keywords: ['未成', '将济', '审慎', '续力'],
    },
    image: {
      classical: '火在水上，未济；君子以慎辨物居方。',
      modern_interpretation: '火在水上，各不相济；君子据此审慎地辨别事物，使其各居其位。',
    },
    lines: [
      {
        position: 1,
        name: '初六',
        classical: '濡其尾，吝。',
        modern_interpretation: '起步就沾湿了尾巴，力有未逮——有憾。',
        changing_guidance: '此爻变动时，提示准备不足就下水，先退回来补课。',
      },
      {
        position: 2,
        name: '九二',
        classical: '曳其轮，贞吉。',
        modern_interpretation: '拖住车轮，不急于冒进——守正即吉。',
        changing_guidance: '此爻变动时，提示有实力也要按住节奏，等对的时点。',
      },
      {
        position: 3,
        name: '六三',
        classical: '未济，征凶。利涉大川。',
        modern_interpretation: '时机未至而强行，凶；但大方向上，终须渡过这条大川。',
        changing_guidance: '此爻变动时，提示方向没错，只是时机未到——再等一程。',
      },
      {
        position: 4,
        name: '九四',
        classical: '贞吉，悔亡。震用伐鬼方，三年有赏于大国。',
        modern_interpretation: '守正即吉，悔恨消散。奋力征伐，三年而受大国之赏——长期投入终有回报。',
        changing_guidance: '此爻变动时，提示这是一场三年之功的仗，按长期打算发力。',
      },
      {
        position: 5,
        name: '六五',
        classical: '贞吉，无悔。君子之光，有孚，吉。',
        modern_interpretation: '守正即吉，无所懊悔。君子之光辉源于诚信——吉。',
        changing_guidance: '此爻变动时，提示胜利在望，以诚信收束全程。',
      },
      {
        position: 6,
        name: '上九',
        classical: '有孚于饮酒，无咎。濡其首，有孚失是。',
        modern_interpretation: '怀着信心安然饮酒以待时，无咎；但纵饮至于濡首，便失了分寸。',
        changing_guidance: '此爻变动时，提示庆祝可以，别庆祝过头把局面喝丢了。',
      },
    ],
  },
]
