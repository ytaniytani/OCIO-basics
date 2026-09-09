// hero-demo — トップページの導入。
// 「同じデータなのに、道具によって色が変わる」を最初に見せます。

import { createWidget, imagePane, paneGrid, toggle } from '../core/ui.js';
import { Renderer } from '../core/render.js';
import { getScene } from '../core/scenes.js';
import {
  TransformChain, TransferNode, ClampNode, gamutNode, buildOutputTransform,
  OUTPUT_PRESETS,
} from '../core/transforms.js';

export default function heroDemo(mount) {
  const w = createWidget(mount, {
    title: '同じデータ、ちがう見え方',
    aim: 'まったく同じ画像データを、3つの道具で開いたところ。色の管理をしないと、こうなります。',
    simplified: true,
    wide: true,
  });

  const panes = [
    imagePane('道具A', '正しく変換'),
    imagePane('道具B', 'そのまま表示'),
    imagePane('道具C', '別の約束で表示'),
  ];
  w.view.appendChild(paneGrid(3, panes));

  const image = getScene('sunset', 480, 270);
  const renderers = panes.map((p) => new Renderer(p.canvas));
  renderers.forEach((r) => r.setImage(image));

  // 正解: 出力変換を通す
  const correct = new TransformChain([buildOutputTransform(OUTPUT_PRESETS.sdr100.opts)]);
  // まちがい1: 変換せず、そのまま画面に出す(明るい所が全部白くなる)
  const raw = new TransformChain([gamutNode('AP1', 'sRGB'), new ClampNode(0, 1)]);
  // まちがい2: 別の伝達関数の約束で表示してしまう
  const wrongTag = new TransformChain([
    gamutNode('AP1', 'sRGB'), new ClampNode(0, 1), new TransferNode('gamma22', 'encode'),
  ]);

  let managed = false;

  const managedToggle = toggle({
    label: '色の管理をする(OCIO を使う)',
    value: false,
    onChange: (v) => { managed = v; draw(); },
  });
  w.controls.appendChild(managedToggle.root);
  w.onReset(() => managedToggle.set(false));

  function draw() {
    const chains = managed ? [correct, correct, correct] : [correct, raw, wrongTag];
    renderers.forEach((r, i) => {
      r.resizeToDisplay(560);
      r.draw({ chainA: chains[i] });
    });
    panes[0].setTag('正しく変換');
    panes[1].setTag(managed ? '正しく変換' : 'そのまま表示');
    panes[2].setTag(managed ? '正しく変換' : '別の約束で表示');
    w.say(managed
      ? '3つとも同じ見え方になりました。<b>データは1つも変えていません。</b>変えたのは「どう解釈して画面に出すか」だけです。'
      : '同じデータなのにバラバラです。<b>どれが正解か、これでは決められません。</b>スイッチを入れてみてください。');
  }

  requestAnimationFrame(draw);
  window.addEventListener('resize', () => requestAnimationFrame(draw));

  w.setDetails(`
    <p>3つとも読みこんだ数値は完全に同じです。ちがうのは「その数値をどういう色として画面に出すか」の約束だけです。</p>
    <ul>
      <li><b>道具A</b>: 光の量として受け取り、画面用に正しく変換しています。</li>
      <li><b>道具B</b>: 変換せずそのまま出しています。1.0 を超える明るさが全部白でつぶれます。</li>
      <li><b>道具C</b>: 別の曲げ方(ガンマ2.2)の約束で出しています。全体が白っぽくなります。</li>
    </ul>
    <p>この「約束のちがい」をチーム全体でそろえる道具が OCIO です。第6章でくわしく見ます。</p>
  `);
}
