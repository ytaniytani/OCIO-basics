// I-04 色度図と色域ビューア(第2章)
// ねらい: 色空間ごとに「使える色の広さ」がちがうと知る。

import {
  createWidget, el, buttonGroup, toggle, fmtNum,
} from '../core/ui.js';
import { GAMUTS, xyzToGamut, matApply, TRANSFERS } from '../core/color.js';

// ---------------------------------------------------------------------------
// CIE 1931 の等色関数を、なめらかな式で近似します。
// 出典: Wyman, Sloan, Shirley (2013)
//       "Simple Analytic Approximations to the CIE XYZ Color Matching Functions"
// 馬蹄形を描くための近似で、測色の計算には使いません。
// ---------------------------------------------------------------------------

function gauss(x, mu, s1, s2) {
  const s = x < mu ? s1 : s2;
  const t = (x - mu) / s;
  return Math.exp(-0.5 * t * t);
}

function cmf(lambda) {
  const X = 1.056 * gauss(lambda, 599.8, 37.9, 31.0)
    + 0.362 * gauss(lambda, 442.0, 16.0, 26.7)
    - 0.065 * gauss(lambda, 501.1, 20.4, 26.2);
  const Y = 0.821 * gauss(lambda, 568.8, 46.9, 40.5)
    + 0.286 * gauss(lambda, 530.9, 16.3, 31.1);
  const Z = 1.217 * gauss(lambda, 437.0, 11.8, 36.0)
    + 0.681 * gauss(lambda, 459.0, 26.0, 13.8);
  return [X, Y, Z];
}

function spectralLocus() {
  const pts = [];
  for (let l = 400; l <= 700; l += 2) {
    const [X, Y, Z] = cmf(l);
    const s = X + Y + Z;
    if (s > 1e-6) pts.push([X / s, Y / s, l]);
  }
  return pts;
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

  // 図の中の座標変換。x は 0〜0.8、y は 0〜0.9 を表示します。
  const XMAX = 0.8, YMAX = 0.9;
  const gx = (x) => PAD + (x / XMAX) * (SIZE - PAD - 14);
  const gy = (y) => SIZE - PAD - (y / YMAX) * (SIZE - PAD - 18);

  // 馬蹄形の内側かどうかは、一度だけ塗りつぶして作ったマスクを見て決めます。
  // 画素ごとに多角形の判定をすると遅すぎるためです。
  const mask = (() => {
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
    return m;
  })();

  function inLocusPixel(px2, py2) {
    if (px2 < 0 || py2 < 0 || px2 >= SIZE || py2 >= SIZE) return false;
    return mask[py2 * SIZE + px2] === 1;
  }

  const xyzToSRGB = xyzToGamut('sRGB');

  function draw() {
    const ctx = canvas.getContext('2d');
    const im = ctx.createImageData(SIZE, SIZE);
    for (let py = 0; py < SIZE; py++) {
      for (let pxi = 0; pxi < SIZE; pxi++) {
        const i = (py * SIZE + pxi) * 4;
        const x = (pxi - PAD) / (SIZE - PAD - 14) * XMAX;
        const y = (SIZE - PAD - py) / (SIZE - PAD - 18) * YMAX;
        if (y <= 1e-4 || !inLocusPixel(pxi, py)) { im.data[i + 3] = 0; continue; }
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
    ctx.moveTo(gx(0), gy(0)); ctx.lineTo(gx(XMAX), gy(0));
    ctx.moveTo(gx(0), gy(0)); ctx.lineTo(gx(0), gy(YMAX));
    ctx.stroke();
    for (let t = 0; t <= 0.8001; t += 0.2) {
      ctx.textAlign = 'center';
      ctx.fillText(t.toFixed(1), gx(t), gy(0) + 15);
      ctx.textAlign = 'right';
      if (t <= YMAX) ctx.fillText(t.toFixed(1), gx(0) - 6, gy(t) + 4);
    }
    ctx.textAlign = 'center';
    ctx.fillText('x', gx(XMAX) + 8, gy(0) + 15);
    ctx.fillText('y', gx(0) - 22, gy(YMAX) - 4);

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
    const x = (px - PAD) / (SIZE - PAD - 14) * XMAX;
    const y = (SIZE - PAD - py) / (SIZE - PAD - 18) * YMAX;
    if (y <= 1e-4 || !inLocusPixel(Math.round(px), Math.round(py))) {
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
    <p><b>ACES2065-1 (AP0)</b> を表示すると、三角形が馬蹄形からはみ出します。
       人の目に見えない色まで含んでいるということです。
       わざとそうしてあります。将来どんなカメラや画面が出てきても、
       すべてを入れておける入れものにするためです。</p>
  `);
}
