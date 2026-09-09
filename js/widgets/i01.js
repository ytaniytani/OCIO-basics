// I-01 光の量スライダー(第1章)
// ねらい: 光の量という物理量と、画面に出る数値は別物だと知る。

import { createWidget, imagePane, slider, button, row, fmtNum, fmt8bit } from '../core/ui.js';
import { Renderer } from '../core/render.js';
import { getScene } from '../core/scenes.js';
import {
  TransformChain, ExposureNode, buildOutputTransform, OUTPUT_PRESETS,
} from '../core/transforms.js';

// 球のいちばん明るいあたりを測ります。
const PROBE = { u: 0.44, v: 0.42 };

export default function i01(mount) {
  const w = createWidget(mount, {
    title: '光を強くしてみる',
    aim: '光の量を2倍にすると、画面に出る数値も2倍になるでしょうか。確かめてみます。',
    simplified: true,
  });

  const pane = imagePane('CGの球', '光の量 ×1.0');
  w.view.appendChild(pane.root);

  const meters = document.createElement('div');
  meters.className = 'meters';
  w.view.appendChild(meters);

  const image = getScene('cgball', 480, 270);
  const renderer = new Renderer(pane.canvas);
  renderer.setImage(image);
  const output = buildOutputTransform(OUTPUT_PRESETS.sdr100.opts);

  let stops = 0;

  const s = slider({
    label: '光の量(段。1段で2倍)',
    min: -4, max: 4, step: 0.25, value: 0,
    format: (v) => v.toFixed(2),
    onChange: (v) => { stops = v; draw(); },
  });

  const half = button('÷2', () => s.set(stops - 1));
  const dbl = button('×2', () => s.set(stops + 1));
  w.controls.appendChild(s.root);
  w.controls.appendChild(row([half, dbl]));
  w.onReset(() => s.set(0));

  function draw() {
    const chain = new TransformChain([new ExposureNode(stops), output]);
    renderer.resizeToDisplay(720);
    renderer.draw({ chainA: chain });

    const gain = Math.pow(2, stops);
    const src = image.sample(PROBE.u * image.width, PROBE.v * image.height);
    const light = src[1] * gain;             // 緑を代表値にします
    const outv = chain.applyCPU(src)[1];
    pane.setTag(`光の量 ×${fmtNum(gain, 2)}`);

    meters.innerHTML = `
      <div class="meter"><span class="mk">光の量</span>
        <span class="mb"><i style="width:${Math.min(100, light / 3 * 100)}%"></i></span>
        <span class="mv">${fmtNum(light, 3)}</span></div>
      <div class="meter"><span class="mk">保存する数値</span>
        <span class="mb"><i style="width:${outv * 100}%"></i></span>
        <span class="mv">${outv.toFixed(3)}</span></div>
      <div class="meter"><span class="mk">8bit の値</span>
        <span class="mb"><i style="width:${outv * 100}%"></i></span>
        <span class="mv">${fmt8bit(outv)}</span></div>`;

    const ratio = gain;
    w.say(stops === 0
      ? '基準の明るさです。<b>×2</b> を押して、3つの数字がどう動くか見てください。'
      : `光の量は基準の <b>${fmtNum(ratio, 2)} 倍</b>です。
         でも 8bit の値は <b>${fmt8bit(outv)}</b>。倍にはなっていません。
         なぜそうなるのかは第3章で調べます。`);
  }

  requestAnimationFrame(draw);
  window.addEventListener('resize', () => requestAnimationFrame(draw));

  w.setDetails(`
    <p>「光の量」は現場にあった明るさそのものです。ライトを2つに増やせば、値も2倍になります。
       こういう数値の持ちかたを <b>シーンリニア</b> と呼びます。</p>
    <p>いっぽう画面に出す数値は 0 から 1 の間に押しこまれていて、
       光の量とは比例していません。この差が、このサイト全体でいちばん大事な話です。</p>
  `);
}
