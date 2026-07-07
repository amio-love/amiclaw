import { describe, expect, it } from 'vitest'
import { hexagramByNumber } from './index'

/* Received-text baseline — character-level assertions against the 通行本
 * (阮元刻本系受本, the manager-ruled edition standard for this dataset).
 *
 * Covers the union of both verification rounds' audited hexagrams. Unlike the
 * structural sweep in manual-data.test.ts (which cannot judge wording), each
 * entry here is a full independent transcription: judgment + image + all six
 * line texts (+ 用九/用六 on 乾/坤) asserted as exact strings, so any silent
 * wording or character drift in these entries fails character-by-character. */

interface Baseline {
  judgment: string
  image: string
  lines: [string, string, string, string, string, string]
  extra?: { label: '用九' | '用六'; classical: string }
}

const BASELINE: Record<number, Baseline> = {
  1: {
    judgment: '乾：元，亨，利，贞。',
    image: '天行健，君子以自强不息。',
    lines: [
      '潜龙勿用。',
      '见龙在田，利见大人。',
      '君子终日乾乾，夕惕若厉，无咎。',
      '或跃在渊，无咎。',
      '飞龙在天，利见大人。',
      '亢龙有悔。',
    ],
    extra: { label: '用九', classical: '见群龙无首，吉。' },
  },
  2: {
    judgment: '坤：元亨，利牝马之贞。君子有攸往，先迷后得主，利。西南得朋，东北丧朋。安贞吉。',
    image: '地势坤，君子以厚德载物。',
    lines: [
      '履霜，坚冰至。',
      '直方大，不习无不利。',
      '含章可贞。或从王事，无成有终。',
      '括囊，无咎无誉。',
      '黄裳，元吉。',
      '龙战于野，其血玄黄。',
    ],
    extra: { label: '用六', classical: '利永贞。' },
  },
  3: {
    judgment: '屯：元亨，利贞。勿用有攸往，利建侯。',
    image: '云雷，屯；君子以经纶。',
    lines: [
      '磐桓，利居贞，利建侯。',
      '屯如邅如，乘马班如。匪寇婚媾，女子贞不字，十年乃字。',
      '即鹿无虞，惟入于林中，君子几不如舍，往吝。',
      '乘马班如，求婚媾，往吉，无不利。',
      '屯其膏，小贞吉，大贞凶。',
      '乘马班如，泣血涟如。',
    ],
  },
  8: {
    judgment: '比：吉。原筮，元永贞，无咎。不宁方来，后夫凶。',
    image: '地上有水，比；先王以建万国，亲诸侯。',
    lines: [
      '有孚比之，无咎。有孚盈缶，终来有它，吉。',
      '比之自内，贞吉。',
      '比之匪人。',
      '外比之，贞吉。',
      '显比。王用三驱，失前禽，邑人不诫，吉。',
      '比之无首，凶。',
    ],
  },
  11: {
    judgment: '泰：小往大来，吉，亨。',
    image: '天地交，泰；后以财成天地之道，辅相天地之宜，以左右民。',
    lines: [
      '拔茅茹，以其汇，征吉。',
      '包荒，用冯河，不遐遗，朋亡，得尚于中行。',
      '无平不陂，无往不复。艰贞无咎，勿恤其孚，于食有福。',
      '翩翩，不富以其邻，不戒以孚。',
      '帝乙归妹，以祉元吉。',
      '城复于隍，勿用师。自邑告命，贞吝。',
    ],
  },
  12: {
    judgment: '否之匪人，不利君子贞，大往小来。',
    image: '天地不交，否；君子以俭德辟难，不可荣以禄。',
    lines: [
      '拔茅茹，以其汇，贞吉，亨。',
      '包承，小人吉，大人否，亨。',
      '包羞。',
      '有命无咎，畴离祉。',
      '休否，大人吉。其亡其亡，系于苞桑。',
      '倾否，先否后喜。',
    ],
  },
  15: {
    judgment: '谦：亨，君子有终。',
    image: '地中有山，谦；君子以裒多益寡，称物平施。',
    lines: [
      '谦谦君子，用涉大川，吉。',
      '鸣谦，贞吉。',
      '劳谦，君子有终，吉。',
      '无不利，撝谦。',
      '不富以其邻，利用侵伐，无不利。',
      '鸣谦，利用行师，征邑国。',
    ],
  },
  24: {
    judgment: '复：亨。出入无疾，朋来无咎。反复其道，七日来复。利有攸往。',
    image: '雷在地中，复；先王以至日闭关，商旅不行，后不省方。',
    lines: [
      '不远复，无祗悔，元吉。',
      '休复，吉。',
      '频复，厉，无咎。',
      '中行独复。',
      '敦复，无悔。',
      '迷复，凶，有灾眚。用行师，终有大败；以其国君凶，至于十年不克征。',
    ],
  },
  29: {
    judgment: '习坎：有孚，维心亨，行有尚。',
    image: '水洊至，习坎；君子以常德行，习教事。',
    lines: [
      '习坎，入于坎窞，凶。',
      '坎有险，求小得。',
      '来之坎坎，险且枕，入于坎窞，勿用。',
      '樽酒簋贰，用缶，纳约自牖，终无咎。',
      '坎不盈，祗既平，无咎。',
      '系用徽纆，寘于丛棘，三岁不得，凶。',
    ],
  },
  30: {
    judgment: '离：利贞，亨。畜牝牛，吉。',
    image: '明两作，离；大人以继明照于四方。',
    lines: [
      '履错然，敬之，无咎。',
      '黄离，元吉。',
      '日昃之离，不鼓缶而歌，则大耋之嗟，凶。',
      '突如其来如，焚如，死如，弃如。',
      '出涕沱若，戚嗟若，吉。',
      '王用出征，有嘉折首，获匪其丑，无咎。',
    ],
  },
  31: {
    judgment: '咸：亨，利贞。取女吉。',
    image: '山上有泽，咸；君子以虚受人。',
    lines: [
      '咸其拇。',
      '咸其腓，凶。居吉。',
      '咸其股，执其随，往吝。',
      '贞吉，悔亡。憧憧往来，朋从尔思。',
      '咸其脢，无悔。',
      '咸其辅颊舌。',
    ],
  },
  38: {
    judgment: '睽：小事吉。',
    image: '上火下泽，睽；君子以同而异。',
    lines: [
      '悔亡。丧马勿逐，自复。见恶人，无咎。',
      '遇主于巷，无咎。',
      '见舆曳，其牛掣，其人天且劓。无初有终。',
      '睽孤，遇元夫，交孚，厉无咎。',
      '悔亡。厥宗噬肤，往何咎？',
      '睽孤，见豕负涂，载鬼一车。先张之弧，后说之弧。匪寇婚媾，往遇雨则吉。',
    ],
  },
  44: {
    judgment: '姤：女壮，勿用取女。',
    image: '天下有风，姤；后以施命诰四方。',
    lines: [
      '系于金柅，贞吉。有攸往，见凶，羸豕孚蹢躅。',
      '包有鱼，无咎，不利宾。',
      '臀无肤，其行次且，厉，无大咎。',
      '包无鱼，起凶。',
      '以杞包瓜，含章，有陨自天。',
      '姤其角，吝，无咎。',
    ],
  },
  47: {
    judgment: '困：亨。贞，大人吉，无咎。有言不信。',
    image: '泽无水，困；君子以致命遂志。',
    lines: [
      '臀困于株木，入于幽谷，三岁不觌。',
      '困于酒食，朱绂方来，利用亨祀。征凶，无咎。',
      '困于石，据于蒺藜，入于其宫，不见其妻，凶。',
      '来徐徐，困于金车，吝，有终。',
      '劓刖，困于赤绂，乃徐有说，利用祭祀。',
      '困于葛藟，于臲卼，曰动悔有悔，征吉。',
    ],
  },
  49: {
    judgment: '革：己日乃孚，元亨，利贞，悔亡。',
    image: '泽中有火，革；君子以治历明时。',
    lines: [
      '巩用黄牛之革。',
      '己日乃革之，征吉，无咎。',
      '征凶，贞厉。革言三就，有孚。',
      '悔亡，有孚改命，吉。',
      '大人虎变，未占有孚。',
      '君子豹变，小人革面。征凶，居贞吉。',
    ],
  },
  50: {
    judgment: '鼎：元吉，亨。',
    image: '木上有火，鼎；君子以正位凝命。',
    lines: [
      '鼎颠趾，利出否。得妾以其子，无咎。',
      '鼎有实，我仇有疾，不我能即，吉。',
      '鼎耳革，其行塞，雉膏不食。方雨亏悔，终吉。',
      '鼎折足，覆公餗，其形渥，凶。',
      '鼎黄耳金铉，利贞。',
      '鼎玉铉，大吉，无不利。',
    ],
  },
  55: {
    judgment: '丰：亨，王假之。勿忧，宜日中。',
    image: '雷电皆至，丰；君子以折狱致刑。',
    lines: [
      '遇其配主，虽旬无咎，往有尚。',
      '丰其蔀，日中见斗。往得疑疾，有孚发若，吉。',
      '丰其沛，日中见沬。折其右肱，无咎。',
      '丰其蔀，日中见斗。遇其夷主，吉。',
      '来章，有庆誉，吉。',
      '丰其屋，蔀其家，窥其户，阒其无人，三岁不觌，凶。',
    ],
  },
  56: {
    judgment: '旅：小亨，旅贞吉。',
    image: '山上有火，旅；君子以明慎用刑而不留狱。',
    lines: [
      '旅琐琐，斯其所取灾。',
      '旅即次，怀其资，得童仆贞。',
      '旅焚其次，丧其童仆，贞厉。',
      '旅于处，得其资斧，我心不快。',
      '射雉，一矢亡，终以誉命。',
      '鸟焚其巢，旅人先笑后号咷。丧牛于易，凶。',
    ],
  },
  59: {
    judgment: '涣：亨。王假有庙，利涉大川，利贞。',
    image: '风行水上，涣；先王以享于帝，立庙。',
    lines: [
      '用拯马壮，吉。',
      '涣奔其机，悔亡。',
      '涣其躬，无悔。',
      '涣其群，元吉。涣有丘，匪夷所思。',
      '涣汗其大号，涣王居，无咎。',
      '涣其血，去逖出，无咎。',
    ],
  },
  63: {
    judgment: '既济：亨，小利贞。初吉终乱。',
    image: '水在火上，既济；君子以思患而豫防之。',
    lines: [
      '曳其轮，濡其尾，无咎。',
      '妇丧其茀，勿逐，七日得。',
      '高宗伐鬼方，三年克之。小人勿用。',
      '繻有衣袽，终日戒。',
      '东邻杀牛，不如西邻之禴祭，实受其福。',
      '濡其首，厉。',
    ],
  },
  64: {
    judgment: '未济：亨。小狐汔济，濡其尾，无攸利。',
    image: '火在水上，未济；君子以慎辨物居方。',
    lines: [
      '濡其尾，吝。',
      '曳其轮，贞吉。',
      '未济，征凶。利涉大川。',
      '贞吉，悔亡。震用伐鬼方，三年有赏于大国。',
      '贞吉，无悔。君子之光，有孚，吉。',
      '有孚于饮酒，无咎。濡其首，有孚失是。',
    ],
  },
}

describe('received-text baseline (通行本)', () => {
  const numbers = Object.keys(BASELINE).map(Number)

  it.each(numbers)('#%i matches the received text character-for-character', (n) => {
    const expected = BASELINE[n]
    const entry = hexagramByNumber(n)
    expect(entry).toBeDefined()
    if (!entry) return

    expect(entry.judgment.classical).toBe(expected.judgment)
    expect(entry.image.classical).toBe(expected.image)
    expect(entry.lines.map((line) => line.classical)).toEqual(expected.lines)

    if (expected.extra) {
      expect(entry.extra_line?.label).toBe(expected.extra.label)
      expect(entry.extra_line?.classical).toBe(expected.extra.classical)
    }
  })
})
