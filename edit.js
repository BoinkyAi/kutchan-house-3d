/* Plan editor for the Tsuchiya Kensetsu reference house (and anything else in
   the ref-model.json format, see refplan.js). Drag walls, doors, windows and
   furniture; the 3D walkthrough (index.html?house=3) builds from the same
   model, saved in this browser or carried in a share link (#m=...).
   ?plan=b = the revised plan (ref-model-b.json, 3D: index.html?house=4) and
   ?plan=c = Plan B compact (ref-model-c.json, 3D: index.html?house=5), each
   saved under its own key; without ?plan everything is as before. */
'use strict';
import { levelGraph, faceAt, polyArea, inPoly, labelPoint, packModel, STORE_KEY, loadModel } from './refplan.js?v=5';

/* the built-in plans: model file, saved copy (localStorage key), 3D page, editor page */
const PLANS = {
  a: { url: 'ref-model.json?v=1', key: STORE_KEY, view: 'index.html?house=3', edit: 'edit.html' },
  b: { url: 'ref-model-b.json?v=2', key: 'h3dRefModelB', view: 'index.html?house=4', edit: 'edit.html?plan=b' },
  c: { url: 'ref-model-c.json?v=2', key: 'h3dRefModelC', view: 'index.html?house=5', edit: 'edit.html?plan=c' },
};
const _qPlan = (new URLSearchParams(location.search).get('plan') || 'a').toLowerCase();
const PLAN = PLANS[_qPlan] ? _qPlan : 'a';
const REF = PLANS[PLAN];
const PB = PLAN !== 'a';            /* plans b + c: their own strings, gym / onsen pieces, no unit bath */

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
    name: 'Name', nameJa: 'Name (日本語)', floor: 'Floor', level: 'Floor level', area: 'Area',
    fOak: 'Wood (red pine)', fTile: 'Tile', fStone: 'Stone tile (entrance)', fConcrete: 'Concrete', fVoid: 'Open to below (no floor)',
    lv0: 'Normal', lvE: '−25 cm (entrance)', lvP: '−45 cm (porch)',
    depth: 'Depth', rot: 'Rotate', newRoom: 'Room', addDoor: '+ Door', addWin: '+ Window',
    resetQ: "Throw away your changes and go back to Tsuchiya Kensetsu's original plan?",
    fromLink: 'Opened a shared plan. Your changes save in this browser.',
    saved: 'Saved', tsubo: 'tsubo',
    palette: 'Pick a piece, then click on the plan:',
    stairNote: 'Drag to move the whole stair. Rotate turns it about its centre.',
    lenNote: 'Typing a length moves the wall’s end point (the B end).',
    kinds: { bed: 'Bed', sofa: 'Sofa', table: 'Table', bench: 'Bench', chair: 'Chair', desk: 'Desk / counter', closet: 'Built-in storage', wardrobe: 'Wardrobe', toilet: 'Toilet',
      vanity: 'Washstand', ub: 'Unit bath', shower: 'Shower unit', island: 'Kitchen island', tall: 'Tall kitchen units', fridge: 'Fridge', washer: 'Washing machine', dryer: 'Dryer',
      stove: 'Wood stove', rugRound: 'Round rug', shelves: 'Shelves', rail: 'Hanging rail', post: 'Post', beam: 'Beam',
      tube: 'Soaking tub (hinoki)', saunaBench: 'Sauna bench', saunaHeater: 'Sauna heater', gymRack: 'Power rack', gymBench: 'Weight bench',
      treadmill: 'Treadmill', mat: 'Exercise mat', railing: 'Glass railing' },
    help: '<h3>Plan editor</h3>'
      + '<b>Move a wall</b>: drag it. The walls joined to it stretch with it, rooms reshape and their areas update. A straight run of walls moves together. With <b>Outside walls: all floors</b> on, moving an outside wall moves it on every floor (the roof follows).<br>'
      + '<b>Wall ends</b>: select a wall, then drag the round handle at an end to make it longer or shorter.<br>'
      + '<b>Doors, windows, furniture</b>: drag them. Select one to change its size, type or height in the panel, or delete it (<kbd>Del</kbd>).<br>'
      + '<b>New walls</b>: <i>Draw wall</i>, click start and end. <b>Rooms</b> are whatever the walls enclose; <i>Name a room</i> to label one.<br>'
      + '<b>Floors</b>: 1F / 2F / Loft tabs at the top. The floor below shows faintly underneath.<br>'
      + '<b>Undo</b> <kbd>Ctrl Z</kbd> · <b>Redo</b> <kbd>Ctrl Shift Z</kbd> · zoom: wheel or pinch · pan: drag empty space.<br><br>'
      + 'Everything saves in this browser automatically. <b>View in 3D</b> opens the walkthrough of your version; <b>Share link</b> makes a link to send (the plan is inside the link). <b>Reset</b> goes back to Tsuchiya Kensetsu’s original.<br>'
      + '<span style="opacity:.6">Source: Tsuchiya Kensetsu reference house plan drawings. Sizes are from the CAD drawings; walls are on their 910 mm grid lines.</span>',
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
    name: '名前（英語）', nameJa: '名前', floor: '床', level: '床の高さ', area: '面積',
    fOak: '木（赤松）', fTile: 'タイル', fStone: '石タイル（玄関）', fConcrete: 'コンクリート', fVoid: '吹抜け（床なし）',
    lv0: '標準', lvE: '−25cm（玄関土間）', lvP: '−45cm（風除室）',
    depth: '奥行', rot: '回転', newRoom: '部屋', addDoor: '＋ドア', addWin: '＋窓',
    resetQ: '変更をすべて破棄して、土屋建設の元の図面に戻しますか？',
    fromLink: '共有された間取りを開きました。変更はこのブラウザに保存されます。',
    saved: '保存しました', tsubo: '坪',
    palette: '家具を選んでから図面をクリック：',
    stairNote: 'ドラッグで階段全体を移動。回転は中心で回します。',
    lenNote: '長さを入力すると壁の終点（B側）が動きます。',
    kinds: { bed: 'ベッド', sofa: 'ソファ', table: 'テーブル', bench: 'ベンチ', chair: '椅子', desk: 'デスク・カウンター', closet: '造作収納', wardrobe: 'ワードローブ', toilet: 'トイレ',
      vanity: '洗面台', ub: 'ユニットバス', shower: 'シャワーユニット', island: 'アイランドキッチン', tall: 'キッチン収納（背面）', fridge: '冷蔵庫', washer: '洗濯機', dryer: '乾燥機',
      stove: '薪ストーブ', rugRound: '丸ラグ', shelves: '棚', rail: '物干しパイプ', post: '柱', beam: '梁',
      tube: '浴槽（ひのき）', saunaBench: 'サウナベンチ', saunaHeater: 'サウナストーブ', gymRack: 'パワーラック', gymBench: 'トレーニングベンチ',
      treadmill: 'ランニングマシン', mat: 'トレーニングマット', railing: 'ガラス手すり' },
    help: '<h3>間取り編集</h3>'
      + '<b>壁を動かす</b>：壁をドラッグします。つながっている壁が伸び縮みし、部屋の形と面積も更新されます。一直線に並んだ壁は一緒に動きます。<b>外壁は全フロア連動</b>がオンのとき、外壁を動かすと全フロアの外壁が動きます（屋根も追従）。<br>'
      + '<b>壁の長さ</b>：壁を選択し、端の丸いハンドルをドラッグして伸ばす・縮める。<br>'
      + '<b>ドア・窓・家具</b>：ドラッグで移動。選択するとパネルで大きさ・種類・高さを変更、または削除（<kbd>Del</kbd>）。<br>'
      + '<b>壁を追加</b>：「壁を描く」で始点と終点をクリック。<b>部屋</b>は壁で囲まれた範囲です。「部屋名をつける」で名前をつけられます。<br>'
      + '<b>フロア</b>：上部の1F / 2F / ロフトで切り替え。下の階はうっすら表示されます。<br>'
      + '<b>取り消し</b> <kbd>Ctrl Z</kbd> ・ <b>やり直し</b> <kbd>Ctrl Shift Z</kbd> ・ ズーム：ホイール／ピンチ ・ 移動：何もない所をドラッグ<br><br>'
      + '変更はこのブラウザに自動保存されます。<b>3Dで見る</b>で編集後の3Dウォークスルー、<b>共有リンク</b>で送れるリンクを作成（データはリンク内）。<b>元の図面に戻す</b>で土屋建設の元の図面に戻ります。<br>'
      + '<span style="opacity:.6">出典：土屋建設 参考住宅プラン図面。寸法はCAD図面どおり、壁は910mmグリッドの芯です。</span>',
  },
};
/* the revised plan (?plan=b) and Plan B compact (?plan=c): own title, reset question, extra floor finishes */
const TXB = {
  en: { title: 'Plan editor · Tsuchiya revised', resetQ: 'Throw away your changes and go back to the revised plan as first drawn?',
    fGranite: 'Dark stone (bath)', fHinoki: 'Hinoki (sauna)', fRubber: 'Rubber (gym)',
    help: TX.en.help.replace('<b>Reset</b> goes back to Tsuchiya Kensetsu’s original.', '<b>Reset</b> goes back to the revised plan as first drawn.')
      .replace('Source: Tsuchiya Kensetsu reference house plan drawings. Sizes are from the CAD drawings; walls are on their 910 mm grid lines.', 'The revised plan (gym + onsen 1F; LDK, an ensuite bedroom and an open den 2F; an ensuite bedroom and a den in the loft), on the Tsuchiya Kensetsu reference house’s 910 mm grid.') },
  ja: { title: '間取り編集・土屋 改案', resetQ: '変更をすべて破棄して、改案の最初の間取りに戻しますか？',
    fGranite: '黒い石調タイル（浴室）', fHinoki: 'ひのき（サウナ）', fRubber: 'ゴム床（ジム）',
    help: TX.ja.help.replace('<b>元の図面に戻す</b>で土屋建設の元の図面に戻ります。', '<b>元の図面に戻す</b>で改案の最初の間取りに戻ります。')
      .replace('出典：土屋建設 参考住宅プラン図面。寸法はCAD図面どおり、壁は910mmグリッドの芯です。', '土屋建設の参考プランの改案（1階ジム＋温泉、2階LDK・専用シャワー室付き寝室・オープンな書斎、ロフトに専用シャワー室付き寝室・書斎）。壁は910mmグリッドの芯です。') },
};
const TXC = {
  en: { title: 'Plan editor · Plan B compact', resetQ: 'Throw away your changes and go back to Plan B compact as first drawn?',
    fGranite: TXB.en.fGranite, fHinoki: TXB.en.fHinoki, fRubber: TXB.en.fRubber,
    help: TXB.en.help.replace('<b>Reset</b> goes back to the revised plan as first drawn.', '<b>Reset</b> goes back to Plan B compact as first drawn.')
      .replace('<b>Floors</b>: 1F / 2F / Loft tabs at the top.', '<b>Floors</b>: 1F / 2F tabs at the top.')
      .replace('The revised plan (gym + onsen 1F; LDK, an ensuite bedroom and an open den 2F; an ensuite bedroom and a den in the loft), on the Tsuchiya Kensetsu reference house’s 910 mm grid.',
        'Plan B compact: the compact, cheaper version of Plan B. One 13.65 x 9.1 m box (15 x 10 modules of 910 mm), its long side on the view, under one sloped roof (high on the north): gym + onsen on 1F; living + dining, kitchen, 2 ensuite bedrooms and 2 dens on 2F.') },
  ja: { title: '間取り編集・プランB 縮小版', resetQ: '変更をすべて破棄して、プランB 縮小版の最初の間取りに戻しますか？',
    fGranite: TXB.ja.fGranite, fHinoki: TXB.ja.fHinoki, fRubber: TXB.ja.fRubber,
    help: TXB.ja.help.replace('<b>元の図面に戻す</b>で改案の最初の間取りに戻ります。', '<b>元の図面に戻す</b>でプランB 縮小版の最初の間取りに戻ります。')
      .replace('<b>フロア</b>：上部の1F / 2F / ロフトで切り替え。', '<b>フロア</b>：上部の1F / 2Fで切り替え。')
      .replace('土屋建設の参考プランの改案（1階ジム＋温泉、2階LDK・専用シャワー室付き寝室・オープンな書斎、ロフトに専用シャワー室付き寝室・書斎）。壁は910mmグリッドの芯です。',
        'プランB 縮小版：プランBをコンパクトにしてコストを抑えた案。13.65×9.1mの総2階（910mmモジュールで15×10、長辺が眺望側）、片流れ屋根1枚（北側が高い）。1階ジム＋温泉、2階リビング・ダイニング、キッチン、専用シャワー室付き寝室2、書斎2。壁は910mmグリッドの芯です。') },
};
const TXP = { b: TXB, c: TXC };
let LANG = new URLSearchParams(location.search).get('lang') || localStorage.getItem('h3dEditLang') || 'en';
if (!TX[LANG]) LANG = 'en';
const T = (k) => (PB && TXP[PLAN][LANG][k] !== undefined) ? TXP[PLAN][LANG][k] : TX[LANG][k] !== undefined ? TX[LANG][k] : TX.en[k];
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
  if (!pts.length) return;
  const x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1]));
  const mobile = W < 640;
  const padL = mobile ? 20 : 190, padR = mobile ? 20 : 300, padT = mobile ? 70 : 80, padB = mobile ? 130 : 50;
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
  /* stairs (the flights that start on this floor, and the ones arriving here shown dashed) */
  for (const st of S.model.stairs || []) {
    if (st.from === S.lvl) drawStair(c, st, false);
    else if (st.from === S.lvl - 1) drawStair(c, st, true);
  }
  /* furniture */
  for (const it of L.items || []) drawItem(c, it);
  /* walls */
  const outer = new Map();
  for (const w of L.walls) outer.set(w.id, w.t > 0 ? outsideSide(w, S.lvl) : 0);
  for (const w of L.walls) {
    const sel = S.sel && ((S.sel.type === 'wall' && S.sel.ids && S.sel.ids.includes(w.id)) || (S.sel.type === 'wall' && S.sel.id === w.id));
    if (!(w.t > 0)) { dividerLine(c, w, sel); continue; }
    const col = sel ? '#1d7fb8' : (outer.get(w.id) ? '#2f3338' : (w.h ? '#8b8f94' : '#565b61'));
    wallBody(c, w, col, w.ops || []);
    for (const o of w.ops || []) drawOpening(c, w, o, S.sel && S.sel.type === 'op' && S.sel.id === o.id);
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
    line(at(s0, qm - 0.015), at(s1, qm - 0.015)); line(at(s0, qm + 0.015), at(s1, qm + 0.015));
    if (o.type === 'slide') { const m = (s0 + s1) / 2; line(at(s0, qm - 0.04), at(m + 0.05, qm - 0.04)); line(at(m - 0.05, qm + 0.04), at(s1, qm + 0.04)); }
  } else if (o.type === 'door' || o.type === 'entry' || o.type === 'double') {
    const leaves = o.type === 'double' ? [[s0, 1, (s1 - s0) / 2], [s1, -1, (s1 - s0) / 2]] : [[hingeB ? s1 : s0, hingeB ? -1 : 1, s1 - s0]];
    const qf = side > 0 ? f.q1 : f.q0;
    for (const [hs, dir, lw] of leaves) {
      const hinge = at(hs, qf), tip = at(hs, qf + side * lw), shut = at(hs + dir * lw, qf);
      c.lineWidth = sel ? 2.5 : (o.type === 'entry' ? 2.2 : 1.2); line(hinge, tip);
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
function itemPoly(it, grow) {
  const ca = Math.cos(it.a || 0), sa = Math.sin(it.a || 0), hw = it.w / 2 + (grow || 0), hd = it.d / 2 + (grow || 0);
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => [it.x + x * ca - y * sa, it.y + x * sa + y * ca]);
}
const loc = (it, x, y) => { const ca = Math.cos(it.a || 0), sa = Math.sin(it.a || 0); return toS([it.x + x * ca - y * sa, it.y + x * sa + y * ca]); };
function drawItem(c, it) {
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
}
function begin() { S.before = JSON.stringify(S.model); }
function save() {
  clearTimeout(_saveT);
  _saveT = setTimeout(() => { try { localStorage.setItem(REF.key, JSON.stringify(S.model)); } catch (e) { console.warn(e); } }, 150);
}
function undo() { if (!S.undo.length) return; S.redo.push(JSON.stringify(S.model)); S.model = JSON.parse(S.undo.pop()); S.sel = null; touch(); save(); syncUI(); redraw(); }
function redo() { if (!S.redo.length) return; S.undo.push(JSON.stringify(S.model)); S.model = JSON.parse(S.redo.pop()); S.sel = null; touch(); save(); syncUI(); redraw(); }

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
    S.drag = Object.assign(base, { type: 'op', wall: w.id, id: o.id, at0: o.at, u: frame(w).u });
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
if (PB) {
  delete DEF.ub;                                   /* plans b + c have no unit baths (shower units only) */
  Object.assign(DEF, { tube: [1.2, 2.0], saunaBench: [1.8, 0.5], saunaHeater: [0.45, 0.45], gymRack: [1.2, 1.2], gymBench: [1.2, 0.3], treadmill: [0.8, 1.9], mat: [2.0, 2.0], railing: [2.0, 0.05] });
}
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
    P.appendChild(selField(T('kind'), o.type, [['window', T('oWindow')], ['door', T('oDoor')], ['double', T('oDouble')], ['sliding', T('oSliding')], ['slide', T('oSlide')], ['entry', T('oEntry')], ['hole', T('oHole')]], (v) => {
      o.type = v;
      if (v === 'window' && o.sill < 0.3) o.sill = 0.9;
      if (v !== 'window' && v !== 'hole') o.sill = Math.min(o.sill, 0);
      if (v === 'sliding' && !o.leaves) o.leaves = 2;
    }));
    P.appendChild(numField(T('width'), Math.round(o.w * 1000), 10, (v) => { o.w = Math.max(0.2, Math.min(f.L, v / 1000)); clampOps(w); }, 'mm'));
    P.appendChild(numField(T('sill'), Math.round(o.sill * 1000), 10, (v) => { o.sill = Math.min(v / 1000, o.head - 0.1); }, 'mm'));
    P.appendChild(numField(T('head'), Math.round(o.head * 1000), 10, (v) => { o.head = Math.max(v / 1000, o.sill + 0.1); }, 'mm'));
    P.appendChild(numField(T('from'), Math.round(o.at * 1000), 10, (v) => { o.at = v / 1000; clampOps(w); }, 'mm'));
    const row = el('div', { class: 'row' });
    if (o.type === 'door' || o.type === 'entry' || o.type === 'double') {
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
    if (PB) fins.splice(4, 0, ['granite', T('fGranite')], ['hinoki', T('fHinoki')], ['rubber', T('fRubber')]);
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
  document.title = PB ? T('title') : T('title') + ' — ' + (LANG === 'ja' ? (S.model && S.model.ja || '土屋建設 参考プラン') : 'Tsuchiya Kensetsu reference house');
  setTool(S.tool);
  if (S.model) { syncUI(); syncProps(); }
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

/* ---------------------------------------------------------------- start */
(async () => {
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
  Object.assign(window, { S, graph, redraw, syncUI, chainOf, moveChain, pick, toS, toW, frame });
  window.__ready = true;
})().catch(e => { document.body.insertAdjacentHTML('beforeend', '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#a00">' + e + '</div>'); console.error(e); });
