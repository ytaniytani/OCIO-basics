// I-04 色度図と色域ビューア(第2章)
// ねらい: 色空間ごとに「使える色の広さ」がちがうと知る。

import {
  createWidget, el, buttonGroup, toggle, fmtNum,
} from '../core/ui.js';
import { GAMUTS, xyzToGamut, matApply, TRANSFERS } from '../core/color.js';

// ---------------------------------------------------------------------------
// CIE 1931 (2度視野) のスペクトル軌跡。馬蹄形のふちの座標です。
//
// 出典: CIE 1931 標準表色系の色度座標表(5nm きざみ、380〜700nm)。
//
// 以前は解析近似の式を使っていましたが、700nm あたりで大きく外れ
// (公表値 x=0.7347 に対して 0.5684)、馬蹄形の赤い先端が内側に
// 折り返して切れて見えていました。そのため公表値の表に置きかえています。
//
// 700nm の点 (0.7347, 0.2653) は、ACES2065-1 (AP0) の赤の原色と同じ座標です。
// AP0 の赤がスペクトル軌跡の上に乗っていることを、この図で確かめられます。
// ---------------------------------------------------------------------------

const SPECTRAL_LOCUS = [
  [380, 0.1741, 0.0050], [385, 0.1740, 0.0050], [390, 0.1738, 0.0049],
  [395, 0.1736, 0.0049], [400, 0.1733, 0.0048], [405, 0.1730, 0.0048],
  [410, 0.1726, 0.0048], [415, 0.1721, 0.0048], [420, 0.1714, 0.0051],
  [425, 0.1703, 0.0058], [430, 0.1689, 0.0069], [435, 0.1669, 0.0086],
  [440, 0.1644, 0.0109], [445, 0.1611, 0.0138], [450, 0.1566, 0.0177],
  [455, 0.1510, 0.0227], [460, 0.1440, 0.0297], [465, 0.1355, 0.0399],
  [470, 0.1241, 0.0578], [475, 0.1096, 0.0868], [480, 0.0913, 0.1327],
  [485, 0.0687, 0.2007], [490, 0.0454, 0.2950], [495, 0.0235, 0.4127],
  [500, 0.0082, 0.5384], [505, 0.0039, 0.6548], [510, 0.0139, 0.7502],
  [515, 0.0389, 0.8120], [520, 0.0743, 0.8338], [525, 0.1142, 0.8262],
  [530, 0.1547, 0.8059], [535, 0.1929, 0.7816], [540, 0.2296, 0.7543],
  [545, 0.2658, 0.7243], [550, 0.3016, 0.6923], [555, 0.3373, 0.6589],
  [560, 0.3731, 0.6245], [565, 0.4087, 0.5896], [570, 0.4441, 0.5547],
  [575, 0.4788, 0.5202], [580, 0.5125, 0.4866], [585, 0.5448, 0.4544],
  [590, 0.5752, 0.4242], [595, 0.6029, 0.3965], [600, 0.6270, 0.3725],
  [605, 0.6482, 0.3514], [610, 0.6658, 0.3340], [615, 0.6801, 0.3197],
  [620, 0.6915, 0.3083], [625, 0.7006, 0.2993], [630, 0.7079, 0.2920],
  [635, 0.7140, 0.2859], [640, 0.7190, 0.2809], [645, 0.7230, 0.2770],
  [650, 0.7260, 0.2740], [655, 0.7283, 0.2717], [660, 0.7300, 0.2700],
  [665, 0.7311, 0.2689], [670, 0.7320, 0.2680], [675, 0.7327, 0.2673],
  [680, 0.7334, 0.2666], [685, 0.7340, 0.2660], [690, 0.7344, 0.2656],
  [695, 0.7346, 0.2654], [700, 0.7347, 0.2653],
];

/**
 * 馬蹄形のふちの点を返します。
 * 最後の点と最初の点を直線で結ぶと、下側の「純紫線」になります。
 * @returns {Array<[number, number, number]>} [x, y, 波長] の並び
 */
export function spectralLocus() {
  return SPECTRAL_LOCUS.map(([l, x, y]) => [x, y, l]);
}

// ---------------------------------------------------------------------------
// 色覚のシミュレーション。
// 出典: Viénot, Brettel, Mollon (1999) の方法。よく使われている近似です。
// 実際の見えかたは人によってちがいます。あくまで目安です。
// ---------------------------------------------------------------------------

function simulateCVD(rgb, type) {
  if (type === 'none') return rgb;
  const [r, g, b] = rgb;
  const L = 17.8824 * r + 43.5161 * g + 4.11935 * b;
  const M = 3.45565 * r + 27.1554 * g + 3.86714 * b;
  const S = 0.0299566 * r + 0.184309 * g + 1.46709 * b;
  let L2 = L, M2 = M;
  if (type === 'protan') L2 = 2.02344 * M - 2.52581 * S;
  else if (type === 'deutan') M2 = 0.494207 * L + 1.24827 * S;
  return [
    0.080944 * L2 - 0.130504 * M2 + 0.116721 * S,
    -0.0102485 * L2 + 0.0540194 * M2 - 0.113615 * S,
    -0.000365294 * L2 - 0.00412163 * M2 + 0.693513 * S,
  ];
}

// ---------------------------------------------------------------------------

const GAMUT_LIST = [
  { key: 'sRGB', color: '#ffffff', dash: [] },
  { key: 'P3D65', color: '#7fd0ff', dash: [7, 4] },
  { key: 'Rec2020', color: '#9cf07f', dash: [3, 3] },
  { key: 'AP1', color: '#ffc861', dash: [10, 3, 2, 3] },
  { key: 'AP0', color: '#ff8f8f', dash: [1, 4] },
];

const SIZE = 460;
const PAD = 42;

export default function i04(mount) {
  const w = createWidget(mount, {
    title: '使える色の広さをくらべる',
    aim: '馬蹄形が「人の目に見える色ぜんぶ」。その中の三角形が、それぞれの色空間で表せる範囲です。',
  });

  const canvas = el('canvas', {
    width: SIZE, height: SIZE, class: 'cie-canvas',
    role: 'img',
    'aria-label': '色度図。人の目に見える色の範囲を表す馬蹄形の中に、色空間ごとの三角形が重ねてあります。',
  });
  w.view.appendChild(canvas);

  const table = el('div', { class: 'table-wrap' });
  w.view.appendChild(table);

  const active = new Set(['sRGB', 'Rec2020']);
  let cvd = 'none';
  let showWhite = false;
  let probe = null;

  const picks = el('div', { class: 'ctl-btns' });
  for (const g of GAMUT_LIST) {
    const b = el('button', {
      type: 'button', class: 'btn btn-choice', 'aria-pressed': active.has(g.key) ? 'true' : 'false',
      text: GAMUTS[g.key].label,
    });
    b.style.borderLeft = `5px solid ${g.color}`;
    b.addEventListener('click', () => {
      if (active.has(g.key)) active.delete(g.key); else active.add(g.key);
      b.setAttribute('aria-pressed', active.has(g.key) ? 'true' : 'false');
      b.classList.toggle('btn-choice-on', active.has(g.key));
      draw();
    });
    b.classList.toggle('btn-choice-on', active.has(g.key));
    picks.appendChild(b);
  }
  const cvdPick = buttonGroup({
    label: '色の見えかたのちがいをためす',
    options: [
      { value: 'none', label: 'そのまま' },
      { value: 'protan', label: 'P型' },
      { value: 'deutan', label: 'D型' },
    ],
    value: 'none', compact: true,
    onChange: (v) => { cvd = v; draw(); },
  });
  const whiteToggle = toggle({
    label: '白の位置を表示', onChange: (v) => { showWhite = v; draw(); },
  });

  w.controls.append(
    el('div', { class: 'ctl' }, [el('span', { class: 'ctl-label', text: '重ねて見る色空間(複数えらべます)' }), picks]),
    cvdPick.root, whiteToggle.root,
  );
  w.onReset(() => {
    active.clear(); active.add('sRGB'); active.add('Rec2020');
    for (let i = 0; i < GAMUT_LIST.length; i++) {
      const b = picks.children[i];
      const on = active.has(GAMUT_LIST[i].key);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.classList.toggle('btn-choice-on', on);
    }
    cvdPick.set('none', true); cvd = 'none';
    whiteToggle.set(false, true); showWhite = false;
    probe = null;
    draw();
  });

  const locus = spectralLocus();

  // 表示する範囲。
  // ふつうは馬蹄形がちょうど収まる範囲にします。
  // ACES2065-1 (AP0) は原色が馬蹄形の外にあり、緑は y=1.0、青は y が負なので、
  // その三角形を選んだときだけ範囲を広げます。そうしないと頂点が画面の外に出て、
  // 「馬蹄形からはみ出している」ことが見えません。
  const VIEW_NORMAL = { x0: 0, x1: 0.8, y0: 0, y1: 0.9 };
  const VIEW_WIDE = { x0: -0.08, x1: 0.82, y0: -0.14, y1: 1.06 };
  let view = VIEW_NORMAL;

  function syncView() {
    view = active.has('AP0') ? VIEW_WIDE : VIEW_NORMAL;
  }

  const gx = (x) => PAD + ((x - view.x0) / (view.x1 - view.x0)) * (SIZE - PAD - 14);
  const gy = (y) => SIZE - PAD - ((y - view.y0) / (view.y1 - view.y0)) * (SIZE - PAD - 18);

  // 馬蹄形の内側かどうかは、一度塗りつぶして作ったマスクを見て決めます。
  // 画素ごとに多角形の判定をすると遅すぎるためです。
  // 表示範囲ごとに1枚作って、使いまわします。
  const maskCache = new Map();

  function getMask() {
    const key = `${view.x0},${view.x1},${view.y0},${view.y1}`;
    if (maskCache.has(key)) return maskCache.get(key);
    const c = document.createElement('canvas');
    c.width = SIZE; c.height = SIZE;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.beginPath();
    locus.forEach((p2, i) => (i ? g.lineTo(gx(p2[0]), gy(p2[1])) : g.moveTo(gx(p2[0]), gy(p2[1]))));
    g.closePath();
    g.fill();
    const d = g.getImageData(0, 0, SIZE, SIZE).data;
    const m = new Uint8Array(SIZE * SIZE);
    for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 128 ? 1 : 0;
    maskCache.set(key, m);
    return m;
  }

  /** 目もりを打つ位置。0.2 きざみで、いまの範囲に入るものだけ。 */
  function ticks(lo, hi) {
    const out = [];
    for (let t = Math.ceil(lo / 0.2 - 1e-9) * 0.2; t <= hi + 1e-9; t += 0.2) {
      out.push(Math.round(t * 100) / 100);
    }
    return out;
  }

  const xyzToSRGB = xyzToGamut('sRGB');

  function draw() {
    syncView();
    const mask = getMask();
    const ctx = canvas.getContext('2d');
    const im = ctx.createImageData(SIZE, SIZE);
    for (let py = 0; py < SIZE; py++) {
      for (let pxi = 0; pxi < SIZE; pxi++) {
        const i = (py * SIZE + pxi) * 4;
        const x = view.x0 + (pxi - PAD) / (SIZE - PAD - 14) * (view.x1 - view.x0);
        const y = view.y0 + (SIZE - PAD - py) / (SIZE - PAD - 18) * (view.y1 - view.y0);
        if (y <= 1e-4 || mask[py * SIZE + pxi] !== 1) { im.data[i + 3] = 0; continue; }
        // その色度を、明るさをそろえて sRGB にします。
        const Y = 1, X = (x / y) * Y, Z = ((1 - x - y) / y) * Y;
        let rgb = matApply(xyzToSRGB, [X, Y, Z]);
        const mx = Math.max(rgb[0], rgb[1], rgb[2]);
        rgb = rgb.map((v) => v / (mx || 1));
        const outOfGamut = rgb.some((v) => v < -0.001);
        rgb = rgb.map((v) => Math.max(0, v));
        rgb = simulateCVD(rgb, cvd);
        // sRGB で出せない色は、出せないことが分かるように少し暗くします。
        const dim = outOfGamut ? 0.62 : 1;
        im.data[i] = TRANSFERS.srgb.encode(Math.max(0, rgb[0]) * dim) * 255;
        im.data[i + 1] = TRANSFERS.srgb.encode(Math.max(0, rgb[1]) * dim) * 255;
        im.data[i + 2] = TRANSFERS.srgb.encode(Math.max(0, rgb[2]) * dim) * 255;
        im.data[i + 3] = 255;
      }
    }
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.putImageData(im, 0, 0);

    const style = getComputedStyle(document.body);
    const ink = style.getPropertyValue('--ink').trim() || '#222';
    const faint = style.getPropertyValue('--ink-faint').trim() || '#888';

    // 目もり
    ctx.strokeStyle = faint;
    ctx.fillStyle = faint;
    ctx.lineWidth = 1;
    ctx.font = '11px system-ui, sans-serif';
    ctx.beginPath();
    ctx.moveTo(gx(view.x0), gy(0)); ctx.lineTo(gx(view.x1), gy(0));
    ctx.moveTo(gx(0), gy(view.y0)); ctx.lineTo(gx(0), gy(view.y1));
    ctx.stroke();
    for (const t of ticks(view.x0, view.x1)) {
      ctx.textAlign = 'center';
      ctx.fillText(t.toFixed(1), gx(t), gy(0) + 15);
    }
    for (const t of ticks(view.y0, view.y1)) {
      if (Math.abs(t) < 1e-9) continue;   // 原点は x 側と重なるので出しません
      ctx.textAlign = 'right';
      ctx.fillText(t.toFixed(1), gx(0) - 6, gy(t) + 4);
    }
    ctx.textAlign = 'center';
    ctx.fillText('x', gx(view.x1) + 8, gy(0) + 15);
    ctx.fillText('y', gx(0) - 22, gy(view.y1) - 4);

    // 馬蹄形のふち
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    locus.forEach((p, i) => (i ? ctx.lineTo(gx(p[0]), gy(p[1])) : ctx.moveTo(gx(p[0]), gy(p[1]))));
    ctx.closePath();
    ctx.stroke();

    // 色空間の三角形
    for (const g of GAMUT_LIST) {
      if (!active.has(g.key)) continue;
      const G = GAMUTS[g.key];
      const p = [G.primaries.red, G.primaries.green, G.primaries.blue];
      ctx.setLineDash(g.dash);
      ctx.strokeStyle = g.color;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      p.forEach((q, i) => (i ? ctx.lineTo(gx(q[0]), gy(q[1])) : ctx.moveTo(gx(q[0]), gy(q[1]))));
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      // ラベルは緑の頂点のそば
      ctx.fillStyle = g.color;
      ctx.textAlign = 'left';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillText(G.label, gx(p[1][0]) + 5, gy(p[1][1]) - 4);
      if (showWhite) {
        ctx.beginPath();
        ctx.arc(gx(G.white[0]), gy(G.white[1]), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (probe) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(gx(probe[0]), gy(probe[1]), 7, 0, Math.PI * 2);
      ctx.stroke();
    }

    drawTable();
    if (!probe) {
      w.say('図の中をタップすると、その色をどの色空間で出せるかが分かります。');
    }
  }

  function coverage(key, x, y) {
    // その色度が三角形の内側かどうかを、RGB に変換して負の値が出るかで調べます。
    const Y = 1, X = (x / y) * Y, Z = ((1 - x - y) / y) * Y;
    const rgb = matApply(xyzToGamut(key), [X, Y, Z]);
    return rgb.every((v) => v >= -0.0005);
  }

  function drawTable() {
    const rows = GAMUT_LIST.map((g) => {
      const G = GAMUTS[g.key];
      const on = active.has(g.key);
      const p = G.primaries;
      return el('tr', { class: on ? '' : 'row-off' }, [
        el('td', {}, [
          el('span', { class: 'legend-chip', style: `background:${g.color}` }),
          el('span', { text: ' ' + G.label }),
        ]),
        el('td', { text: G.note }),
        el('td', { class: 'num', text: `${p.red[0]}, ${p.red[1]}` }),
        el('td', { class: 'num', text: `${p.green[0]}, ${p.green[1]}` }),
        el('td', { class: 'num', text: `${p.blue[0]}, ${p.blue[1]}` }),
      ]);
    });
    table.replaceChildren(el('table', {}, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: '色空間' }), el('th', { text: '使いみち' }),
        el('th', { class: 'num', text: '赤 (x, y)' }),
        el('th', { class: 'num', text: '緑 (x, y)' }),
        el('th', { class: 'num', text: '青 (x, y)' }),
      ])]),
      el('tbody', {}, rows),
    ]));
  }

  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width * SIZE;
    const py = (e.clientY - r.top) / r.height * SIZE;
    const x = view.x0 + (px - PAD) / (SIZE - PAD - 14) * (view.x1 - view.x0);
    const y = view.y0 + (SIZE - PAD - py) / (SIZE - PAD - 18) * (view.y1 - view.y0);
    const m = getMask();
    const ix = Math.round(px), iy = Math.round(py);
    const inside = ix >= 0 && iy >= 0 && ix < SIZE && iy < SIZE && m[iy * SIZE + ix] === 1;
    if (y <= 1e-4 || !inside) {
      probe = null;
      draw();
      w.say('馬蹄形の中をタップしてください。その外側の色は、この世に存在しません。');
      return;
    }
    probe = [x, y];
    draw();
    const results = GAMUT_LIST.map((g) => {
      const ok = coverage(g.key, x, y);
      return `${GAMUTS[g.key].label}: <b>${ok ? '出せる' : '出せない'}</b>`;
    });
    w.say(`色度 (x=${fmtNum(x, 3)}, y=${fmtNum(y, 3)}) — ${results.join(' / ')}`);
  });

  draw();

  w.setDetails(`
    <p>この図は、色から明るさを取りのぞいて「色み」だけを平面にならべたものです。
       馬蹄形のふちは、1つの波長だけでできた光(虹の色)です。下の直線は赤と青をまぜた紫です。</p>
    <p>三角形の3つの頂点が、その色空間の赤・緑・青です。
       混ぜて作れる色は三角形の内側だけなので、三角形が大きいほど濃い色まで出せます。</p>
    <div class="callout callout-warn">
      <p class="note-title">この図の色は本物ではありません</p>
      <p>あなたの画面は sRGB か、それに近い範囲の色しか出せません。
         だから三角形の外側の色は、正確には表示できていません。
         少し暗くしてある部分が「あなたの画面では出せない色」です。位置関係を見るための図だと思ってください。</p>
    </div>
    <p><b>ACES2065-1 (AP0)</b> を選ぶと、図の目もりの範囲が自動で広がります。
       AP0 の緑は y=1.0、青は y がマイナスの位置にあり、ふつうの範囲では画面の外に出てしまうからです。</p>
    <p>そして三角形が馬蹄形からはみ出します。
       人の目に見えない色まで含んでいるということです。
       わざとそうしてあります。将来どんなカメラや画面が出てきても、
       すべてを入れておける入れものにするためです。</p>
  `);
}
