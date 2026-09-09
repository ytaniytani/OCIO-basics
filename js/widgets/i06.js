// I-06 露出スライダー + クリップ体験(第4章)
// ねらい: 8bit で焼いた画像と、シーンリニアのまま持っている画像とで、
//         あとから救えるものがちがうと知る。

import {
  createWidget, imagePane, paneGrid, slider, toggle, el, fmtNum,
} from '../core/ui.js';
import { Renderer } from '../core/render.js';
import { getScene } from '../core/scenes.js';
import {
  TransformChain, ExposureNode, TransferNode, QuantizeNode,
  buildOutputTransform, OUTPUT_PRESETS,
} from '../core/transforms.js';

export default function i06(mount) {
  const w = createWidget(mount, {
    title: '白飛びした空は戻せるか',
    aim: '左は撮ったあとすぐ8bitで焼いた写真。右は光の量のまま持っている写真。露出を下げて比べます。',
    simplified: true,
    wide: true,
  });

  const left = imagePane('8bit で焼いた写真', 'JPEGにした後');
  const right = imagePane('光の量のまま持っている写真', 'シーンリニア');
  w.view.appendChild(paneGrid(2, [left, right]));

  const hist = el('canvas', { class: 'hist-canvas', width: 512, height: 90 });
  const histPane = el('div', { class: 'pane', hidden: true }, [
    el('div', { class: 'pane-label' }, [el('span', { text: 'ヒストグラム(左=暗い、右=明るい)' })]),
    hist,
  ]);
  w.view.appendChild(histPane);

  const image = getScene('window', 560, 315);
  const rL = new Renderer(left.canvas);
  const rR = new Renderer(right.canvas);
  rL.setImage(image);
  rR.setImage(image);

  const output = buildOutputTransform(OUTPUT_PRESETS.sdr100.opts);

  let stops = 0;
  let zebra = false;

  const s = slider({
    label: '露出(段)', min: -6, max: 2, step: 0.25, value: 0,
    format: (v) => (v > 0 ? '+' : '') + v.toFixed(2),
    onChange: (v) => { stops = v; draw(); },
  });
  const zebraToggle = toggle({
    label: '白飛びしているところを赤く出す',
    onChange: (v) => { zebra = v; draw(); },
  });
  const histToggle = toggle({
    label: 'ヒストグラムを見る',
    onChange: (v) => { histPane.hidden = !v; if (v) draw(); },
  });
  w.controls.append(s.root, zebraToggle.root, histToggle.root);
  w.onReset(() => {
    s.set(0, true); stops = 0;
    zebraToggle.set(false, true); zebra = false;
    histToggle.set(false, true); histPane.hidden = true;
    draw();
  });

  // 左: 撮影時の設定で 8bit に焼く → その後で露出をいじる(編集ソフトのやりかた)
  function bakedChain() {
    return new TransformChain([
      output,                                   // 撮影時の設定で画面用の数値にする
      new QuantizeNode(255),                    // 8bit に丸める
      new TransferNode('srgb', 'decode'),       // 編集のために光にもどす
      new ExposureNode(stops),                  // 露出を変える
      new TransferNode('srgb', 'encode'),       // また画面用にする
    ]);
  }

  // 右: 光の量のまま露出を変えて、そのあとで画面用にする
  function linearChain() {
    return new TransformChain([new ExposureNode(stops), output]);
  }

  function draw() {
    const a = bakedChain(), b = linearChain();
    rL.resizeToDisplay(640);
    rR.resizeToDisplay(640);
    rL.draw({ chainA: a, zebra });
    rR.draw({ chainA: b, zebra });
    const tag = (stops === 0 ? '露出そのまま' : `露出 ${stops > 0 ? '+' : ''}${stops.toFixed(2)} 段`);
    left.setTag(tag);
    right.setTag(tag);

    if (!histPane.hidden) drawHistogram(a, b);

    // 窓の外のあたりを測って、情報が残っているかを数字で見せます。
    const probe = image.sample(image.width * 0.72, image.height * 0.30);
    const va = a.applyCPU(probe)[1], vb = b.applyCPU(probe)[1];
    const lightness = probe[1];
    if (stops === 0) {
      w.say(`いまは同じに見えます。窓の外の光の量は <b>${fmtNum(lightness, 0)}</b>、
        室内のおよそ ${fmtNum(lightness / image.sample(image.width * 0.15, image.height * 0.5)[1], 0)} 倍です。
        露出スライダーを左に動かしてみてください。`);
    } else if (stops < 0) {
      const gap = Math.abs(vb - va);
      w.say(`窓の外の同じ場所の数値: 左 <b>${va.toFixed(3)}</b> / 右 <b>${vb.toFixed(3)}</b>。
        ${gap > 0.02
          ? '右では窓の外の景色がもどってきました。左は白いままです。'
          : 'まだ差が出ていません。もう少し下げてみてください。'}
        <b>左の写真では、窓の外の情報は保存した時点で捨てられています。</b>`);
    } else {
      w.say('明るくしても、飛んだところは飛んだままです。上げるより下げるほうが差が出ます。');
    }
  }

  function drawHistogram(a, b) {
    const ctx = hist.getContext('2d');
    const W = hist.width, H = hist.height;
    const bins = 64;
    const ha = new Array(bins).fill(0), hb = new Array(bins).fill(0);
    const step = 7; // 全画素だと重いので間引きます
    let n = 0;
    for (let i = 0; i < image.data.length; i += 3 * step) {
      const c = [image.data[i], image.data[i + 1], image.data[i + 2]];
      const va = a.applyCPU(c)[1], vb = b.applyCPU(c)[1];
      ha[Math.min(bins - 1, Math.max(0, Math.floor(va * bins)))]++;
      hb[Math.min(bins - 1, Math.max(0, Math.floor(vb * bins)))]++;
      n++;
    }
    const max = Math.max(...ha, ...hb) || 1;
    ctx.clearRect(0, 0, W, H);
    const style = getComputedStyle(document.body);
    const ink = style.getPropertyValue('--ink-faint').trim() || '#888';
    const accent = style.getPropertyValue('--accent').trim() || '#c60';
    ctx.fillStyle = ink;
    for (let i = 0; i < bins; i++) {
      const h = ha[i] / max * (H - 6);
      ctx.fillRect(i / bins * W, H - h, W / bins - 1.5, h);
    }
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.65;
    for (let i = 0; i < bins; i++) {
      const h = hb[i] / max * (H - 6);
      ctx.fillRect(i / bins * W + 1, H - h, W / bins - 3.5, h);
    }
    ctx.globalAlpha = 1;
  }

  requestAnimationFrame(draw);
  window.addEventListener('resize', () => requestAnimationFrame(draw));

  w.setDetails(`
    <p>この画像の室内の壁は、光の量で 0.05〜0.16。窓の外の空は 13〜19 あります。
       いちばん暗いところ(0.025)からいちばん明るい太陽の芯(290)までは、
       約1万倍、およそ13段の開きです。</p>
    <p>人の目は同時にこの両方を見られますが、8bit の画像は 0〜255 の 256 段階しか持てません。</p>
    <p>左の写真は、撮ったあとすぐに「見える範囲だけ」を切り取って 256 段階に丸めました。
       切り取られた外側は、もうどこにも残っていません。だから戻せません。</p>
    <p>右の写真は光の量をそのまま持っています。窓の外の値は 1.0 をはるかに超えていますが、
       ちゃんと記録されています。露出を下げれば見えるようになります。</p>
    <div class="callout callout-good">
      <p class="note-title">第10章への伏線</p>
      <p>右にまだ残っているこの明るさが、あとで HDR の映像を作るときに使われます。
         左の写真からは HDR は作れません。</p>
    </div>
  `);
}
