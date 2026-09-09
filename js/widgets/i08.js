// I-08 素材ばらばら事故シミュレータ(第6章)
// ねらい: 素材ごとに色空間がちがうと、作品として成立しないと知る。

import {
  createWidget, imagePane, paneGrid, toggle, buttonGroup, select, el,
} from '../core/ui.js';
import { Renderer } from '../core/render.js';
import { getScene } from '../core/scenes.js';
import {
  TransformChain, TransferNode, ClampNode, gamutNode, ExposureNode,
  buildOutputTransform, OUTPUT_PRESETS,
} from '../core/transforms.js';

// 4つの素材。どれも「もとは何の色空間だったか」がちがいます。
const CLIPS = [
  {
    id: 'phone',
    label: 'スマホの動画',
    scene: 'sunset',
    realSpace: 'srgb_video',
    note: '画面用に仕上がっている素材',
  },
  {
    id: 'log',
    label: '一眼のログ映像',
    scene: 'chart',
    realSpace: 'log',
    note: '眠い灰色に見える。広い明るさを詰めこんである',
  },
  {
    id: 'cg',
    label: '外注の3DCG',
    scene: 'cgball',
    realSpace: 'linear',
    note: '光の量そのまま',
  },
  {
    id: 'stock',
    label: '出典不明のフリー素材',
    scene: 'skin',
    realSpace: 'p3_video',
    note: 'ラベルが書いていない',
  },
];

// 「この素材はこの色空間だ」と決めるときの選択肢(入力変換)。
const INPUT_SPACES = {
  linear: { label: 'リニア(光の量)', build: () => [] },
  srgb_video: {
    label: 'sRGB の映像',
    build: () => [new TransferNode('srgb', 'decode'), gamutNode('sRGB', 'AP1')],
  },
  p3_video: {
    label: 'Display P3 の映像',
    build: () => [new TransferNode('srgb', 'decode'), gamutNode('P3D65', 'AP1')],
  },
  log: {
    label: 'Log の映像',
    build: () => [new TransferNode('demolog', 'decode'), gamutNode('Rec2020', 'AP1')],
  },
};

// 素材を「そのソフトのファイル」にするための、撮影時の書き出し。
function bakeChain(realSpace) {
  const out = buildOutputTransform(OUTPUT_PRESETS.sdr100.opts);
  switch (realSpace) {
    case 'linear':
      // CG はリニアのまま渡されます(書き出しをしていない)。
      return [];
    case 'log':
      return [new TransferNode('demolog', 'encode'), gamutNode('AP1', 'Rec2020')];
    case 'p3_video':
      return [out, new TransferNode('srgb', 'decode'), gamutNode('sRGB', 'P3D65'),
        new TransferNode('srgb', 'encode')];
    case 'srgb_video':
    default:
      return [out];
  }
}

export default function i08(mount) {
  const w = createWidget(mount, {
    title: '4つの素材を1つの作品にまとめる',
    aim: '4つの素材をそのまま並べると、明るさも色もバラバラです。スイッチを入れると、そろいます。',
    simplified: true,
    wide: true,
  });

  const panes = CLIPS.map((c) => imagePane(c.label, ''));
  w.view.appendChild(paneGrid(2, panes));
  const timeline = el('div', { class: 'timeline' });
  w.view.appendChild(el('div', { class: 'pane' }, [
    el('div', { class: 'pane-label' }, [el('span', { text: 'つないだ結果' })]),
    timeline,
  ]));

  const renderers = panes.map((p, i) => {
    const r = new Renderer(p.canvas);
    r.setImage(getScene(CLIPS[i].scene, 400, 225));
    return r;
  });
  const stripCanvases = CLIPS.map(() => el('canvas', { class: 'strip-canvas' }));
  timeline.replaceChildren(...stripCanvases);
  const stripRenderers = stripCanvases.map((c, i) => {
    const r = new Renderer(c);
    r.setImage(getScene(CLIPS[i].scene, 200, 112));
    return r;
  });

  let managed = false;
  let advanced = false;
  let software = 'A';
  const chosen = {};
  for (const c of CLIPS) chosen[c.id] = c.realSpace;

  const managedToggle = toggle({
    label: '色の管理をする(OCIO を使う)',
    value: false,
    onChange: (v) => { managed = v; draw(); },
  });
  const softwarePick = buttonGroup({
    label: '編集ソフト',
    options: [
      { value: 'A', label: '編集ソフトA' },
      { value: 'B', label: '編集ソフトB' },
    ],
    value: 'A', compact: true,
    onChange: (v) => { software = v; draw(); },
  });
  const advancedToggle = toggle({
    label: '入力変換を自分で決める(上級)',
    onChange: (v) => { advanced = v; advBox.hidden = !v; draw(); },
  });

  const advBox = el('div', { class: 'adv-box', hidden: true });
  for (const c of CLIPS) {
    const s = select({
      label: c.label,
      options: Object.entries(INPUT_SPACES).map(([k, v]) => ({ value: k, label: v.label })),
      value: c.realSpace,
      onChange: (v) => { chosen[c.id] = v; draw(); },
    });
    advBox.appendChild(s.root);
    c._select = s;
  }

  w.controls.append(managedToggle.root, softwarePick.root, advancedToggle.root, advBox);
  w.onReset(() => {
    managedToggle.set(false, true); managed = false;
    softwarePick.set('A', true); software = 'A';
    advancedToggle.set(false, true); advanced = false; advBox.hidden = true;
    for (const c of CLIPS) { chosen[c.id] = c.realSpace; c._select.set(c.realSpace, true); }
    draw();
  });

  const output = buildOutputTransform(OUTPUT_PRESETS.sdr100.opts);

  function chainFor(clip) {
    const nodes = [...bakeChain(clip.realSpace)];
    if (managed) {
      // 入力変換で共通の作業空間にそろえてから、出力変換で画面用にします。
      const space = advanced ? chosen[clip.id] : clip.realSpace;
      nodes.push(...INPUT_SPACES[space].build());
      nodes.push(output);
    } else {
      // 何もせず、そのまま画面に流します。
      // 編集ソフトによって思いこみがちがうので、見え方もちがいます。
      if (software === 'B') {
        nodes.push(new TransferNode('srgb', 'decode'));
        nodes.push(new ExposureNode(0.6));
        nodes.push(new TransferNode('rec709', 'encode'));
      }
      nodes.push(new ClampNode(0, 1));
    }
    return new TransformChain(nodes);
  }

  const PROBLEMS = {
    phone: 'そのままでも見られますが、他とそろっていません。',
    log: '灰色に眠いままです。まだ画面用に仕上げていません。',
    cg: '真っ白につぶれています。光の量をそのまま画面に流しているためです。',
    stock: 'ラベルが分からないので、色が正しいのか判断できません。',
  };

  function draw() {
    CLIPS.forEach((c, i) => {
      const chain = chainFor(c);
      renderers[i].resizeToDisplay(420);
      renderers[i].draw({ chainA: chain });
      stripRenderers[i].resizeToDisplay(240);
      stripRenderers[i].draw({ chainA: chain });
      panes[i].setTag(managed ? `${INPUT_SPACES[advanced ? chosen[c.id] : c.realSpace].label} として読みこみ` : c.note);
    });

    if (managed) {
      const wrong = CLIPS.filter((c) => advanced && chosen[c.id] !== c.realSpace);
      if (wrong.length) {
        w.say(`${wrong.map((c) => c.label).join('、')} の入力変換がまちがっています。
          <b>その素材だけ</b>色がずれます。どこが原因かを特定できるのが、この仕組みの利点です。`);
      } else {
        w.say(`4つとも同じ作業空間にそろいました。<b>編集ソフトを切りかえても見え方が変わりません。</b>
          素材のデータは1つも書きかえていません。変えたのは「どう読みこむか」の指定だけです。`);
      }
    } else {
      w.say(`バラバラです。${Object.entries(PROBLEMS).map(([k, v]) => {
        const c = CLIPS.find((x) => x.id === k);
        return `<b>${c.label}</b>: ${v}`;
      }).join(' ')} 編集ソフトを切りかえると、さらに見え方が変わります。`);
    }
  }

  requestAnimationFrame(draw);
  window.addEventListener('resize', () => requestAnimationFrame(draw));

  w.setDetails(`
    <p>スイッチを入れると、素材ごとにちがう<b>入力変換</b>がかかります。
       スマホの映像には sRGB の変換、ログ映像には Log の変換、CG には何もしない、という具合です。</p>
    <p>そろえたあとは、全部が同じ作業空間の中にいます。ここで合成や色の調整をして、
       最後にまとめて<b>出力変換</b>で画面用にします。</p>
    <p>「編集ソフトA / B」の切りかえも試してください。
       色の管理をしていないと、ソフトごとに見え方が変わります。
       これでは「どれが正解か」を決められません。
       同じ config.ocio を全部のソフトに読ませれば、答えが1つにそろいます。</p>
    <p>上級モードでは、入力変換をわざとまちがえられます。
       まちがえた素材だけが壊れるので、原因を特定できます。
       これも、素材ごとに指定を分けているおかげです。</p>
  `);
}
