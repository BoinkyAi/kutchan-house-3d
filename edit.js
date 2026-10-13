/* Plan editor for the ref-model plans (the refplan.js format). Drag walls,
   doors, windows and furniture; the 3D walkthrough builds from the same model,
   saved in this browser or carried in a share link (#m=...).
   ?plan=b = Budget plan (ref-model-b.json, 3D: index.html?house=4),
   ?plan=c = Mid tier plan (ref-model-c.json, 3D: index.html?house=5) and
   ?plan=d = Ideal plan, L-shaped (ref-model-d.json, 3D: index.html?house=6), each
   saved under its own key. ?plan=f = Compact (house 8) and ?plan=g = Full size (house 9):
   PLANS[x].ichijo = the Ichijo spec panel + catalogue fittings (ichijo.js).
   This file is byte-identical in two apps that never link to each other: kutchan-house-3d
   (<html data-plans="d c b">) and kutchan-house-ichijo (data-plans="g f"); the first plan
   listed is the default, any other ?plan opens it (edit.html's head script invisibly sends old
   links to plans that live in the other app there).
   v20: a model's "carport" (plan d, outside the house) is drawn on the 1F as a
   dashed outline with its posts, and counted in the fit-to-screen.
   v21: a compass on every plan (rose in a corner + the four sides of the drawing
   named, per plan: NORTH below; plan c from its model.compass) and frosted
   windows (op.frost / op.frosted) drawn with a dotted fill: drawing only.
   v23 (PRIMITIVES.md): stacked windows (op.stack, or ops with the same at + w) = one
   bay: a unit-count tag on the outside face, dragged together, units edited in the
   panel; door type parent-child (親子) next to double, both leaves with a swing. */
'use strict';
import { levelGraph, faceAt, polyArea, inPoly, labelPoint, packModel, loadModel, STACK_BAND, childLeaf } from './refplan.js?v=7';

/* the built-in plans: model file, saved copy (localStorage key), 3D page, editor page */
const PLANS = {
  b: { url: 'ref-model-b.json?v=5', key: 'h3dRefModelB', view: 'index.html?house=4', edit: 'edit.html?plan=b' },
  c: { url: 'ref-model-c.json?v=5', key: 'h3dRefModelC', view: 'index.html?house=5', edit: 'edit.html?plan=c' },
  d: { url: 'ref-model-d.json?v=7', key: 'h3dRefModelD', view: 'index.html?house=6', edit: 'edit.html?plan=d' },
  f: { url: 'ref-model-f.json?v=5', key: 'h3dRefModelF', view: 'index.html?house=8', edit: 'edit.html?plan=f', ichijo: true },
  g: { url: 'ref-model-g.json?v=3', key: 'h3dRefModelG', view: 'index.html?house=9', edit: 'edit.html?plan=g', ichijo: true },
};
const APP_PLANS = (document.documentElement.dataset.plans || 'd c b').trim().split(/\s+/).filter(p => PLANS[p]);
const _qPlan = (new URLSearchParams(location.search).get('plan') || '').toLowerCase();
const PLAN = APP_PLANS.includes(_qPlan) ? _qPlan : APP_PLANS[0];
const REF = PLANS[PLAN];
try { localStorage.removeItem('h3dRefModel'); } catch (e) { /* private mode */ }   /* v23: plan a's saved copy */
const PE = !!REF.ichijo;            /* plans f, g (Compact, Full size): the Ichijo spec panel + catalogue fittings (ichijo.js) */

/* ------------------------------------------------------------------ text */
const TX = {
  en: {
    title: 'Plan editor', undo: 'Undo', redo: 'Redo', view3d: 'View in 3D', share: 'Share link', reset: 'Reset', close: 'Close',
    toolsH: 'TOOLS', tSelect: 'Select / move', tWall: 'Draw wall', tDoor: 'Add door', tWindow: 'Add window', tItem: 'Add furniture', tRoom: 'Name a room',
    optH: 'OPTIONS', link: 'Outside walls: all floors', linkT: 'Moving an outside wall moves it on every floor', grid: 'Snap to 455 grid', gridT: 'Snap moves to the 455 mm half-module (otherwise 1 cm)',
    shareH: 'Share this plan', shareNote: 'Anyone with this link sees your edited plan (in the editor and in 3D). Nothing is uploaded: the plan travels inside the link.',
    copy: 'Copy link', copy3d: 'Copy 3D link', copied: 'Link copied',
    floors: ['1F', '2F', 'Loft'],
    hintSel: 'Drag a wall to move it · drag a door, window or furniture · tap a room to rename it · wheel / pinch to zoom, drag empty space to pan',
    hintWall: 'Click to start the wall, click again to end it (keeps drawing; Esc or right-click to stop). Snaps to walls and right angles.',
    hintDoor: 'Click on a wall to put a door there', hintWindow: 'Click on a wall to put a window there',
    hintItem: 'Pick a piece in the panel, then click on the plan to place it', hintRoom: 'Click inside a room to name it',
    wall: 'Wall', opening: 'Opening', item: 'Furniture', room: 'Room', stair: 'Stairs',
    length: 'Length', thick: 'Thickness', kind: 'Type', height: 'Height', del: 'Delete', dup: 'Duplicate',
    wNormal: 'Partition (12 cm)', wOuter: 'Outside wall (18 cm)', wLow: 'Low wall', wLine: 'Room divider (no wall)',
    width: 'Width', sill: 'Bottom', head: 'Top', from: 'From wall start', flip: 'Flip swing', hinge: 'Other hinge',
    oWindow: 'Window', oDoor: 'Door', oDouble: 'Double door', oSliding: 'Sliding door', oSlide: 'Glass sliding door', oEntry: 'Front door', oHole: 'Opening (no door)',
    oParentChild: 'Parent-child door (親子)', childW: 'Small leaf', stackH: 'Stacked above', stackAdd: '+ Stack a window above', band: 'Band below',
    unit: 'Unit', stackedN: 'Stacked bay, units', nextUnit: 'Select the next unit up',
    name: 'Name', nameJa: 'Name (日本語)', floor: 'Floor', level: 'Floor level', area: 'Area',
    fOak: 'Wood (red pine)', fTile: 'Tile', fStone: 'Stone tile (entrance)', fConcrete: 'Concrete', fVoid: 'Open to below (no floor)',
    lv0: 'Normal', lvE: '−25 cm (entrance)', lvP: '−45 cm (porch)',
    depth: 'Depth', rot: 'Rotate', newRoom: 'Room', addDoor: '+ Door', addWin: '+ Window',
    resetQ: 'Throw away your changes and go back to the plan as first drawn?',
    fromLink: 'Opened a shared plan. Your changes save in this browser.',
    saved: 'Saved', tsubo: 'tsubo',
    palette: 'Pick a piece, then click on the plan:',
    stairNote: 'Drag to move the whole stair. Rotate turns it about its centre.',
    lenNote: 'Typing a length moves the wall’s end point (the B end).',
    kinds: { bed: 'Bed', sofa: 'Sofa', table: 'Table', bench: 'Bench', chair: 'Chair', desk: 'Desk / counter', closet: 'Built-in storage', wardrobe: 'Wardrobe', toilet: 'Toilet',
      vanity: 'Washstand', ub: 'Unit bath', shower: 'Shower unit', island: 'Kitchen island', tall: 'Tall kitchen units', fridge: 'Fridge', washer: 'Washing machine', dryer: 'Dryer',
      stove: 'Wood stove', rugRound: 'Round rug', shelves: 'Shelves', rail: 'Hanging rail', post: 'Post', beam: 'Beam',
      tube: 'Soaking tub (hinoki)', saunaBench: 'Sauna bench', saunaHeater: 'Sauna heater', gymRack: 'Power rack', gymBench: 'Weight bench',
      treadmill: 'Treadmill', mat: 'Exercise mat', railing: 'Glass railing',
      showerSystem: 'Shower column', armchair: 'Armchair', bookcase: 'Bookcase', water_heater: 'Water heater', coatHanger: 'Hanging rail',
      tv: 'TV / media unit', 'kitchen.cabinet': 'Kitchen unit', fence: 'Fence', shade: 'Pergola', wallCabinet: 'Wall cabinets', sinkDouble: 'Double sink' },
    help: '<h3>Plan editor</h3>'
      + '<b>Move a wall</b>: drag it. The walls joined to it stretch with it, rooms reshape and their areas update. A straight run of walls moves together. With <b>Outside walls: all floors</b> on, moving an outside wall moves it on every floor (the roof follows).<br>'
      + '<b>Wall ends</b>: select a wall, then drag the round handle at an end to make it longer or shorter.<br>'
      + '<b>Doors, windows, furniture</b>: drag them. Select one to change its size, type or height in the panel, or delete it (<kbd>Del</kbd>).<br>'
      + '<b>New walls</b>: <i>Draw wall</i>, click start and end. <b>Rooms</b> are whatever the walls enclose; <i>Name a room</i> to label one.<br>'
      + '<b>Floors</b>: 1F / 2F / Loft tabs at the top. The floor below shows faintly underneath.<br>'
      + '<b>Undo</b> <kbd>Ctrl Z</kbd> · <b>Redo</b> <kbd>Ctrl Shift Z</kbd> · zoom: wheel or pinch · pan: drag empty space.<br><br>'
      + 'Everything saves in this browser automatically. <b>View in 3D</b> opens the walkthrough of your version; <b>Share link</b> makes a link to send (the plan is inside the link). <b>Reset</b> goes back to the plan as first drawn.<br>'
      + '<span style="opacity:.6"></span>',   /* per plan: planHelp() puts the plan's description here */
    cmp: { n: 'NORTH · neighbour', e: 'EAST · road', s: 'SOUTH · Mt Yotei view', w: 'WEST · snow side' },
    plans: 'Plans', plansT: 'All floor plans on one page',
  },
  ja: {
    title: '間取り編集', undo: '取り消し', redo: 'やり直し', view3d: '3Dで見る', share: '共有リンク', reset: '元の図面に戻す', close: '閉じる',
    toolsH: 'ツール', tSelect: '選択・移動', tWall: '壁を描く', tDoor: 'ドアを追加', tWindow: '窓を追加', tItem: '家具を追加', tRoom: '部屋名をつける',
    optH: 'オプション', link: '外壁は全フロア連動', linkT: '外壁を動かすと全フロアの外壁が一緒に動きます', grid: '455グリッドに吸着', gridT: '455mm（半間）単位で動かす（オフ＝1cm単位）',
    shareH: 'この間取りを共有', shareNote: 'このリンクを開くと、編集した間取り（編集画面と3D）を見られます。データはリンクの中にあり、どこにもアップロードされません。',
    copy: 'リンクをコピー', copy3d: '3Dのリンクをコピー', copied: 'コピーしました',
    floors: ['1F', '2F', 'ロフト'],
    hintSel: '壁をドラッグして移動・ドア/窓/家具もドラッグで移動・部屋をタップして名前を変更・ホイール/ピンチでズーム、何もない所をドラッグで移動',
    hintWall: 'クリックで壁の始点、もう一度クリックで終点（続けて描けます。Escか右クリックで終了）。壁と直角に吸着します。',
    hintDoor: '壁をクリックするとドアを追加', hintWindow: '壁をクリックすると窓を追加',
    hintItem: 'パネルで家具を選び、図面をクリックして配置', hintRoom: '部屋の中をクリックして名前をつける',
    wall: '壁', opening: '開口部', item: '家具', room: '部屋', stair: '階段',
    length: '長さ', thick: '厚さ', kind: '種類', height: '高さ', del: '削除', dup: '複製',
    wNormal: '間仕切り壁（12cm）', wOuter: '外壁（18cm）', wLow: '腰壁', wLine: '部屋の区切り（壁なし）',
    width: '幅', sill: '下端', head: '上端', from: '壁の端から', flip: '開き勝手を反転', hinge: '吊元を反転',
    oWindow: '窓', oDoor: 'ドア', oDouble: '両開きドア', oSliding: '引き戸', oSlide: 'ガラス引き戸', oEntry: '玄関ドア', oHole: '開口（建具なし）',
    oParentChild: '親子ドア', childW: '子扉の幅', stackH: '上に重ねた窓', stackAdd: '＋上に窓を重ねる', band: '下の窓との間',
    unit: '窓', stackedN: '重ねた開口の数', nextUnit: '上の開口を選択',
    name: '名前（英語）', nameJa: '名前', floor: '床', level: '床の高さ', area: '面積',
    fOak: '木（赤松）', fTile: 'タイル', fStone: '石タイル（玄関）', fConcrete: 'コンクリート', fVoid: '吹抜け（床なし）',
    lv0: '標準', lvE: '−25cm（玄関土間）', lvP: '−45cm（風除室）',
    depth: '奥行', rot: '回転', newRoom: '部屋', addDoor: '＋ドア', addWin: '＋窓',
    resetQ: '変更をすべて破棄して、最初の間取りに戻しますか？',
    fromLink: '共有された間取りを開きました。変更はこのブラウザに保存されます。',
    saved: '保存しました', tsubo: '坪',
    palette: '家具を選んでから図面をクリック：',
    stairNote: 'ドラッグで階段全体を移動。回転は中心で回します。',
    lenNote: '長さを入力すると壁の終点（B側）が動きます。',
    kinds: { bed: 'ベッド', sofa: 'ソファ', table: 'テーブル', bench: 'ベンチ', chair: '椅子', desk: 'デスク・カウンター', closet: '造作収納', wardrobe: 'ワードローブ', toilet: 'トイレ',
      vanity: '洗面台', ub: 'ユニットバス', shower: 'シャワーユニット', island: 'アイランドキッチン', tall: 'キッチン収納（背面）', fridge: '冷蔵庫', washer: '洗濯機', dryer: '乾燥機',
      stove: '薪ストーブ', rugRound: '丸ラグ', shelves: '棚', rail: '物干しパイプ', post: '柱', beam: '梁',
      tube: '浴槽（ひのき）', saunaBench: 'サウナベンチ', saunaHeater: 'サウナストーブ', gymRack: 'パワーラック', gymBench: 'トレーニングベンチ',
      treadmill: 'ランニングマシン', mat: 'トレーニングマット', railing: 'ガラス手すり',
      showerSystem: 'シャワー水栓', armchair: 'アームチェア', bookcase: '本棚', water_heater: '給湯器', coatHanger: 'ハンガーパイプ',
      tv: 'テレビ台', 'kitchen.cabinet': 'キッチンユニット', fence: 'フェンス', shade: 'パーゴラ', wallCabinet: '吊戸棚', sinkDouble: 'ダブルシンク' },
    help: '<h3>間取り編集</h3>'
      + '<b>壁を動かす</b>：壁をドラッグします。つながっている壁が伸び縮みし、部屋の形と面積も更新されます。一直線に並んだ壁は一緒に動きます。<b>外壁は全フロア連動</b>がオンのとき、外壁を動かすと全フロアの外壁が動きます（屋根も追従）。<br>'
      + '<b>壁の長さ</b>：壁を選択し、端の丸いハンドルをドラッグして伸ばす・縮める。<br>'
      + '<b>ドア・窓・家具</b>：ドラッグで移動。選択するとパネルで大きさ・種類・高さを変更、または削除（<kbd>Del</kbd>）。<br>'
      + '<b>壁を追加</b>：「壁を描く」で始点と終点をクリック。<b>部屋</b>は壁で囲まれた範囲です。「部屋名をつける」で名前をつけられます。<br>'
      + '<b>フロア</b>：上部の1F / 2F / ロフトで切り替え。下の階はうっすら表示されます。<br>'
      + '<b>取り消し</b> <kbd>Ctrl Z</kbd> ・ <b>やり直し</b> <kbd>Ctrl Shift Z</kbd> ・ ズーム：ホイール／ピンチ ・ 移動：何もない所をドラッグ<br><br>'
      + '変更はこのブラウザに自動保存されます。<b>3Dで見る</b>で編集後の3Dウォークスルー、<b>共有リンク</b>で送れるリンクを作成（データはリンク内）。<b>元の図面に戻す</b>で最初の間取りに戻ります。<br>'
      + '<span style="opacity:.6"></span>',
    cmp: { n: '北・隣地', e: '東・道路', s: '南・羊蹄山の眺望', w: '西・落雪側' },
    plans: '図面一覧', plansT: 'すべての間取り図を1ページで',
  },
};
/* the per-plan strings (?plan=b-g): own title, reset question, extra floor finishes, and the
   help with its own last lines (what Reset goes back to, the floor tabs, the plan's description) */
const HELP_RESET = { en: '<b>Reset</b> goes back to the plan as first drawn.', ja: '<b>元の図面に戻す</b>で最初の間取りに戻ります。' };
const HELP_FLOORS = { en: ['<b>Floors</b>: 1F / 2F / Loft tabs at the top.', '<b>Floors</b>: 1F / 2F tabs at the top.'], ja: ['<b>フロア</b>：上部の1F / 2F / ロフトで切り替え。', '<b>フロア</b>：上部の1F / 2Fで切り替え。'] };
function planHelp(lang, reset, desc, twoFloors) {
  let h = TX[lang].help.replace(HELP_RESET[lang], reset);
  if (twoFloors) h = h.replace(HELP_FLOORS[lang][0], HELP_FLOORS[lang][1]);
  return h.replace(/<span style="opacity:\.6">[\s\S]*<\/span>$/, () => '<span style="opacity:.6">' + desc + '</span>');
}
const FIN = { en: { fGranite: 'Dark stone (bath)', fHinoki: 'Hinoki (sauna)', fRubber: 'Rubber (gym)' }, ja: { fGranite: '黒い石調タイル（浴室）', fHinoki: 'ひのき（サウナ）', fRubber: 'ゴム床（ジム）' } };
const ICHS = { en: { ich: 'Ichijo spec', icht: "Ichijo Komuten's rules and catalogue fittings" }, ja: { ich: '一条仕様', icht: '一条工務店の仕様とカタログの設備' } };
const DESC = {
  b: { en: "Budget plan<br>1F: entrance, gym 43.0 m², bath 14.9 m² (two hinoki tubs) with a 5.0 m² sauna, changing + rest room, laundry, WC, boiler room.<br>2F: living · dining · kitchen 44.0 m², master bedroom with an ensuite, den.<br>Loft: bedroom with an ensuite, den.",
    ja: "予算プラン<br>1階：玄関、ジム43.0m²、浴室14.9m²（ひのき浴槽2つ）とサウナ5.0m²、脱衣・休憩室、洗濯室、トイレ、機械室。<br>2階：LDK 44.0m²、主寝室（専用シャワー室付き）、書斎。<br>ロフト：寝室（専用シャワー室付き）、書斎。" },
  c: { en: "Mid tier plan<br>1F: entrance, ski / gear room, hall, gym 62.1 m², bath 21.1 m² (two hinoki tubs) with a 5.0 m² sauna, changing + rest room, laundry, WC, boiler room.<br>2F: living + dining, kitchen with an island, master bedroom and bedroom 2, each with an ensuite and a walk-in closet, two dens, WC.<br>Loft: bedroom / den 29.8 m² with its own bathroom and a closet.",
    ja: "中間プラン<br>1階：玄関、スキー/ギア室、ホール、ジム62.1m²、浴室21.1m²（ひのき浴槽2つ）とサウナ5.0m²、脱衣・休憩室、洗濯室、トイレ、機械室。<br>2階：リビング・ダイニング、アイランドのあるキッチン、主寝室と寝室2（それぞれ専用シャワー室・ウォークインクローゼット付き）、書斎2室、トイレ。<br>ロフト：寝室/書斎29.8m²（専用バスルーム・クローゼット付き）。" },
  d: { en: "Ideal plan<br>1F: entrance, ski / gear room, hall, gym 65.8 m², bath 24.8 m² (two hinoki tubs) with an 8.3 m² L-shaped sauna, changing + rest room, laundry, WC, boiler room.<br>2F: living with windows on three sides, dining + kitchen with an island, master bedroom with an ensuite and a closet, bedroom 2 with an ensuite, bedroom 3, two dens, WC.",
    ja: "理想プラン<br>1階：玄関、スキー/ギア室、ホール、ジム65.8m²、浴室24.8m²（ひのき浴槽2つ）とL字型のサウナ8.3m²、脱衣・休憩室、洗濯室、トイレ、機械室。<br>2階：3面に窓のあるリビング、アイランドのあるダイニング・キッチン、主寝室（専用シャワー室・クローゼット付き）、寝室2（専用シャワー室付き）、寝室3、書斎2室、トイレ。" },
  f: { en: "Compact<br>1F: entrance, hall, gym 52.0 m², bath 23.2 m² (two hinoki tubs) with a 4.0 m² sauna, changing room, laundry, WC, boiler room, bedroom 3 (14.2 m²) with its own bathroom.<br>2F: living with a sloped ceiling up to 4.75 m, dining, kitchen, bedrooms 1, 2 and 4 (11.2, 11.5 and 13.0 m²), each with its own bathroom; walk-in closets for bedrooms 2 and 4.",
    ja: "コンパクト<br>1階：玄関、ホール、ジム52.0m²、浴室23.2m²（ひのき浴槽2つ）とサウナ4.0m²、脱衣室、洗濯室、トイレ、機械室、寝室3（14.2m²、専用バスルーム付き）。<br>2階：勾配天井（最高4.75m）のリビング、ダイニング、キッチン、寝室1・2・4（11.2・11.5・13.0m²、それぞれ専用バスルーム付き、寝室2・4はウォークインクローゼット付き）。" },
  g: { en: "Full size<br>1F: entrance, hall, gym 52.1 m², bath 32.1 m² (two hinoki tubs) with a 5.5 m² sauna, changing + rest room, laundry, WC, boiler room, bedroom 3 (18.4 m²) with its own shower room across the hall.<br>2F: living with a sloped ceiling up to 4.75 m, dining, kitchen, bedrooms 1, 2 and 4 (18.2, 19.9 and 14.1 m²), each with a walk-in closet and its own bathroom.",
    ja: "フルサイズ<br>1階：玄関、ホール、ジム52.1m²、浴室32.1m²（ひのき浴槽2つ）とサウナ5.5m²、脱衣・休憩室、洗濯室、トイレ、機械室、寝室3（18.4m²、ホールの向かいに専用シャワールーム）。<br>2階：勾配天井（最高4.75m）のリビング、ダイニング、キッチン、寝室1・2・4（18.2・19.9・14.1m²、それぞれウォークインクローゼットと専用バスルーム付き）。" },
};
const TXB = {
  en: Object.assign({ title: "Plan editor · Budget plan", resetQ: "Throw away your changes and go back to the Budget plan as first drawn?",
    help: planHelp('en', "<b>Reset</b> goes back to the Budget plan as first drawn.", DESC.b.en, false) }, FIN.en),
  ja: Object.assign({ title: "間取り編集・予算プラン", resetQ: "変更をすべて破棄して、予算プランの最初の間取りに戻しますか？",
    help: planHelp('ja', "<b>元の図面に戻す</b>で予算プランの最初の間取りに戻ります。", DESC.b.ja, false) }, FIN.ja),
};
const TXC = {
  en: Object.assign({ title: "Plan editor · Mid tier plan", resetQ: "Throw away your changes and go back to the Mid tier plan as first drawn?",
    help: planHelp('en', "<b>Reset</b> goes back to the Mid tier plan as first drawn.", DESC.c.en, false) }, FIN.en),
  ja: Object.assign({ title: "間取り編集・中間プラン", resetQ: "変更をすべて破棄して、中間プランの最初の間取りに戻しますか？",
    help: planHelp('ja', "<b>元の図面に戻す</b>で中間プランの最初の間取りに戻ります。", DESC.c.ja, false) }, FIN.ja),
};
const TXD = {
  en: Object.assign({ title: "Plan editor · Ideal plan", resetQ: "Throw away your changes and go back to the Ideal plan as first drawn?",
    help: planHelp('en', "<b>Reset</b> goes back to the Ideal plan as first drawn.", DESC.d.en, true) }, FIN.en),
  ja: Object.assign({ title: "間取り編集・理想プラン", resetQ: "変更をすべて破棄して、理想プランの最初の間取りに戻しますか？",
    help: planHelp('ja', "<b>元の図面に戻す</b>で理想プランの最初の間取りに戻ります。", DESC.d.ja, true) }, FIN.ja),
};
const TXF = {
  en: Object.assign({ title: "Plan editor · Compact", resetQ: "Throw away your changes (walls and catalogue choices) and go back to “Compact” as first drawn?",
    help: planHelp('en', "<b>Reset</b> goes back to “Compact” as first drawn.", DESC.f.en, true) }, FIN.en, ICHS.en),
  ja: Object.assign({ title: "間取り編集・コンパクト", resetQ: "変更（壁・設備の選択）をすべて破棄して、「コンパクト」の最初の間取りに戻しますか？",
    help: planHelp('ja', "<b>元の図面に戻す</b>で「コンパクト」の最初の間取りに戻ります。", DESC.f.ja, true) }, FIN.ja, ICHS.ja),
};
const TXG = {
  en: Object.assign({ title: "Plan editor · Full size", resetQ: "Throw away your changes (walls and catalogue choices) and go back to “Full size” as first drawn?",
    help: planHelp('en', "<b>Reset</b> goes back to “Full size” as first drawn.", DESC.g.en, true) }, FIN.en, ICHS.en),
  ja: Object.assign({ title: "間取り編集・フルサイズ", resetQ: "変更（壁・設備の選択）をすべて破棄して、「フルサイズ」の最初の間取りに戻しますか？",
    help: planHelp('ja', "<b>元の図面に戻す</b>で「フルサイズ」の最初の間取りに戻ります。", DESC.g.ja, true) }, FIN.ja, ICHS.ja),
};
const TXP = { b: TXB, c: TXC, d: TXD, f: TXF, g: TXG };
let LANG = new URLSearchParams(location.search).get('lang') || localStorage.getItem('h3dEditLang') || 'en';
if (!TX[LANG]) LANG = 'en';
const T = (k) => TXP[PLAN][LANG][k] !== undefined ? TXP[PLAN][LANG][k] : TX[LANG][k] !== undefined ? TX[LANG][k] : TX.en[k];
const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ state */
const S = {
  model: null, orig: null, lvl: 0, tool: 'select', sel: null, hover: null,
  view: { s: 50, cx: 0, cy: 0 }, undo: [], redo: [], link: true, grid455: false,
  graph: [], dirty: true, drag: null, wallStart: null, mouse: null, armed: null, from: 'original',
};
const clone = (o) => JSON.parse(JSON.stringify(o));
let _uid = Date.now() % 100000;
const uid = (p) => p + 'n' + (_uid++).toString(36);

/* ------------------------------------------------------------- geometry */
const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
const add = (p, q) => [p[0] + q[0], p[1] + q[1]];
const mul = (p, s) => [p[0] * s, p[1] * s];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1];
const cross = (p, q) => p[0] * q[1] - p[1] * q[0];
const len = (p) => Math.hypot(p[0], p[1]);
const near = (p, q, t) => Math.abs(p[0] - q[0]) <= (t || 2e-3) && Math.abs(p[1] - q[1]) <= (t || 2e-3);
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const P4 = (p) => [r4(p[0]), r4(p[1])];
function frame(w) {
  const d = sub(w.b, w.a), L = len(d) || 1e-9, u = mul(d, 1 / L), n = [-u[1], u[0]];
  const off = w.off || 0, t = w.t || 0;
  return { L, u, n, q0: off - t / 2, q1: off + t / 2 };
}
function onSeg(p, w, tol) {                         /* p on the segment a-b (ends included) */
  const f = frame(w), r = sub(p, w.a), s = dot(r, f.u);
  return Math.abs(cross(f.u, r)) < (tol || 2e-3) && s > -(tol || 2e-3) && s < f.L + (tol || 2e-3);
}
function collinear(w, v) {
  const f = frame(w), g = frame(v);
  return Math.abs(cross(f.u, g.u)) < 1e-3 && Math.abs(cross(f.u, sub(v.a, w.a))) < 2e-3;
}
function segDist(p, a, b) {
  const d = sub(b, a), L2 = dot(d, d) || 1e-12;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), d) / L2));
  return { d: len(sub(p, add(a, mul(d, t)))), t };
}
const LV = () => S.model.levels[S.lvl];
const graph = (li) => {
  if (S.dirty) { S.graph = S.model.levels.map(levelGraph); S.dirty = false; }
  return S.graph[li === undefined ? S.lvl : li];
};
const touch = () => { S.dirty = true; };

/* which side of a wall is outside (1: +n, -1: -n, 0: neither) */
function outsideSide(w, li) {
  const G = graph(li), f = frame(w), m = add(w.a, mul(f.u, f.L / 2)), dd = Math.max(Math.abs(f.q0), Math.abs(f.q1)) + 0.04;
  const L0 = !faceAt(G, ...add(m, mul(f.n, dd))), R0 = !faceAt(G, ...add(m, mul(f.n, -dd)));
  return L0 && !R0 ? 1 : (R0 && !L0 ? -1 : 0);
}

/* ------------------------------------------------------------- view */
const cv = $('cv'), cx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight;
  cv.width = W * DPR; cv.height = H * DPR; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  redraw();
}
const toS = (p) => [(p[0] - S.view.cx) * S.view.s + W / 2, (p[1] - S.view.cy) * S.view.s + H / 2];
const toW = (x, y) => [(x - W / 2) / S.view.s + S.view.cx, (y - H / 2) / S.view.s + S.view.cy];
function fit() {
  const pts = S.model.levels.flatMap(L => L.walls.flatMap(w => [w.a, w.b]));
  const cp = S.model.carport;
  if (cp && cp.rect) pts.push([cp.rect[0], cp.rect[1]], [cp.rect[2], cp.rect[3]]);
  if (!pts.length) return;
  const x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1]));
  const mobile = W < 640;
  const padL = mobile ? 20 : 190, padR = mobile ? 20 : (PE && W >= 900 ? 370 : 300), padT = mobile ? 70 : 80, padB = mobile ? 130 : 50;
  S.view.s = Math.min((W - padL - padR) / (x1 - x0 + 1.2), (H - padT - padB) / (y1 - y0 + 1.2));
  S.view.cx = (x0 + x1) / 2 - ((padL - padR) / 2) / S.view.s;
  S.view.cy = (y0 + y1) / 2 - ((padT - padB) / 2) / S.view.s;
}
let _raf = 0;
function redraw() { if (!_raf) _raf = requestAnimationFrame(() => { _raf = 0; draw(); }); }

/* ------------------------------------------------------------- drawing */
const FILL = { oak: '#f3e6cf', tile: '#e3e7eb', stone: '#d6d2cb', concrete: '#e0dfdc', void: '#ffffff', granite: '#c9cccf', hinoki: '#f2e4c2', rubber: '#c2c5c9' };
function draw() {
  const c = cx, s = S.view.s;
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  c.fillStyle = '#f4f2ee'; c.fillRect(0, 0, W, H);
  /* grid: 455 / 910 */
  if (s * 0.455 > 7) {
    const a = toW(0, 0), b = toW(W, H);
    for (const [step, col] of [[0.455, '#ebe7e0'], [0.91, '#dfdad1']]) {
      c.strokeStyle = col; c.lineWidth = 1; c.beginPath();
      for (let x = Math.floor(a[0] / step) * step; x <= b[0]; x += step) { const X = toS([x, 0])[0]; c.moveTo(X, 0); c.lineTo(X, H); }
      for (let y = Math.floor(a[1] / step) * step; y <= b[1]; y += step) { const Y = toS([0, y])[1]; c.moveTo(0, Y); c.lineTo(W, Y); }
      c.stroke();
    }
  }
  const L = LV(), G = graph();
  /* the floor below, faint */
  if (S.lvl > 0) {
    c.save(); c.globalAlpha = 0.22;
    for (const w of S.model.levels[S.lvl - 1].walls) if (w.t > 0) wallBody(c, w, '#7d7468', null);
    c.restore();
  }
  /* rooms */
  for (const f of G.rooms) {
    const fin = f.room ? f.room.floor : 'oak';
    path(c, f.poly, f.holes);
    c.fillStyle = FILL[fin] || FILL.oak; c.fill('evenodd');
    if (fin === 'void') hatch(c, f);
    if (S.sel && S.sel.type === 'room' && f.room && f.room.id === S.sel.id) { c.fillStyle = 'rgba(90,200,250,.18)'; path(c, f.poly, f.holes); c.fill('evenodd'); }
  }
  /* the carport (plan d: outside the house, on the 1F): dashed roof outline, posts, name */
  if (S.lvl === 0 && S.model.carport && S.model.carport.rect) drawCarport(c, S.model.carport);
  /* stairs (the flights that start on this floor, and the ones arriving here shown dashed) */
  for (const st of S.model.stairs || []) {
    if (st.from === S.lvl) drawStair(c, st, false);
    else if (st.from === S.lvl - 1) drawStair(c, st, true);
  }
  /* furniture */
  if (PE) ichijoPrep();
  for (const it of L.items || []) drawItem(c, it);
  if (PE) ichijoOverlay(c);
  /* walls */
  const outer = new Map();
  for (const w of L.walls) outer.set(w.id, w.t > 0 ? outsideSide(w, S.lvl) : 0);
  S.tags = [];                                       /* v23: drawStackTags' circles (screen), kept clear by drawCompass */
  for (const w of L.walls) {
    const sel = S.sel && ((S.sel.type === 'wall' && S.sel.ids && S.sel.ids.includes(w.id)) || (S.sel.type === 'wall' && S.sel.id === w.id));
    if (!(w.t > 0)) { dividerLine(c, w, sel); continue; }
    const col = sel ? '#1d7fb8' : (outer.get(w.id) ? '#2f3338' : (w.h ? '#8b8f94' : '#565b61'));
    wallBody(c, w, col, w.ops || []);
    for (const o of w.ops || []) drawOpening(c, w, o, S.sel && S.sel.type === 'op' && S.sel.id === o.id);
    drawStackTags(c, w, outer.get(w.id));
  }
  /* room labels */
  c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const f of G.rooms) {
    const r = f.room;
    const p = r ? r.at : labelPoint(f.poly, f.holes), q = toS(p);
    const nm = r ? (LANG === 'ja' ? (r.ja || r.name) : r.name) : '';
    const area = f.netArea;
    if (area < 0.3) continue;
    const xs = f.poly.map(q => q[0]), ys = f.poly.map(q => q[1]);
    const px = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * S.view.s;
    if (px < 26) continue;
    /* a label on a flight (the stair's own room) gets a tread-coloured halo over the numbers + walking line */
    const halo = (S.model.stairs || []).some(st => st.from === S.lvl && st.treads.some(t => inPoly(t, p[0], p[1])));
    const txt = (s, x, y) => { if (halo) { c.save(); c.lineWidth = 4; c.lineJoin = 'round'; c.strokeStyle = '#efe5d4'; c.strokeText(s, x, y); c.restore(); } c.fillText(s, x, y); };
    c.font = '600 12px -apple-system,Segoe UI,Roboto,"Hiragino Sans",sans-serif';
    c.fillStyle = r && r.floor === 'void' ? '#8a8f96' : '#2b2f33';
    if (nm) txt(nm, q[0], q[1] - 7);
    if (px < 46) continue;
    c.font = '11px -apple-system,Segoe UI,Roboto,sans-serif'; c.fillStyle = '#6b6f75';
    txt(area.toFixed(2) + ' m²', q[0], q[1] + (nm ? 8 : 0));
  }
  /* v21: compass rose + the four sides of the drawing named */
  drawCompass(c);
  /* selection extras */
  drawSelection(c);
  /* wall being drawn */
  if (S.tool === 'wall' && S.wallStart && S.mouse) {
    const e = snapPoint(S.mouse, S.wallStart);
    c.strokeStyle = '#1d7fb8'; c.lineWidth = Math.max(3, 0.12 * s); c.lineCap = 'round';
    const a = toS(S.wallStart), b = toS(e.p); c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.stroke();
    dimLabel(c, S.wallStart, e.p, (len(sub(e.p, S.wallStart)) * 1000).toFixed(0));
  }
  if (S.tool === 'wall' && S.mouse) { const e = snapPoint(S.mouse, S.wallStart); const q = toS(e.p); c.fillStyle = e.kind === 'free' ? '#888' : '#1d7fb8'; c.beginPath(); c.arc(q[0], q[1], 5, 0, 7); c.fill(); }
  if (S.drag && S.drag.info) { c.font = '600 12px sans-serif'; c.fillStyle = '#1d7fb8'; c.textAlign = 'left'; c.fillText(S.drag.info, (S.drag.sx || 0) + 14, (S.drag.sy || 0) - 14); }
}
/* v21 (Toby's review): which way the drawing faces. NORTH[plan] = where north points on
   the screen (x right, y down: the editor draws model x / y as they are); a model's own
   compass.north wins (plan c). Plan b is drawn with north at the bottom. Purely an
   overlay: the view transform, hit tests and dragging are untouched. */
const NORTH = { b: [0, 1], c: [0, -1], d: [-1, 0], e: [0, -1], f: [0, -1], g: [0, -1] };
function compassDirs() {
  const mc = S.model && S.model.compass;
  const n0 = mc && Array.isArray(mc.north) ? mc.north : NORTH[PLAN];
  if (!n0) return null;
  const l = Math.hypot(n0[0], n0[1]) || 1, N = [n0[0] / l, n0[1] / l], E = [-N[1], N[0]];   /* east = north turned 90deg clockwise */
  const D = { n: N, e: E, s: [-N[0], -N[1]], w: [-E[0], -E[1]] };
  const side = (v) => Object.keys(D).reduce((b, k) => (D[k][0] * v[0] + D[k][1] * v[1] > D[b][0] * v[0] + D[b][1] * v[1] ? k : b), 'n');
  return { N, top: side([0, -1]), right: side([1, 0]), bottom: side([0, 1]), left: side([-1, 0]), northDown: N[1] > 0.7 };
}
function drawCompass(c) {
  const C = compassDirs(); if (!C) return;
  const lab = (d) => TX.en.cmp[d] + (LANG === 'ja' ? '  ' + TX.ja.cmp[d] : '');
  c.save();
  /* the sides: just outside the house as drawn (the bodies of the full walls of every floor, the
     stairs, the carport; not the garden screens / low walls that run out to the site boundary) */
  const pts = [];
  for (const L of S.model.levels) for (const w of L.walls) {
    if (!(w.t > 0) || w.h) continue;
    const f = frame(w);
    for (const sl of [0, f.L]) for (const q of [f.q0, f.q1]) pts.push(add(add(w.a, mul(f.u, sl)), mul(f.n, q)));
  }
  for (const st of S.model.stairs || []) for (const t of st.treads || []) pts.push(...t);
  const cp = S.model.carport; if (cp && cp.rect) pts.push([cp.rect[0], cp.rect[1]], [cp.rect[2], cp.rect[3]]);
  if (pts.length) {
    const A = toS([Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1]))]), B = toS([Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))]);
    const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2, g = 10;
    c.font = '700 11px -apple-system,Segoe UI,Roboto,"Hiragino Sans","Noto Sans JP",sans-serif';
    c.textAlign = 'center'; c.lineJoin = 'round';
    /* slide a label along its side off any low wall (garden screen) that crosses its line */
    const low = LV().walls.filter(w => w.h).map(w => [toS(w.a), toS(w.b)]);
    const cross = (ax, v) => low.flatMap(([a, b]) => { const i = ax === 'x' ? 0 : 1, j = 1 - i; if ((a[i] - v) * (b[i] - v) > 0 || Math.abs(b[i] - a[i]) < 1e-6) return []; return [a[j] + (v - a[i]) / (b[i] - a[i]) * (b[j] - a[j])]; });
    const slide = (at, half, hits) => { for (let k = 0; k < 40; k++) { const d = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 8, m = at + d; if (!hits.some(h => Math.abs(h - m) < half + 6)) return m; } return at; };
    const put = (t, x, y, rot, base) => {
      c.save(); c.translate(x, y); c.rotate(rot); c.textBaseline = base;
      c.lineWidth = 4; c.strokeStyle = 'rgba(244,242,238,.92)'; c.strokeText(t, 0, 0);
      c.fillStyle = '#46607a'; c.fillText(t, 0, 0); c.restore();
    };
    const tT = lab(C.top), tB = lab(C.bottom), tL = lab(C.left), tR = lab(C.right), hw = (t) => c.measureText(t).width / 2;
    /* v23: a label sits g px out from the house, its text (+ the 2 px halo) g - 2 ... g + 15 px out; where it
       would cover a stack-count tag (drawStackTags) on its side, it moves out to clear the tag by 2 px */
    const out = (sd, along, half) => (S.tags || []).reduce((gg, t) => {
      if (Math.abs((sd === 't' || sd === 'b' ? t.x : t.y) - along) > half + 2 + t.r) return gg;
      const d = sd === 't' ? A[1] - t.y : sd === 'b' ? t.y - B[1] : sd === 'l' ? A[0] - t.x : t.x - B[0];   /* tag centre, px out */
      return Math.max(gg, d + t.r + 4);
    }, g);
    const xT = slide(mx, hw(tT), cross('y', A[1] - g - 6)), xB = slide(mx, hw(tB), cross('y', B[1] + g + 6));
    const yL = slide(my, hw(tL), cross('x', A[0] - g - 6)), yR = slide(my, hw(tR), cross('x', B[0] + g + 6));
    put(tT, xT, A[1] - out('t', xT, hw(tT)), 0, 'bottom');
    put(tB, xB, B[1] + out('b', xB, hw(tB)), 0, 'top');
    put(tL, A[0] - out('l', yL, hw(tL)), yL, -Math.PI / 2, 'bottom');
    put(tR, B[0] + out('r', yR, hw(tR)), yR, Math.PI / 2, 'bottom');
  }
  /* the rose: bottom-left corner (top-right under the bar on a phone, where the tools sit at the bottom) */
  const r = 22, mob = W < 640;
  const tb = mob ? $('top').getBoundingClientRect().bottom : 0;
  const note = [];                                    /* v24: no notes on the drawing (facts only) */
  const ox = mob ? W - 38 - r : 38 + r, oy = mob ? tb + 38 + r : H - 44 - r;   /* room for the N letter on any side */
  S.compass = { top: C.top, right: C.right, bottom: C.bottom, left: C.left, rose: [ox, oy], north: C.N, note: note.length > 0 };   /* for tests */
  const [nx, ny] = C.N, ex = -ny, ey = nx;
  c.beginPath(); c.arc(ox, oy, r + 6, 0, 2 * Math.PI); c.fillStyle = 'rgba(255,255,255,.88)'; c.fill();
  c.lineWidth = 1; c.strokeStyle = '#9aa3ad'; c.stroke();
  const pt = (k, q) => [ox + (nx * k + ex * q) * r, oy + (ny * k + ey * q) * r];   /* k along north, q along east (radii) */
  const tri = (P, col) => { c.beginPath(); P.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); c.closePath(); c.fillStyle = col; c.fill(); };
  const kite = (k, q, len, col) => tri([pt(k * len, q * len), pt(-q * 0.2, k * 0.2), pt(q * 0.2, -k * 0.2)], col);   /* a point toward (k, q) */
  kite(0, 1, 0.75, '#c3cad1'); kite(0, -1, 0.75, '#c3cad1'); kite(-1, 0, 0.75, '#c3cad1');
  kite(1, 0, 1, '#c0392b');
  c.font = '800 12px -apple-system,Segoe UI,Roboto,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  const lp = pt((r + 15) / r, 0); c.lineWidth = 3; c.strokeStyle = 'rgba(255,255,255,.95)'; c.strokeText('N', lp[0], lp[1]); c.fillStyle = '#c0392b'; c.fillText('N', lp[0], lp[1]);
  if (note.length) {                                  /* beside the rose, on the side away from the screen edge */
    c.font = 'italic 600 11px -apple-system,Segoe UI,Roboto,"Hiragino Sans",sans-serif'; c.textAlign = mob ? 'right' : 'left'; c.textBaseline = 'middle';
    const x = mob ? ox - r - 24 : ox + r + 24;
    note.forEach((t, i) => { const y = oy + (i - (note.length - 1) / 2) * 15; c.lineWidth = 3; c.strokeStyle = 'rgba(244,242,238,.95)'; c.strokeText(t, x, y); c.fillStyle = '#46607a'; c.fillText(t, x, y); });
  }
  c.restore();
}
/* v21: frosted (obscured) glass: a dotted fill */
let _dots = null;
function dotFill(c) {
  if (_dots) return _dots;
  const d = document.createElement('canvas'); d.width = d.height = 4;
  const x = d.getContext('2d'); x.fillStyle = 'rgba(236,241,244,.95)'; x.fillRect(0, 0, 4, 4);
  x.fillStyle = '#51616d'; x.fillRect(1, 1, 1.4, 1.4);
  return (_dots = c.createPattern(d, 'repeat'));
}
function drawCarport(c, cp) {
  const [x0, y0, x1, y1] = cp.rect, A = toS([x0, y0]), Bq = toS([x1, y1]);
  c.save();
  c.fillStyle = 'rgba(160,160,160,.12)'; c.fillRect(A[0], A[1], Bq[0] - A[0], Bq[1] - A[1]);
  c.setLineDash([7, 5]); c.strokeStyle = '#8a8f96'; c.lineWidth = 1.3; c.strokeRect(A[0], A[1], Bq[0] - A[0], Bq[1] - A[1]);
  c.setLineDash([]); c.fillStyle = '#6b6f75';
  const ps = Math.max(3, 0.12 * S.view.s);
  for (const p of cp.posts || []) { const q = toS(p); c.fillRect(q[0] - ps / 2, q[1] - ps / 2, ps, ps); }
  c.font = '600 12px -apple-system,Segoe UI,Roboto,"Hiragino Sans",sans-serif'; c.fillStyle = '#5d6268'; c.textAlign = 'center'; c.textBaseline = 'middle';
  const nm = LANG === 'ja' ? (cp.ja || cp.name || 'カーポート') : (cp.name || 'Carport');
  c.fillText(nm, (A[0] + Bq[0]) / 2, (A[1] + Bq[1]) / 2 - 7);
  c.font = '11px -apple-system,Segoe UI,Roboto,sans-serif'; c.fillStyle = '#7a7f86';
  c.fillText(((x1 - x0) * 1000).toFixed(0) + ' × ' + ((y1 - y0) * 1000).toFixed(0), (A[0] + Bq[0]) / 2, (A[1] + Bq[1]) / 2 + 8);
  c.restore();
}
function path(c, poly, holes) {
  c.beginPath();
  for (const P of [poly, ...(holes || [])]) { P.forEach((p, i) => { const q = toS(p); i ? c.lineTo(...q) : c.moveTo(...q); }); c.closePath(); }
}
function hatch(c, f) {
  c.save(); path(c, f.poly, f.holes); c.clip('evenodd');
  c.strokeStyle = '#d9dde2'; c.lineWidth = 1; c.beginPath();
  for (let k = -H; k < W + H; k += 14) { c.moveTo(k, 0); c.lineTo(k + H, H); }
  c.stroke(); c.restore();
}
/* wall body: q0..q1 across, run on by half a thickness where it meets another wall; gaps at openings */
function wallBody(c, w, col, ops) {
  const f = frame(w), L = LV();
  const joined = (p) => L.walls.some(v => v !== w && v.t > 0 && (near(v.a, p) || near(v.b, p) || onSeg(p, v)));
  const e0 = joined(w.a) ? w.t / 2 : 0, e1 = joined(w.b) ? w.t / 2 : 0;
  const cuts = (ops || []).map(o => [Math.max(0, o.at), Math.min(f.L, o.at + o.w)]).sort((x, y) => x[0] - y[0]);
  const spans = []; let cur = -e0;
  for (const [s0, s1] of cuts) { if (s0 > cur) spans.push([cur, s0]); cur = Math.max(cur, s1); }
  if (cur < f.L + e1) spans.push([cur, f.L + e1]);
  c.fillStyle = col;
  for (const [s0, s1] of spans) {
    const P = [[s0, f.q0], [s1, f.q0], [s1, f.q1], [s0, f.q1]].map(([s, q]) => toS(add(add(w.a, mul(f.u, s)), mul(f.n, q))));
    c.beginPath(); P.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); c.closePath(); c.fill();
    if (w.h) { c.strokeStyle = '#f4f2ee'; c.lineWidth = 1; c.stroke(); }
  }
}
function dividerLine(c, w, sel) {
  const a = toS(w.a), b = toS(w.b);
  c.save(); c.setLineDash([6, 5]); c.strokeStyle = sel ? '#1d7fb8' : '#9a9590'; c.lineWidth = sel ? 2.5 : 1.3;
  c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.stroke(); c.restore();
}
function drawOpening(c, w, o, sel) {
  const f = frame(w), at = (s, q) => toS(add(add(w.a, mul(f.u, s)), mul(f.n, q)));
  const s0 = o.at, s1 = o.at + o.w, qm = (f.q0 + f.q1) / 2;
  c.lineWidth = sel ? 2.5 : 1.2; c.strokeStyle = sel ? '#1d7fb8' : '#3b3f44';
  const line = (A, B) => { c.beginPath(); c.moveTo(...A); c.lineTo(...B); c.stroke(); };
  /* jambs */
  line(at(s0, f.q0), at(s0, f.q1)); line(at(s1, f.q0), at(s1, f.q1));
  const side = o.side || 1, hingeB = o.hinge === 'b';
  if (o.type === 'window' || o.type === 'slide') {
    c.fillStyle = sel ? 'rgba(90,200,250,.35)' : 'rgba(150,200,230,.45)';
    const P = [at(s0, f.q0 + 0.02), at(s1, f.q0 + 0.02), at(s1, f.q1 - 0.02), at(s0, f.q1 - 0.02)];
    c.beginPath(); P.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); c.closePath(); c.fill();
    if (o.frost || o.frosted) { c.fillStyle = dotFill(c); c.fill(); }   /* frosted glass: dotted */
    line(at(s0, qm - 0.015), at(s1, qm - 0.015)); line(at(s0, qm + 0.015), at(s1, qm + 0.015));
    if (o.type === 'slide') { const m = (s0 + s1) / 2; line(at(s0, qm - 0.04), at(m + 0.05, qm - 0.04)); line(at(m - 0.05, qm + 0.04), at(s1, qm + 0.04)); }
  } else if (o.type === 'door' || o.type === 'entry' || o.type === 'double' || o.type === 'parent-child') {
    /* [hinge position, direction of the leaf when shut, leaf width]; parent-child: the parent at the hinge end */
    const W = s1 - s0, ch = childLeaf(o, W);
    const leaves = o.type === 'double' ? [[s0, 1, W / 2], [s1, -1, W / 2]]
      : o.type === 'parent-child' ? (hingeB ? [[s1, -1, W - ch], [s0, 1, ch]] : [[s0, 1, W - ch], [s1, -1, ch]])
      : [[hingeB ? s1 : s0, hingeB ? -1 : 1, W]];
    const qf = side > 0 ? f.q1 : f.q0;
    for (const [hs, dir, lw] of leaves) {
      const hinge = at(hs, qf), tip = at(hs, qf + side * lw), shut = at(hs + dir * lw, qf);
      c.lineWidth = sel ? 2.5 : (o.type === 'entry' || o.type === 'double' || o.type === 'parent-child' ? 2.2 : 1.2); line(hinge, tip);
      c.lineWidth = 0.8; c.beginPath();
      const r = lw * S.view.s, a0 = Math.atan2(tip[1] - hinge[1], tip[0] - hinge[0]), a1 = Math.atan2(shut[1] - hinge[1], shut[0] - hinge[0]);
      let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      c.arc(hinge[0], hinge[1], r, a0, a0 + da, da < 0); c.stroke();
    }
  } else if (o.type === 'sliding') {
    const n = o.leaves || 2, lw = (s1 - s0) / n;
    c.lineWidth = sel ? 2.5 : 1.6;
    for (let i = 0; i < n; i++) { const q = qm + (i % 2 ? 0.025 : -0.025); line(at(s0 + lw * i - (i ? 0.03 : 0), q), at(s0 + lw * (i + 1) + (i < n - 1 ? 0.03 : 0), q)); }
  } else {                                           /* hole */
    c.save(); c.setLineDash([3, 3]); line(at(s0, qm), at(s1, qm)); c.restore();
  }
}
/* v23 stacked windows: a bay = the ops on a wall with the same at + w (each may carry a stack) */
const sameBay = (p, q) => Math.abs(p.at - q.at) < 1e-3 && Math.abs(p.w - q.w) < 1e-3;
const bayOf = (w, o) => (w.ops || []).filter(q => q === o || sameBay(q, o));
const bayWindows = (bay) => bay.reduce((n, q) => n + (q.type === 'window' ? 1 + (Array.isArray(q.stack) ? q.stack.length : 0) : 0), 0);
const bayUnits = (bay) => bay.reduce((n, q) => n + 1 + (q.type === 'window' && Array.isArray(q.stack) ? q.stack.length : 0), 0);
/* the number of window units on the outside face of a stacked bay: small, subtle (plans PNGs too) */
function drawStackTags(c, w, side) {
  const f = frame(w), seen = new Set();
  for (const o of w.ops || []) {
    if (seen.has(o)) continue;
    const bay = bayOf(w, o); bay.forEach(q => seen.add(q));
    const n = bayWindows(bay);
    if (n < 2) continue;
    const sg = side || 1, q = (sg > 0 ? f.q1 : f.q0) + sg * 9 / S.view.s;
    const p = toS(add(add(w.a, mul(f.u, o.at + o.w / 2)), mul(f.n, q)));
    if (S.tags) S.tags.push({ x: p[0], y: p[1], r: 7 });   /* radius 6.5 + its outline */
    c.save();
    c.beginPath(); c.arc(p[0], p[1], 6.5, 0, 2 * Math.PI); c.fillStyle = 'rgba(255,255,255,.95)'; c.fill();
    c.lineWidth = 1; c.strokeStyle = '#5b86a8'; c.stroke();
    c.font = '700 9px -apple-system,Segoe UI,Roboto,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#2f5d80'; c.fillText(String(n), p[0], p[1] + 0.5);
    c.restore();
  }
}
function itemPoly(it, grow) {
  const ca = Math.cos(it.a || 0), sa = Math.sin(it.a || 0), hw = it.w / 2 + (grow || 0), hd = it.d / 2 + (grow || 0);
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => [it.x + x * ca - y * sa, it.y + x * sa + y * ca]);
}
const loc = (it, x, y) => { const ca = Math.cos(it.a || 0), sa = Math.sin(it.a || 0); return toS([it.x + x * ca - y * sa, it.y + x * sa + y * ca]); };
function drawItem(c, it) {
  if (PE && it.fx && ICH.replaced.has(it.id)) { c.save(); c.globalAlpha = 0.22; drawItem1(c, it); c.restore(); return; }
  drawItem1(c, it);
}
function drawItem1(c, it) {
  const sel = S.sel && S.sel.type === 'item' && S.sel.id === it.id;
  const P = itemPoly(it).map(toS);
  c.beginPath(); P.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); c.closePath();
  const fills = { island: '#4a4c50', tall: '#4a4c50', closet: '#d8c3a5', wardrobe: '#d8c3a5', stove: '#3d3d3d', rugRound: 'rgba(0,0,0,0)', post: '#c9a77c', beam: 'rgba(201,167,124,.55)',
    tube: '#e6cf9f', saunaBench: '#ead7ae', saunaHeater: '#3d3d3d', gymRack: 'rgba(60,62,66,.25)', gymBench: '#5a5d61', treadmill: '#5a5d61', mat: '#8e9196', railing: 'rgba(120,180,215,.7)' };
  c.fillStyle = fills[it.kind] || '#ffffff'; if (it.kind !== 'rugRound') c.fill();
  c.strokeStyle = sel ? '#1d7fb8' : '#8b7c6c'; c.lineWidth = sel ? 2.5 : 1; c.stroke();
  const hw = it.w / 2, hd = it.d / 2;
  const L = (x0, y0, x1, y1) => { c.beginPath(); c.moveTo(...loc(it, x0, y0)); c.lineTo(...loc(it, x1, y1)); c.stroke(); };
  c.lineWidth = 1; c.strokeStyle = sel ? '#1d7fb8' : '#a99a88';
  switch (it.kind) {
    case 'bed': L(-hw, -hd + 0.35, hw, -hd + 0.35); L(-hw * 0.85, -hd + 0.12, -0.08, -hd + 0.12); L(0.08, -hd + 0.12, hw * 0.85, -hd + 0.12); L(-hw, hd * 0.2, hw, hd * 0.2); break;
    case 'sofa': L(-hw, -hd + 0.2, hw, -hd + 0.2); if (it.chaise) { const [x, w2, d2] = it.chaise; const Q = [[x - w2 / 2, hd], [x + w2 / 2, hd], [x + w2 / 2, hd + d2], [x - w2 / 2, hd + d2]].map(([a, b]) => loc(it, a, b)); c.beginPath(); Q.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); c.closePath(); c.fillStyle = '#fff'; c.fill(); c.stroke(); } break;
    case 'toilet': { const q = loc(it, 0, -0.04); c.beginPath(); c.ellipse(q[0], q[1], hw * 0.8 * S.view.s, hd * 0.55 * S.view.s, it.a || 0, 0, 7); c.stroke(); L(-hw, hd - 0.16, hw, hd - 0.16); break; }
    case 'rugRound': { const q = toS([it.x, it.y]); c.beginPath(); c.arc(q[0], q[1], hw * S.view.s, 0, 7); c.strokeStyle = sel ? '#1d7fb8' : '#b5a48f'; c.stroke(); break; }
    case 'stove': c.strokeStyle = '#fff'; L(-hw * 0.6, hd - 0.05, hw * 0.6, hd - 0.05); break;
    case 'island': c.strokeStyle = '#ddd'; { const q = loc(it, -hw + 0.6, 0.05), r = loc(it, hw - 0.62, 0); c.strokeRect(q[0] - 12, q[1] - 8, 24, 16); c.beginPath(); c.arc(r[0], r[1], 9, 0, 7); c.stroke(); } break;
    case 'closet': case 'wardrobe': case 'tall': L(-hw, hd - 0.03, hw, hd - 0.03); break;
    case 'ub': { const q = loc(it, 0, -hd + 0.43); c.beginPath(); c.ellipse(q[0], q[1], (Math.min(hw - 0.06, 0.8) - 0.05) * S.view.s, 0.32 * S.view.s, it.a || 0, 0, 7); c.stroke(); break; }
    case 'chair': L(-hw, -hd + 0.06, hw, -hd + 0.06); break;
    default: break;
  }
  /* front tick (the side that faces the room) for things that have one */
  if (S.view.s > 85 && S.view.s * Math.min(it.w, it.d) > 28) {
    const nm = (TX[LANG].kinds[it.kind] || it.kind);
    if (['closet', 'wardrobe', 'island', 'tall', 'stove', 'post', 'beam', 'rugRound'].includes(it.kind) || S.view.s * it.w < 50) return;
    c.save(); const q = toS([it.x, it.y]); c.translate(q[0], q[1]);
    let a = it.a || 0; while (a > Math.PI / 2) a -= Math.PI; while (a < -Math.PI / 2) a += Math.PI; c.rotate(a);
    c.font = '10px sans-serif'; c.fillStyle = '#9a8b79'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(nm, 0, 0); c.restore();
  }
}
function drawStair(c, st, ghost) {
  const sel = S.sel && S.sel.type === 'stair' && S.sel.id === st.id;
  c.save(); if (ghost) { c.globalAlpha = 0.35; c.setLineDash([4, 3]); }
  /* tread numbers only when they fit between the treads' centres (else they run together) */
  c.font = '10px sans-serif';
  const CN = st.treads.map(t => toS(t.reduce((a, p) => [a[0] + p[0] / t.length, a[1] + p[1] / t.length], [0, 0])));
  const nums = !ghost && S.view.s > 35 && CN.every((p, i) => !i || Math.hypot(p[0] - CN[i - 1][0], p[1] - CN[i - 1][1]) > c.measureText(String(i + 1)).width + 2);
  st.treads.forEach((t, k) => {
    const P = t.map(toS);
    c.beginPath(); P.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); c.closePath();
    c.fillStyle = sel ? '#d8eef9' : '#efe5d4'; c.fill(); c.strokeStyle = sel ? '#1d7fb8' : '#9c8c78'; c.lineWidth = 1; c.stroke();
    if (nums) {
      const m = t.reduce((a, p) => [a[0] + p[0] / t.length, a[1] + p[1] / t.length], [0, 0]), q = toS(m);
      c.fillStyle = '#7b6d5c'; c.font = '10px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(k + 1), q[0], q[1]);
    }
  });
  if (!ghost) {                                      /* walking line + arrow */
    const C = st.treads.map(t => toS(t.reduce((a, p) => [a[0] + p[0] / t.length, a[1] + p[1] / t.length], [0, 0])));
    c.strokeStyle = '#6d5f4e'; c.lineWidth = 1; c.beginPath(); C.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); c.stroke();
    const a = C[C.length - 2] || C[0], b = C[C.length - 1], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    c.beginPath(); c.moveTo(b[0], b[1]); c.lineTo(b[0] - 8 * Math.cos(ang - 0.4), b[1] - 8 * Math.sin(ang - 0.4)); c.moveTo(b[0], b[1]); c.lineTo(b[0] - 8 * Math.cos(ang + 0.4), b[1] - 8 * Math.sin(ang + 0.4)); c.stroke();
    c.fillStyle = '#6d5f4e'; c.font = '600 10px sans-serif'; c.fillText('UP', C[0][0], C[0][1] + 12);
  }
  c.restore();
}
function dimLabel(c, a, b, txt, off) {
  const A = toS(a), B = toS(b), m = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const ang = Math.atan2(B[1] - A[1], B[0] - A[0]);
  c.save(); c.translate(m[0], m[1]); let r = ang; if (r > Math.PI / 2) r -= Math.PI; if (r < -Math.PI / 2) r += Math.PI; c.rotate(r);
  c.font = '600 11px sans-serif'; const w = c.measureText(txt).width + 8;
  c.fillStyle = 'rgba(29,127,184,.92)'; c.fillRect(-w / 2, (off || -16) - 8, w, 16);
  c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, 0, (off || -16)); c.restore();
}
const mmTxt = (m) => Math.round(m * 1000).toLocaleString('en-US');
function drawSelection(c) {
  const sel = S.sel; if (!sel) return;
  const L = LV();
  if (sel.type === 'wall') {
    const w = L.walls.find(v => v.id === sel.id); if (!w) return;
    const f = frame(w);
    dimLabel(c, w.a, w.b, mmTxt(f.L), -(f.q1 - f.q0) * S.view.s / 2 - 12);
    /* clear distances to the nearest parallel walls on both sides (centre to centre) */
    for (const sg of [1, -1]) {
      let best = null;
      for (const v of L.walls) {
        if (v === w || !(v.t > 0)) continue;
        const g = frame(v); if (Math.abs(cross(f.u, g.u)) > 1e-3) continue;
        const dd = dot(sub(v.a, w.a), f.n) * sg; if (dd < 0.05) continue;
        const sA = dot(sub(v.a, w.a), f.u), sB = dot(sub(v.b, w.a), f.u);
        const lo = Math.max(0, Math.min(sA, sB)), hi = Math.min(f.L, Math.max(sA, sB)); if (hi - lo < 0.05) continue;
        if (!best || dd < best.dd) best = { dd, s: (lo + hi) / 2 };
      }
      if (best) {
        const p0 = add(w.a, mul(f.u, best.s)), p1 = add(p0, mul(f.n, best.dd * sg));
        c.save(); c.strokeStyle = 'rgba(29,127,184,.7)'; c.setLineDash([4, 3]); c.lineWidth = 1; c.beginPath(); c.moveTo(...toS(p0)); c.lineTo(...toS(p1)); c.stroke(); c.restore();
        dimLabel(c, p0, p1, mmTxt(best.dd), 0);
      }
    }
    for (const p of [w.a, w.b]) { const q = toS(p); c.fillStyle = '#fff'; c.strokeStyle = '#1d7fb8'; c.lineWidth = 2; c.beginPath(); c.arc(q[0], q[1], 7, 0, 7); c.fill(); c.stroke(); }
  } else if (sel.type === 'op') {
    const w = L.walls.find(v => v.id === sel.wall), o = w && (w.ops || []).find(q => q.id === sel.id); if (!o) return;
    const f = frame(w);
    dimLabel(c, add(w.a, mul(f.u, o.at)), add(w.a, mul(f.u, o.at + o.w)), mmTxt(o.w), -(f.q1 - f.q0) * S.view.s / 2 - 12);
    dimLabel(c, w.a, add(w.a, mul(f.u, o.at)), mmTxt(o.at), (f.q1 - f.q0) * S.view.s / 2 + 12);
  } else if (sel.type === 'item') {
    const it = (L.items || []).find(v => v.id === sel.id); if (!it) return;
    const P = itemPoly(it, 0.0); dimLabel(c, P[0], P[1], mmTxt(it.w), -12); dimLabel(c, P[1], P[2], mmTxt(it.d), -12);
  }
}

/* --------------------------------------------------------------- picking */
function pick(p) {
  const L = LV(), s = S.view.s, tolW = 8 / s;
  /* selected wall's end handles first */
  if (S.sel && S.sel.type === 'wall') {
    const w = L.walls.find(v => v.id === S.sel.id);
    if (w) for (const [k, q] of [['a', w.a], ['b', w.b]]) if (len(sub(p, q)) < 11 / s) return { type: 'end', id: w.id, end: k };
  }
  /* openings */
  for (const w of L.walls) {
    if (!(w.t > 0)) continue;
    const f = frame(w), r = sub(p, w.a), sa = dot(r, f.u), q = dot(r, f.n);
    if (q < f.q0 - tolW || q > f.q1 + tolW) continue;
    for (const o of w.ops || []) if (sa > o.at - 2 / s && sa < o.at + o.w + 2 / s) return { type: 'op', wall: w.id, id: o.id };
  }
  /* walls (body or within a few pixels of the line) */
  let best = null;
  for (const w of L.walls) {
    const f = frame(w), r = sub(p, w.a), sa = dot(r, f.u), q = dot(r, f.n);
    if (sa < -tolW || sa > f.L + tolW) continue;
    const tq = (w.t > 0 ? Math.max(Math.abs(f.q0), Math.abs(f.q1)) : 0) + tolW;
    const dq = Math.abs(q - (f.q0 + f.q1) / 2);
    if (dq < tq && (!best || dq < best.dq)) best = { dq, w };
  }
  if (best) return { type: 'wall', id: best.w.id };
  /* items (smallest first) */
  const hits = (L.items || []).filter(it => inPoly(itemPoly(it, 2 / s), p[0], p[1])).sort((a, b) => a.w * a.d - b.w * b.d);
  if (hits.length) return { type: 'item', id: hits[0].id };
  for (const st of S.model.stairs || []) if (st.from === S.lvl && st.treads.some(t => inPoly(t, p[0], p[1]))) return { type: 'stair', id: st.id };
  const f = faceAt(graph(), p[0], p[1]);
  if (f) return { type: 'room', id: f.room ? f.room.id : null, face: f };
  return null;
}

/* ------------------------------------------------------------- snapping */
function snapLen(v) { const g = S.grid455 ? 0.455 : 0.01; return Math.round(v / g) * g; }
/* a point for drawing walls: existing end points, then walls, then right angles from the start, then 1 cm */
function snapPoint(p, from) {
  const L = LV(), s = S.view.s, tol = 12 / s;
  let bestE = null;
  for (const w of L.walls) for (const q of [w.a, w.b]) { const d = len(sub(p, q)); if (d < tol && (!bestE || d < bestE.d)) bestE = { d, q }; }
  if (bestE) return { p: bestE.q.slice(), kind: 'end' };
  let q = p.slice();
  if (from) {
    const d = sub(q, from), a = Math.atan2(d[1], d[0]), sn = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
    if (Math.abs(a - sn) < 0.12) { const l = len(d); q = add(from, [Math.cos(sn) * l, Math.sin(sn) * l]); }
    const l = len(sub(q, from)), u = mul(sub(q, from), 1 / (l || 1)); q = add(from, mul(u, snapLen(l)));
  } else q = [snapLen(q[0]), snapLen(q[1])];
  /* onto a wall line near the point (keeps the direction when drawing) */
  for (const w of L.walls) {
    const f = frame(w), r = sub(q, w.a), sa = dot(r, f.u), dq = dot(r, f.n);
    if (sa < 0 || sa > f.L || Math.abs(dq) > tol) continue;
    if (from) {
      const dir = sub(q, from), den = cross(dir, f.u);
      if (Math.abs(den) > 1e-9) { const t = cross(sub(w.a, from), f.u) / den; if (t > 0.05) return { p: add(from, mul(dir, t)), kind: 'wall' }; }
    }
    return { p: add(w.a, mul(f.u, sa)), kind: 'wall' };
  }
  return { p: q, kind: from ? 'free' : 'grid' };
}

/* -------------------------------------------------------- model editing */
/* the straight run of walls through w (collinear, joined end to end) */
function chainOf(L, w0) {
  const ids = new Set([w0.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const w of L.walls) {
      if (ids.has(w.id) || !collinear(w, w0)) continue;
      const ch = L.walls.filter(v => ids.has(v.id));
      if (ch.some(v => near(v.a, w.a) || near(v.a, w.b) || near(v.b, w.a) || near(v.b, w.b) || onSeg(w.a, v) || onSeg(w.b, v) || onSeg(v.a, w) || onSeg(v.b, w))) { ids.add(w.id); grew = true; }
    }
  }
  return L.walls.filter(v => ids.has(v.id));
}
/* move a run of walls sideways by d (a vector); walls joined to it stretch */
function moveChain(L, chain, d) {
  const ids = new Set(chain.map(w => w.id));
  const attached = [];
  for (const w of L.walls) {
    if (ids.has(w.id)) continue;
    for (const k of ['a', 'b']) if (chain.some(v => onSeg(w[k], v))) attached.push([w, k]);
  }
  /* furniture standing against these walls goes with them */
  const hug = (L.items || []).filter(it => it.kind !== 'rugRound' && chain.some(w => {
    if (!(w.t > 0)) return false;
    const f = frame(w), P = itemPoly(it).map(p => [dot(sub(p, w.a), f.u), dot(sub(p, w.a), f.n)]);
    const s0 = Math.min(...P.map(q => q[0])), s1 = Math.max(...P.map(q => q[0])), q0 = Math.min(...P.map(q => q[1])), q1 = Math.max(...P.map(q => q[1]));
    if (s1 < 0.02 || s0 > f.L - 0.02) return false;
    return Math.abs(q0 - f.q1) < 0.08 || Math.abs(q1 - f.q0) < 0.08;
  }));
  for (const it of hug) { it.x = r4(it.x + d[0]); it.y = r4(it.y + d[1]); }
  for (const w of chain) { w.a = P4(add(w.a, d)); w.b = P4(add(w.b, d)); }
  for (const [w, k] of attached) {
    const f0 = frame(w);
    w[k] = P4(add(w[k], d));
    if (k === 'a') for (const o of w.ops || []) o.at = r4(Math.max(0, o.at - dot(d, f0.u)));
    clampOps(w);
  }
}
function extendEnd(L, id, end, k) {
  const w = L.walls.find(v => v.id === id), f = frame(w), q0 = w[end].slice(), shift = mul(f.u, end === 'b' ? k : -k);
  /* k > 0 = longer. The other collinear walls ending at that point move with it */
  for (const v of L.walls) {
    if (v === w || !collinear(v, w)) continue;
    if (near(v.a, q0)) { const g = frame(v); v.a = P4(add(v.a, shift)); for (const o of v.ops || []) o.at = r4(o.at - dot(shift, g.u)); clampOps(v); }
    else if (near(v.b, q0)) { v.b = P4(add(v.b, shift)); clampOps(v); }
  }
  if (end === 'a') { w.a = P4(add(w.a, shift)); for (const o of w.ops || []) o.at = r4(o.at + k); }
  else w.b = P4(add(w.b, shift));
  clampOps(w);
}
function clampOps(w) {
  const L = frame(w).L;
  for (const o of w.ops || []) { o.w = Math.min(o.w, Math.max(0.2, L - 0.02)); o.at = r4(Math.max(0, Math.min(o.at, L - o.w))); }
}
/* rooms keep their names: remember each label's face by the walls round it, find it again after the move */
function faceKeys(li) {
  const G = graph(li), out = [];
  for (const r of S.model.levels[li].rooms || []) {
    const f = faceAt(G, r.at[0], r.at[1]);
    if (!f) continue;
    const walls = new Set(f.he.map(j => G.E[G.H[j].e].wall));
    out.push({ r, walls, area: f.netArea });
  }
  return out;
}
function reanchor(li, keys) {
  const G = graph(li);
  for (const k of keys) {
    const cur = faceAt(G, k.r.at[0], k.r.at[1]);
    const curWalls = cur ? new Set(cur.he.map(j => G.E[G.H[j].e].wall)) : new Set();
    const score = (ws) => { let n = 0; for (const x of ws) if (k.walls.has(x)) n++; return n / Math.max(ws.size, k.walls.size, 1); };
    if (cur && score(curWalls) > 0.6) continue;
    let best = null;
    for (const f of G.rooms) {
      const ws = new Set(f.he.map(j => G.E[G.H[j].e].wall)), sc = score(ws);
      if (!best || sc > best.sc) best = { sc, f };
    }
    if (best && best.sc > 0.5) k.r.at = P4(labelPoint(best.f.poly, best.f.holes));
  }
}

/* ------------------------------------------------------------- undo/save */
let _saveT = 0;
function commit(label) {
  S.undo.push(S.before); if (S.undo.length > 120) S.undo.shift();
  S.redo.length = 0; S.before = null;
  touch(); save(); syncUI();
  if (PE) ichijoChanged();
}
function begin() { S.before = JSON.stringify(S.model); }
function save() {
  clearTimeout(_saveT);
  _saveT = setTimeout(() => { try { localStorage.setItem(REF.key, JSON.stringify(S.model)); } catch (e) { console.warn(e); } }, 150);
}
function undo() { if (!S.undo.length) return; S.redo.push(JSON.stringify(S.model)); S.model = JSON.parse(S.undo.pop()); S.sel = null; touch(); save(); syncUI(); redraw(); if (PE) ichijoChanged(); }
function redo() { if (!S.redo.length) return; S.undo.push(JSON.stringify(S.model)); S.model = JSON.parse(S.redo.pop()); S.sel = null; touch(); save(); syncUI(); redraw(); if (PE) ichijoChanged(); }

/* ------------------------------------------------------------- pointers */
const ptrs = new Map();
let pinch = null;
cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (ptrs.size === 2) {                             /* two fingers: pinch-zoom + pan */
    const [a, b] = [...ptrs.values()];
    pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], s: S.view.s, c: [S.view.cx, S.view.cy] };
    if (S.drag && S.drag.commit) { S.model = JSON.parse(S.before); touch(); }
    S.drag = null; return;
  }
  const p = toW(e.clientX, e.clientY);
  S.mouse = p;
  if (e.button === 2) { S.wallStart = null; redraw(); return; }
  if (e.button === 1) { S.drag = { type: 'pan', x: e.clientX, y: e.clientY, c: [S.view.cx, S.view.cy] }; return; }
  if (S.tool === 'wall') { wallClick(p); return; }
  if (S.tool === 'door' || S.tool === 'window') { addOpeningAt(p, S.tool); return; }
  if (S.tool === 'item') { if (S.armed) placeItem(p); return; }
  if (S.tool === 'room') { roomClick(p); return; }
  const h = pick(p);
  startDrag(h, p, e);
});
cv.addEventListener('pointermove', (e) => {
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (pinch && ptrs.size === 2) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    S.view.s = Math.max(8, Math.min(400, pinch.s * d / pinch.d));
    S.view.cx = pinch.c[0] - (m[0] - pinch.m[0]) / S.view.s; S.view.cy = pinch.c[1] - (m[1] - pinch.m[1]) / S.view.s;
    redraw(); return;
  }
  const p = toW(e.clientX, e.clientY);
  S.mouse = p;
  if (S.drag) { dragMove(p, e); redraw(); return; }
  if (S.tool === 'wall') redraw();
});
const endPtr = (e) => {
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch = null;
  if (S.drag) { const d = S.drag; S.drag = null; if (d.commit && d.moved) commit(); else if (d.commit) S.before = null; if (d.tap) tapSelect(d.tap); redraw(); }
};
cv.addEventListener('pointerup', endPtr);
cv.addEventListener('pointercancel', endPtr);
cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const before = toW(e.clientX, e.clientY);
  S.view.s = Math.max(8, Math.min(400, S.view.s * Math.exp(-e.deltaY * 0.0015)));
  const after = toW(e.clientX, e.clientY);
  S.view.cx += before[0] - after[0]; S.view.cy += before[1] - after[1];
  redraw();
}, { passive: false });

function tapSelect(h) {
  S.sel = h && h.type !== 'end' ? (h.type === 'room' && !h.id ? null : h) : S.sel;
  if (!h) S.sel = null;
  syncProps(); redraw();
}
function startDrag(h, p, e) {
  const L = LV();
  if (!h || h.type === 'room') {
    S.drag = { type: 'pan', x: e.clientX, y: e.clientY, c: [S.view.cx, S.view.cy], tap: h, p0: p };
    return;
  }
  begin();
  const base = { p0: p, commit: true, moved: false, sx: e.clientX, sy: e.clientY };
  if (h.type === 'wall') {
    const w = L.walls.find(v => v.id === h.id);
    S.sel = { type: 'wall', id: w.id };
    const chain = chainOf(L, w);
    S.sel.ids = chain.map(v => v.id);
    const f = frame(w);
    /* the same line on the other floors, when it is an outside wall and linking is on */
    const others = [];
    if (S.link && chain.some(v => v.t > 0 && outsideSide(v, S.lvl) !== 0)) {
      S.model.levels.forEach((M, li) => {
        if (li === S.lvl) return;
        const cands = M.walls.filter(v => collinear(v, w) && v.t > 0);
        const s0 = Math.min(...chain.flatMap(v => [dot(sub(v.a, w.a), f.u), dot(sub(v.b, w.a), f.u)])), s1 = Math.max(...chain.flatMap(v => [dot(sub(v.a, w.a), f.u), dot(sub(v.b, w.a), f.u)]));
        const hit = cands.filter(v => { const a = dot(sub(v.a, w.a), f.u), b = dot(sub(v.b, w.a), f.u); return Math.min(a, b) < s1 - 0.05 && Math.max(a, b) > s0 + 0.05; });
        if (hit.length) others.push({ li, ids: chainOf(M, hit[0]).map(v => v.id) });
      });
    }
    S.drag = Object.assign(base, { type: 'wall', id: w.id, n: f.n, orig: JSON.stringify(S.model), chainIds: chain.map(v => v.id), others,
      keys: S.model.levels.map((_, li) => faceKeys(li)), off0: dot(w.a, f.n) });
    syncProps();
  } else if (h.type === 'end') {
    const w = L.walls.find(v => v.id === h.id), f = frame(w), q = w[h.end];
    /* an end joined to walls at an angle: dragging it moves those walls */
    const angled = L.walls.filter(v => v !== w && !collinear(v, w) && (near(v.a, q) || near(v.b, q) || onSeg(q, v)));
    if (angled.length) {
      const chain = chainOf(L, angled[0]);
      S.drag = Object.assign(base, { type: 'wall', id: angled[0].id, n: f.u, orig: JSON.stringify(S.model), chainIds: chain.map(v => v.id), others: [],
        keys: S.model.levels.map((_, li) => faceKeys(li)), along: true });
    } else {
      S.drag = Object.assign(base, { type: 'end', id: w.id, end: h.end, u: f.u, orig: JSON.stringify(S.model), keys: S.model.levels.map((_, li) => faceKeys(li)) });
    }
  } else if (h.type === 'op') {
    S.sel = h; syncProps();
    const w = L.walls.find(v => v.id === h.wall), o = w.ops.find(q => q.id === h.id);
    S.drag = Object.assign(base, { type: 'op', wall: w.id, id: o.id, at0: o.at, u: frame(w).u, mates: bayOf(w, o).filter(q => q !== o).map(q => q.id) });
  } else if (h.type === 'item') {
    S.sel = h; syncProps();
    const it = L.items.find(v => v.id === h.id);
    S.drag = Object.assign(base, { type: 'item', id: it.id, x0: it.x, y0: it.y });
  } else if (h.type === 'stair') {
    S.sel = h; syncProps();
    const st = S.model.stairs.find(v => v.id === h.id);
    S.drag = Object.assign(base, { type: 'stair', id: st.id, orig: clone(st.treads) });
  }
}
function dragMove(p, e) {
  const d = S.drag;
  d.sx = e.clientX; d.sy = e.clientY;
  if (d.type === 'pan') {
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.tap = undefined, d.panned = true;
    if (d.panned) { S.view.cx = d.c[0] - (e.clientX - d.x) / S.view.s; S.view.cy = d.c[1] - (e.clientY - d.y) / S.view.s; }
    return;
  }
  const dv = sub(p, d.p0);
  if (d.type === 'wall') {
    let k = dot(dv, d.n);
    /* snap: 1 cm (or 455), and to other walls' lines parallel to it */
    k = snapLen(k);
    const M0 = JSON.parse(d.orig), L0 = M0.levels[S.lvl], w0 = L0.walls.find(v => v.id === d.id), f0 = frame(w0);
    if (!S.grid455) {
      const line = dot(w0.a, d.n);
      for (const v of L0.walls) {
        if (d.chainIds.includes(v.id)) continue;
        const g = frame(v); if (Math.abs(cross(g.u, f0.u)) > 1e-3) continue;
        const target = dot(v.a, d.n) - line;
        if (Math.abs(target - dot(dv, d.n)) * S.view.s < 7) k = target;
      }
    }
    if (Math.abs(k) < 1e-6 && !d.moved) { return; }
    d.moved = true;
    S.model = M0;
    const L = S.model.levels[S.lvl];
    moveChain(L, L.walls.filter(v => d.chainIds.includes(v.id)), mul(d.n, k));
    for (const o of d.others) { const M = S.model.levels[o.li]; moveChain(M, M.walls.filter(v => o.ids.includes(v.id)), mul(d.n, k)); }
    touch();
    S.model.levels.forEach((_, li) => reanchor(li, d.keys[li].map(x => Object.assign({}, x, { r: S.model.levels[li].rooms.find(r => r.id === x.r.id) })).filter(x => x.r)));
    d.info = (k > 0 ? '+' : '') + mmTxt(k) + ' mm';
  } else if (d.type === 'end') {
    let k = snapLen(dot(dv, d.u));
    const M0 = JSON.parse(d.orig), L0 = M0.levels[S.lvl], w0 = L0.walls.find(v => v.id === d.id), q0 = w0[d.end];
    /* the end lands on a wall line it comes close to */
    const q1 = add(q0, mul(d.u, k));
    for (const v of L0.walls) {
      if (v.id === w0.id || collinear(v, w0)) continue;
      const g = frame(v), c = dot(d.u, g.n); if (Math.abs(c) < 0.1) continue;
      const r = sub(q1, v.a), sa = dot(r, g.u), dq = dot(r, g.n);
      if (sa > -0.01 && sa < g.L + 0.01 && Math.abs(dq) * S.view.s < 9) k = dot(sub(v.a, q0), g.n) / c;
    }
    d.moved = true;
    S.model = M0;
    extendEnd(S.model.levels[S.lvl], d.id, d.end, k);
    touch();
    S.model.levels.forEach((_, li) => reanchor(li, d.keys[li].map(x => Object.assign({}, x, { r: S.model.levels[li].rooms.find(r => r.id === x.r.id) })).filter(x => x.r)));
    d.info = mmTxt(frame(S.model.levels[S.lvl].walls.find(v => v.id === d.id)).L) + ' mm';
  } else if (d.type === 'op') {
    const L = LV(), w = L.walls.find(v => v.id === d.wall), o = (w.ops || []).find(q => q.id === d.id), f = frame(w);
    o.at = r4(Math.max(0, Math.min(f.L - o.w, d.at0 + snapLen(dot(dv, d.u)))));
    for (const q of w.ops) if (d.mates && d.mates.includes(q.id)) q.at = o.at;   /* the other units of a stacked bay */
    d.moved = true; d.info = mmTxt(o.at) + ' mm';
  } else if (d.type === 'item') {
    const it = LV().items.find(v => v.id === d.id);
    it.x = r4(d.x0 + snapLen(dv[0])); it.y = r4(d.y0 + snapLen(dv[1]));
    d.moved = true; d.info = '';
  } else if (d.type === 'stair') {
    const st = S.model.stairs.find(v => v.id === d.id), sx = snapLen(dv[0]), sy = snapLen(dv[1]);
    st.treads = d.orig.map(t => t.map(q => P4([q[0] + sx, q[1] + sy])));
    d.moved = true;
  }
}

/* --------------------------------------------------------------- tools */
function wallClick(p) {
  const sp = snapPoint(p, S.wallStart);
  if (!S.wallStart) { S.wallStart = sp.p; redraw(); return; }
  if (len(sub(sp.p, S.wallStart)) < 0.1) { S.wallStart = null; redraw(); return; }
  begin();
  const w = { id: uid('w'), a: P4(S.wallStart), b: P4(sp.p), t: 0.132 };
  LV().walls.push(w);
  commit();
  S.sel = { type: 'wall', id: w.id };
  S.wallStart = sp.kind === 'end' || sp.kind === 'wall' ? null : sp.p;
  syncProps(); redraw();
}
function addOpeningAt(p, kind) {
  const h = pick(p);
  const L = LV();
  const w = h && (h.type === 'wall' ? L.walls.find(v => v.id === h.id) : h.type === 'op' ? L.walls.find(v => v.id === h.wall) : null);
  if (!w || !(w.t > 0)) { toast(T(kind === 'door' ? 'hintDoor' : 'hintWindow')); return; }
  const f = frame(w), s = dot(sub(p, w.a), f.u);
  const ext = outsideSide(w, S.lvl) !== 0;
  const o = kind === 'door'
    ? { id: uid('o'), type: ext ? 'entry' : 'door', at: 0, w: ext ? 0.95 : 0.78, sill: 0, head: 2.0 }
    : { id: uid('o'), type: 'window', at: 0, w: 1.19, sill: 0.9, head: 2.0 };
  o.w = Math.min(o.w, Math.max(0.3, f.L - 0.1));
  o.at = r4(Math.max(0, Math.min(f.L - o.w, s - o.w / 2)));
  begin();
  (w.ops = w.ops || []).push(o);
  commit();
  S.sel = { type: 'op', wall: w.id, id: o.id }; setTool('select'); syncProps(); redraw();
}
const DEF = {
  bed: [1.4, 2.0], sofa: [2.0, 0.85], table: [1.6, 0.85], bench: [1.4, 0.38], chair: [0.45, 0.45], desk: [1.2, 0.5], closet: [1.8, 0.6], wardrobe: [0.9, 0.6],
  toilet: [0.4, 0.68], vanity: [0.75, 0.5], ub: [1.62, 1.62], shower: [0.9, 1.2], island: [2.4, 0.95], tall: [2.4, 0.45], fridge: [0.7, 0.7], washer: [0.6, 0.6],
  dryer: [0.65, 0.6], stove: [0.56, 0.5], rugRound: [1.6, 1.6], shelves: [1.2, 0.35], rail: [1.6, 0.06], post: [0.12, 0.12], beam: [3.0, 0.12],
};
delete DEF.ub;                                     /* plans b-g have no unit baths in the palette (shower units; plans e-g: the Ichijo panel) */
Object.assign(DEF, { tube: [1.2, 2.0], saunaBench: [1.8, 0.5], saunaHeater: [0.45, 0.45], gymRack: [1.2, 1.2], gymBench: [1.2, 0.3], treadmill: [0.8, 1.9], mat: [2.0, 2.0], railing: [2.0, 0.05] });
function placeItem(p) {
  const k = S.armed, [w, d] = DEF[k] || [1, 1];
  begin();
  const it = { id: uid('f'), kind: k, x: r4(snapLen(p[0])), y: r4(snapLen(p[1])), w, d, a: 0 };
  if (k === 'beam') { it.top = 2.665; it.depth = 0.265; }
  if (k === 'post') it.top = 'roof';
  if (k === 'stove') it.hearth = 1.2;
  if (k === 'rail') it.h = 1.95;
  if (k === 'railing') it.h = 1.1;
  if (k === 'saunaBench') it.h = 0.45;
  (LV().items = LV().items || []).push(it);
  commit();
  S.sel = { type: 'item', id: it.id }; S.armed = null; setTool('select'); syncProps(); redraw();
}
function roomClick(p) {
  const f = faceAt(graph(), p[0], p[1]);
  if (!f) return;
  if (f.room) { S.sel = { type: 'room', id: f.room.id, face: f }; setTool('select'); syncProps(); redraw(); return; }
  begin();
  const r = { id: uid('r'), name: T('newRoom'), ja: '部屋', at: P4(p), floor: 'oak' };
  (LV().rooms = LV().rooms || []).push(r);
  commit();
  S.sel = { type: 'room', id: r.id }; setTool('select'); syncProps(); redraw();
}
function setTool(t) {
  S.tool = t; S.wallStart = null; if (t !== 'item') S.armed = null;
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  $('hint').textContent = T({ select: 'hintSel', wall: 'hintWall', door: 'hintDoor', window: 'hintWindow', item: 'hintItem', room: 'hintRoom' }[t]);
  if (t === 'item') { S.sel = null; syncProps(); }
  cv.style.cursor = t === 'select' ? 'default' : 'crosshair';
  redraw();
}

/* ------------------------------------------------------------ properties */
function el(tag, attrs, kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn); else if (k === 'text') e.textContent = v; else e.setAttribute(k, v); }
  for (const c of kids || []) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}
function numField(label, val, step, fn, unit) {
  const inp = el('input', { type: 'number', step: String(step), value: String(val) });
  inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (isFinite(v)) { begin(); fn(v); commit(); redraw(); syncProps(); } });
  inp.addEventListener('keydown', (e) => e.stopPropagation());
  return el('label', {}, [el('span', { text: label + (unit ? ' (' + unit + ')' : '') }), inp]);
}
function selField(label, val, opts, fn) {
  const s = el('select');
  for (const [v, t] of opts) { const o = el('option', { value: v, text: t }); if (String(v) === String(val)) o.selected = true; s.appendChild(o); }
  s.addEventListener('change', () => { begin(); fn(s.value); commit(); redraw(); syncProps(); });
  return el('label', {}, [el('span', { text: label }), s]);
}
function textField(label, val, fn) {
  const inp = el('input', { type: 'text', value: val || '' });
  inp.addEventListener('change', () => { begin(); fn(inp.value); commit(); redraw(); });
  inp.addEventListener('keydown', (e) => e.stopPropagation());
  return el('label', {}, [el('span', { text: label }), inp]);
}
function btn(text, fn, cls) { const b = el('button', { text }); if (cls) b.className = cls; b.onclick = fn; return b; }
function syncProps() {
  const P = $('props'); P.innerHTML = '';
  const L = LV(), sel = S.sel;
  if (S.tool === 'item') {
    P.appendChild(el('div', { class: 'h' }, [T('item')]));
    P.appendChild(el('div', { class: 'note', text: T('palette') }));
    const row = el('div', { class: 'row' });
    for (const k of Object.keys(DEF)) { const b = btn(TX[LANG].kinds[k] || k, () => { S.armed = k; syncProps(); }); if (S.armed === k) b.className = 'on'; row.appendChild(b); }
    P.appendChild(row); P.classList.add('show'); return;
  }
  document.body.classList.toggle('has-props', !!sel);
  if (!sel) { P.classList.remove('show'); return; }
  const head = (t) => P.appendChild(el('div', { class: 'h' }, [t, btn('×', () => { S.sel = null; syncProps(); redraw(); }, 'x')]));
  if (sel.type === 'wall') {
    const w = L.walls.find(v => v.id === sel.id); if (!w) { S.sel = null; return syncProps(); }
    const f = frame(w);
    head(T('wall'));
    const kind = !(w.t > 0) ? 'line' : w.h ? 'low' : (w.t >= 0.17 ? 'outer' : 'normal');
    P.appendChild(selField(T('kind'), kind, [['normal', T('wNormal')], ['outer', T('wOuter')], ['low', T('wLow')], ['line', T('wLine')]], (v) => {
      if (v === 'line') { w.t = 0; delete w.h; delete w.off; w.ops = []; }
      else if (v === 'outer') { w.t = 0.18; delete w.h; }
      else if (v === 'low') { w.t = Math.max(w.t || 0.12, 0.12); w.h = w.h || 1.0; }
      else { w.t = 0.132; delete w.h; delete w.off; }
      touch();
    }));
    P.appendChild(numField(T('length'), Math.round(f.L * 1000), 10, (v) => {
      const k = v / 1000 - f.L, q = w.b;
      const angled = L.walls.filter(x => x !== w && !collinear(x, w) && (near(x.a, q) || near(x.b, q) || onSeg(q, x)));
      if (angled.length) moveChain(L, chainOf(L, angled[0]), mul(f.u, k)); else extendEnd(L, w.id, 'b', k);
      touch();
    }, 'mm'));
    P.appendChild(el('div', { class: 'note', text: T('lenNote') }));
    if (w.t > 0) P.appendChild(numField(T('thick'), Math.round(w.t * 1000), 5, (v) => { w.t = Math.max(0.03, v / 1000); touch(); }, 'mm'));
    if (w.h) P.appendChild(numField(T('height'), Math.round(w.h * 1000), 50, (v) => { w.h = Math.max(0.1, v / 1000); }, 'mm'));
    const row = el('div', { class: 'row' });
    if (w.t > 0) {
      row.appendChild(btn(T('addDoor'), () => { addOpeningAt(add(w.a, mul(f.u, f.L / 2)), 'door'); }));
      row.appendChild(btn(T('addWin'), () => { addOpeningAt(add(w.a, mul(f.u, f.L / 2)), 'window'); }));
    }
    row.appendChild(btn(T('del'), () => { begin(); L.walls.splice(L.walls.indexOf(w), 1); commit(); S.sel = null; syncProps(); redraw(); }));
    P.appendChild(row);
  } else if (sel.type === 'op') {
    const w = L.walls.find(v => v.id === sel.wall), o = w && (w.ops || []).find(q => q.id === sel.id);
    if (!o) { S.sel = null; return syncProps(); }
    const f = frame(w);
    head(T('opening'));
    const mates = bayOf(w, o).filter(q => q !== o);    /* v23: the other units of a stacked bay */
    P.appendChild(selField(T('kind'), o.type, [['window', T('oWindow')], ['door', T('oDoor')], ['double', T('oDouble')], ['parent-child', T('oParentChild')], ['sliding', T('oSliding')], ['slide', T('oSlide')], ['entry', T('oEntry')], ['hole', T('oHole')]], (v) => {
      o.type = v;
      if (v === 'window' && o.sill < 0.3) o.sill = 0.9;
      if (v !== 'window' && v !== 'hole') o.sill = Math.min(o.sill, 0);
      if (v === 'sliding' && !o.leaves) o.leaves = 2;
      if (v === 'parent-child' && !(o.child > 0)) o.child = r4(childLeaf({}, o.w));
      if (v !== 'window') delete o.stack;
    }));
    P.appendChild(numField(T('width'), Math.round(o.w * 1000), 10, (v) => { o.w = Math.max(0.2, Math.min(f.L, v / 1000)); clampOps(w); for (const q of mates) { q.w = o.w; q.at = o.at; } }, 'mm'));
    if (o.type === 'parent-child') P.appendChild(numField(T('childW'), Math.round(childLeaf(o, o.w) * 1000), 10, (v) => { o.child = r4(Math.max(0.2, Math.min(o.w - 0.3, v / 1000))); }, 'mm'));
    P.appendChild(numField(T('sill'), Math.round(o.sill * 1000), 10, (v) => { o.sill = Math.min(v / 1000, o.head - 0.1); }, 'mm'));
    P.appendChild(numField(T('head'), Math.round(o.head * 1000), 10, (v) => { o.head = Math.max(v / 1000, o.sill + 0.1); }, 'mm'));
    P.appendChild(numField(T('from'), Math.round(o.at * 1000), 10, (v) => { o.at = v / 1000; clampOps(w); for (const q of mates) q.at = o.at; }, 'mm'));
    /* v23: windows stacked over this one (op.stack: band + height per unit, relative to the unit below) */
    if (o.type === 'window') {
      (o.stack || []).forEach((u, k) => {
        P.appendChild(el('div', { class: 'note', text: T('stackH') + ' · ' + T('unit') + ' ' + (k + 2) }));
        P.appendChild(numField(T('band'), Math.round((u.band === undefined ? STACK_BAND : u.band) * 1000), 10, (v) => { u.band = r4(Math.max(0, v / 1000)); }, 'mm'));
        P.appendChild(numField(T('height'), Math.round((+u.h || 0) * 1000), 10, (v) => { u.h = r4(Math.max(0.1, v / 1000)); }, 'mm'));
        P.appendChild(el('div', { class: 'row' }, [btn(T('del'), () => { begin(); o.stack.splice(k, 1); if (!o.stack.length) delete o.stack; commit(); syncProps(); redraw(); })]));
      });
      if (!mates.length && (o.stack || []).length < 2) {
        P.appendChild(el('div', { class: 'row' }, [btn(T('stackAdd'), () => { begin(); (o.stack = o.stack || []).push({ h: 1.17, band: STACK_BAND, style: 'fix' }); commit(); syncProps(); redraw(); })]));
      }
    }
    /* separate openings in one bay (same at + w: a window over a window, a fanlight over a door; the
       plan shows one of them, a click picks the first): step through them bottom to top */
    if (mates.length) {
      const bay = [o, ...mates].sort((p, q) => p.sill - q.sill);
      P.appendChild(el('div', { class: 'note', text: T('stackedN') + ': ' + bayUnits(bay) }));
      P.appendChild(el('div', { class: 'row' }, [btn(T('nextUnit'), () => { const nx = bay[(bay.indexOf(o) + 1) % bay.length]; S.sel = { type: 'op', wall: w.id, id: nx.id }; syncProps(); redraw(); })]));
    }
    const row = el('div', { class: 'row' });
    if (o.type === 'door' || o.type === 'entry' || o.type === 'double' || o.type === 'parent-child') {
      row.appendChild(btn(T('flip'), () => { begin(); o.side = -(o.side || 1); commit(); redraw(); }));
      if (o.type !== 'double') row.appendChild(btn(T('hinge'), () => { begin(); o.hinge = o.hinge === 'b' ? 'a' : 'b'; commit(); redraw(); }));
    }
    row.appendChild(btn(T('del'), () => { begin(); w.ops.splice(w.ops.indexOf(o), 1); commit(); S.sel = null; syncProps(); redraw(); }));
    P.appendChild(row);
  } else if (sel.type === 'item') {
    const it = (L.items || []).find(v => v.id === sel.id); if (!it) { S.sel = null; return syncProps(); }
    head(TX[LANG].kinds[it.kind] || it.kind);
    P.appendChild(numField(T('width'), Math.round(it.w * 1000), 10, (v) => { it.w = Math.max(0.05, v / 1000); }, 'mm'));
    P.appendChild(numField(T('depth'), Math.round(it.d * 1000), 10, (v) => { it.d = Math.max(0.03, v / 1000); }, 'mm'));
    const row = el('div', { class: 'row' });
    const rot = (da) => () => { begin(); it.a = r4(((it.a || 0) + da) % (2 * Math.PI)); commit(); redraw(); syncProps(); };
    row.appendChild(btn(T('rot') + ' 90°', rot(Math.PI / 2)));
    row.appendChild(btn(T('rot') + ' 15°', rot(Math.PI / 12)));
    row.appendChild(btn(T('dup'), () => { begin(); const c = clone(it); c.id = uid('f'); c.x = r4(c.x + 0.3); c.y = r4(c.y + 0.3); L.items.push(c); commit(); S.sel = { type: 'item', id: c.id }; syncProps(); redraw(); }));
    row.appendChild(btn(T('del'), () => { begin(); L.items.splice(L.items.indexOf(it), 1); commit(); S.sel = null; syncProps(); redraw(); }));
    P.appendChild(row);
  } else if (sel.type === 'room') {
    const r = (L.rooms || []).find(v => v.id === sel.id); if (!r) { S.sel = null; return syncProps(); }
    const f = faceAt(graph(), r.at[0], r.at[1]);
    head(T('room'));
    if (f) P.appendChild(el('div', { class: 'area', text: T('area') + ': ' + f.netArea.toFixed(2) + ' m² · ' + (f.netArea / 3.3058).toFixed(2) + ' ' + T('tsubo') }));
    P.appendChild(textField(T('nameJa'), r.ja, (v) => { r.ja = v; }));
    P.appendChild(textField(T('name'), r.name, (v) => { r.name = v; }));
    const fins = [['oak', T('fOak')], ['tile', T('fTile')], ['stone', T('fStone')], ['concrete', T('fConcrete')], ['void', T('fVoid')]];
    fins.splice(4, 0, ['granite', T('fGranite')], ['hinoki', T('fHinoki')], ['rubber', T('fRubber')]);
    P.appendChild(selField(T('floor'), r.floor || 'oak', fins, (v) => { r.floor = v; touch(); }));
    if (S.lvl === 0) P.appendChild(selField(T('level'), String(r.dz || 0), [['0', T('lv0')], ['-0.25', T('lvE')], ['-0.45', T('lvP')]], (v) => { r.dz = +v || 0; if (!r.dz) delete r.dz; touch(); }));
    P.appendChild(el('div', { class: 'row' }, [btn(T('del'), () => { begin(); L.rooms.splice(L.rooms.indexOf(r), 1); commit(); S.sel = null; syncProps(); redraw(); })]));
  } else if (sel.type === 'stair') {
    const st = S.model.stairs.find(v => v.id === sel.id); if (!st) { S.sel = null; return syncProps(); }
    head(T('stair'));
    P.appendChild(el('div', { class: 'note', text: T('stairNote') }));
    P.appendChild(el('div', { class: 'row' }, [btn(T('rot') + ' 90°', () => {
      begin();
      const pts = st.treads.flat(), cxm = pts.reduce((a, p) => a + p[0], 0) / pts.length, cym = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      st.treads = st.treads.map(t => t.map(([x, y]) => P4([cxm - (y - cym), cym + (x - cxm)])));
      commit(); redraw();
    })]));
  }
  P.classList.add('show');
}

/* ------------------------------------------------------------- top bar */
function syncUI() {
  const fl = $('floors'); fl.innerHTML = '';
  S.model.levels.forEach((L, i) => {
    const b = el('button', { text: (TX[LANG].floors[i] || L.name) });
    if (i === S.lvl) b.className = 'on';
    b.onclick = () => { S.lvl = i; S.sel = null; S.wallStart = null; syncUI(); syncProps(); redraw(); };
    fl.appendChild(b);
  });
  $('bUndo').disabled = !S.undo.length; $('bRedo').disabled = !S.redo.length;
  /* floor areas (rooms with a floor) */
  const parts = S.model.levels.map((L, i) => {
    const a = graph(i).rooms.filter(f => !(f.room && f.room.floor === 'void')).reduce((s, f) => s + f.netArea, 0);
    return (TX[LANG].floors[i] || L.name) + ' ' + a.toFixed(1) + 'm²';
  });
  $('areas').textContent = parts.join(' · ');
}
function applyLang() {
  document.documentElement.lang = LANG;
  document.querySelectorAll('[data-i]').forEach(e => { const v = T(e.dataset.i); if (typeof v === 'string') e.textContent = v; });
  document.querySelectorAll('[data-it]').forEach(e => { const v = T(e.dataset.it); if (typeof v === 'string') e.title = v; });
  $('bLang').textContent = LANG === 'ja' ? 'English' : '日本語';
  $('helpBody').innerHTML = T('help');
  document.title = T('title');
  setTool(S.tool);
  if (S.model) { syncUI(); syncProps(); }
  if (PE && ICH.panel) { ichijoChanged(); const b = $('bIch'); if (b) { b.textContent = T('ich'); b.title = T('icht'); } }
}
function toast(t) { const e = $('toast'); e.textContent = t; e.style.display = 'block'; clearTimeout(e._t); e._t = setTimeout(() => { e.style.display = 'none'; }, 2600); }
async function shareLinks() {
  const m = await packModel(S.model), base = location.href.replace(/[#?].*$/, '').replace(/edit\.html$/, '');
  return { edit: base + REF.edit + '#m=' + m, view: base + REF.view + '#m=' + m };
}

function bindUI() {
  document.querySelectorAll('[data-tool]').forEach(b => { b.onclick = () => setTool(b.dataset.tool); });
  $('bUndo').onclick = undo; $('bRedo').onclick = redo;
  $('b3d').onclick = () => { try { localStorage.setItem(REF.key, JSON.stringify(S.model)); } catch (e) { /* */ } location.href = REF.view; };
  $('bShare').onclick = async () => { const l = await shareLinks(); $('shareUrl').value = l.edit; $('share').classList.add('show'); $('bCopy').onclick = () => copy(l.edit); $('bCopy3d').onclick = () => copy(l.view); };
  $('bReset').onclick = () => { if (!confirm(T('resetQ'))) return; begin(); S.model = clone(S.orig); commit(); S.sel = null; syncProps(); fit(); redraw(); };
  $('bLang').onclick = () => { LANG = LANG === 'ja' ? 'en' : 'ja'; try { localStorage.setItem('h3dEditLang', LANG); } catch (e) { /* */ } applyLang(); redraw(); };
  $('bHelp').onclick = () => $('help').classList.add('show');
  $('help').onclick = (e) => { if (e.target.id === 'help') $('help').classList.remove('show'); };
  const bp = $('bPlans'); if (bp) bp.onclick = () => { try { localStorage.setItem(REF.key, JSON.stringify(S.model)); } catch (e) { /* */ } location.href = 'plans.html'; };
  $('bLink').onclick = () => { S.link = !S.link; $('bLink').classList.toggle('on', S.link); };
  $('bGrid').onclick = () => { S.grid455 = !S.grid455; $('bGrid').classList.toggle('on', S.grid455); };
  addEventListener('resize', resize);
  addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.key === 'Escape') { if (S.wallStart) S.wallStart = null; else { S.sel = null; setTool('select'); } syncProps(); redraw(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel) { e.preventDefault(); deleteSel(); }
    if (e.key === '1' || e.key === '2' || e.key === '3') { const i = +e.key - 1; if (S.model.levels[i]) { S.lvl = i; S.sel = null; syncUI(); syncProps(); redraw(); } }
  });
}
function deleteSel() {
  const L = LV(), sel = S.sel; if (!sel) return;
  begin();
  if (sel.type === 'wall') { const i = L.walls.findIndex(v => v.id === sel.id); if (i >= 0) L.walls.splice(i, 1); }
  else if (sel.type === 'op') { const w = L.walls.find(v => v.id === sel.wall); if (w) w.ops = (w.ops || []).filter(o => o.id !== sel.id); }
  else if (sel.type === 'item') L.items = (L.items || []).filter(v => v.id !== sel.id);
  else if (sel.type === 'room') L.rooms = (L.rooms || []).filter(v => v.id !== sel.id);
  else { S.before = null; return; }
  commit(); S.sel = null; syncProps(); redraw();
}
async function copy(t) {
  try { await navigator.clipboard.writeText(t); toast(T('copied')); }
  catch (e) { const ta = $('shareUrl'); ta.value = t; ta.select(); document.execCommand('copy'); toast(T('copied')); }
}

/* ------------------------------------------------------- plan e: Ichijo */
/* the panel (ichijo.js mountPanel) edits model.ichijo + room.fit like any other
   change (undo, autosave, share link); the derived fittings are drawn over the
   plan: each catalogue piece's footprint in its room, coloured by its verdict */
const ICH = { mod: null, cat: null, info: null, panel: null, stale: true, replaced: new Set() };
function ichijoChanged() { ICH.stale = true; redraw(); }
function ichijoPrep() {
  if (!ICH.mod || (!ICH.stale && ICH.info) || S.drag) return;
  try {
    const D = ICH.mod.derive(S.model, ICH.cat, LANG);
    ICH.info = D.info;
    /* the drawn pieces a catalogue choice replaces (faint) */
    const dm = new Map(D.model.levels.flatMap(L => (L.items || []).map(it => [it.id, it])));
    const moved = (it, d) => !d || Math.abs(d.x - it.x) > 1e-3 || Math.abs(d.y - it.y) > 1e-3 || Math.abs((d.a || 0) - (it.a || 0)) > 1e-3;
    ICH.replaced = new Set(S.model.levels.flatMap(L => (L.items || []).filter(it => it.fx && moved(it, dm.get(it.id))).map(it => it.id)));
    ICH.stale = false;
    if (ICH.panel && !ICH.panel.el.hidden) ICH.panel.render();
  } catch (e) { console.error('ichijo', e); }
}
const VCOL = { FITS: ['rgba(46,170,98,.28)', '#1f8f50'], NEEDS: ['rgba(245,170,40,.30)', '#c07c00'], NO: ['rgba(230,60,60,.26)', '#c62828'], CUSTOM: ['rgba(90,140,200,.18)', '#3a6ea8'], INFO: ['rgba(60,60,70,.10)', '#6b6f75'] };
function ichijoOverlay(c) {
  const info = ICH.info; if (!info) return;
  /* the sloped ceiling zone (2F) */
  if (S.lvl === 1 && info.zone) {
    const z = info.zone.rect, a = toS([z[0], z[1]]), b = toS([z[2], z[3]]);
    c.save(); c.setLineDash([7, 5]); c.strokeStyle = '#7a5bc4'; c.lineWidth = 1.6; c.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); c.restore();
    c.font = '600 11px sans-serif'; c.fillStyle = '#6a4bb4'; c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText((LANG === 'ja' ? '勾配天井 ' : 'Sloped ceiling ') + info.zone.area.toFixed(1) + ' m² · ' + info.zone.low.toFixed(2) + '–' + info.zone.high.toFixed(2) + ' m', Math.min(a[0], b[0]) + 6, Math.min(a[1], b[1]) + 5);
  }
  for (const p of info.pieces) {
    if (p.level !== S.lvl) continue;
    const col = VCOL[p.verdict] || VCOL.INFO, P = p.poly.map(toS);
    c.beginPath(); P.forEach((q, i) => i ? c.lineTo(...q) : c.moveTo(...q)); c.closePath();
    c.fillStyle = col[0]; c.fill(); c.strokeStyle = col[1]; c.lineWidth = 1.6; c.stroke();
    if (!p.label || S.view.s < 40) continue;
    const m = P.reduce((a, q) => [a[0] + q[0] / P.length, a[1] + q[1] / P.length], [0, 0]);
    const f = info.fits.find(x => x.roomId === p.room && x.fit === p.fit);
    const txt = (p.fit === 'kitchen' || p.fit === 'toilet' ? '' : (p.label.replace(/\s+(std|標準|\+¥[\d,]+|list ¥[\d,]+|定価¥[\d,]+).*$/, '').split(' ').slice(-1)[0] + ' ')) + (f ? ICH.mod.verdictText(f, LANG) : '');
    c.save(); c.font = '600 10px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 3; c.strokeStyle = 'rgba(255,255,255,.85)'; c.strokeText(txt, m[0], m[1]); c.fillStyle = col[1]; c.fillText(txt, m[0], m[1]); c.restore();
  }
}
async function ichijoStart() {
  const mod = await import('./ichijo.js?v=9');
  ICH.mod = mod; ICH.cat = await mod.loadCatalog('catalog.json?v=2');
  const top = $('top');
  const b = el('button', { id: 'bIch', class: 'go', text: T('ich') }); b.title = T('icht');
  top.insertBefore(b, $('b3d').nextSibling);
  ICH.panel = mod.mountPanel(document.body, {
    model: () => S.model, cat: ICH.cat, lang: () => LANG, info: () => { ichijoPrep(); return ICH.info; },
    change: (fn) => { begin(); S.model.ichijo = S.model.ichijo || {}; fn(S.model); commit(); },
    closeBtn: () => show(false),
  });
  const P = ICH.panel.el;
  P.style.top = '64px'; P.style.right = '8px';
  const show = (v) => { ICH.panel.show(v); b.classList.toggle('on', v); document.body.classList.toggle('ich-open', v); if (v) { ICH.stale = true; ichijoPrep(); ICH.panel.render(); } };
  b.onclick = () => show(P.hidden);
  if (!document.getElementById('ich-edit-css')) {
    const st = document.createElement('style'); st.id = 'ich-edit-css';
    st.textContent = 'body.ich-open #props{right:356px} @media (max-width:640px){ body.ich-open #props{right:8px} }';
    document.head.appendChild(st);
  }
  show(innerWidth >= 900);
  redraw();
}

/* ---------------------------------------------------------------- start */
(async () => {
  if (window.H3D_LEAVING) return;   /* edit.html's head script is sending this ?plan to the other app */
  const r = await fetch(REF.url); S.orig = await r.json();
  const { model, from } = await loadModel(REF.url, REF.key);
  S.model = model; S.from = from;
  if (from === 'link') {
    /* an opened link becomes this browser's saved copy: stamp it with the built-in
       file's version so loadModel keeps it (a link from an older drawing included) */
    if (S.orig && S.orig.version !== undefined) model.version = S.orig.version;
    try { localStorage.setItem(REF.key, JSON.stringify(model)); } catch (e) { /* */ }
    history.replaceState(null, '', location.pathname + location.search);
    setTimeout(() => toast(T('fromLink')), 300);
  }
  for (const L of S.model.levels) { L.items = L.items || []; L.rooms = L.rooms || []; }
  bindUI(); resize(); fit(); applyLang(); syncUI(); redraw();
  if (PE) await ichijoStart();
  Object.assign(window, { S, graph, redraw, syncUI, chainOf, moveChain, pick, toS, toW, frame, ICH });
  window.__ready = true;
})().catch(e => { document.body.insertAdjacentHTML('beforeend', '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#a00">' + e + '</div>'); console.error(e); });
