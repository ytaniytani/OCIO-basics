// I-14 チェックテスト(第11章)
// 10問。まちがえた問題には、どの章にもどればいいかを出します。

import { createWidget, el, button } from '../core/ui.js';
import { Renderer } from '../core/render.js';
import { getScene } from '../core/scenes.js';
import {
  TransformChain, TransferNode, ClampNode, gamutNode,
  buildOutputTransform, OUTPUT_PRESETS,
} from '../core/transforms.js';
import { saveQuiz, loadQuiz } from '../core/progress.js';

const QUESTIONS = [
  {
    q: '色の管理をしないと困ることとして、正しくないものはどれ?',
    choices: [
      'ソフトを移るたびに色が変わり、どれが正解か分からなくなる',
      'CG と実写を合成しても馴染まない',
      'SDR で仕上げた作品を HDR にするには、作業をやり直すことになる',
      'ファイルのサイズが大きくなって、保存できなくなる',
    ],
    answer: 3,
    why: 'ファイルの大きさは色の管理とは関係ありません。ほかの3つはどれも実際に起きます。',
    chapter: 'ch06.html', chapterLabel: '第6章',
  },
  {
    q: '8bit の画像で「128」という数値は、光の量にするとどれくらい?',
    choices: ['約 50%', '約 21%', '約 73%', '約 12%'],
    answer: 1,
    why: '数値のまん中は、光の量では5分の1くらいしかありません。暗い側に段階を多く配ってあるからです。',
    chapter: 'ch03.html', chapterLabel: '第3章',
  },
  {
    q: 'ぼかしや縮小を、画面用の数値のままやるとどうなる?',
    choices: [
      '結果が暗くなる',
      '結果が明るくなる',
      '何も変わらない',
      '色がにじんで見えなくなる',
    ],
    answer: 0,
    why: 'ぼかしと縮小は「平均」です。曲がった数値のまま平均すると、結果が暗くなります。逆に足し算だと明るくなりすぎます。',
    chapter: 'ch05.html', chapterLabel: '第5章',
  },
  {
    q: 'カラーグレーディング(味付け)は、どこに入れるのが正しい?',
    choices: [
      '入力変換の前',
      '作業空間の中(出力変換の前)',
      '出力変換の後',
      'どこでも同じ',
    ],
    answer: 1,
    why: '作業空間の中に入れると、素材を替えても出力先を替えても味付けが保たれます。出力変換の後に入れると、出力先ごとにやり直しになります。',
    chapter: 'ch09.html', chapterLabel: '第9章',
  },
  {
    q: 'ACES で作ると、HDR 版と SDR 版の両方が出せるのはなぜ?',
    choices: [
      'ACES のファイルが2つの形式で保存されるから',
      '出力変換だけを差しかえればよく、手前の作業は変わらないから',
      'HDR のテレビが自動で変換してくれるから',
      'ACES が両方の色空間を同時に持っているから',
    ],
    answer: 1,
    why: '入力変換から味付けまでは共通で、最後の出力変換だけを差しかえます。だから作り直しになりません。',
    chapter: 'ch10.html', chapterLabel: '第10章',
  },
  {
    q: '「色空間」を決めている3つの約束はどれ?',
    choices: [
      '原色・白色点・伝達関数',
      '解像度・フレームレート・ビット深度',
      '明るさ・コントラスト・彩度',
      'RGB・CMYK・HSV',
    ],
    answer: 0,
    why: 'もとになる赤緑青をどこに置くか(原色)、白をどの色にするか(白色点)、数値と明るさの関係をどう曲げるか(伝達関数)の3つです。',
    chapter: 'ch02.html', chapterLabel: '第2章',
  },
  {
    q: '白飛びした空が、あとから戻せないのはなぜ?',
    choices: [
      'ファイルが壊れているから',
      '記録できる上限を超えた値が、すべて同じ値に押しつぶされているから',
      '明るすぎて計算ができないから',
      'カメラが自動で消しているから',
    ],
    answer: 1,
    why: '1000 も 5000 も 20000 も、全部おなじ「255」になります。もとが何だったかはどこにも残っていません。',
    chapter: 'ch04.html', chapterLabel: '第4章',
  },
  {
    q: 'config.ocio の roles(ロール)は、何をするもの?',
    choices: [
      '色空間に色をつける',
      '「作業用はこれ」のように、役割の名前で色空間を指しておくもの',
      'ファイルの保存場所を決める',
      '画面の明るさを設定する',
    ],
    answer: 1,
    why: 'ソフトは色空間の名前を直接知らなくても、scene_linear のような役割の名前で探せます。ここがずれていると計算が全部狂います。',
    chapter: 'ch07.html', chapterLabel: '第7章',
  },
];

// 画像で判断する問題。実際に壊れた変換で描いて見せます。
const IMAGE_QUESTIONS = [
  {
    q: 'この画像に何が起きている?',
    scene: 'chart',
    build: () => new TransformChain([
      buildOutputTransform(OUTPUT_PRESETS.sdr100.opts),
      new TransferNode('rec709', 'decode'),
      gamutNode('Rec2020', 'sRGB'),
      new ClampNode(0, 1),
      new TransferNode('srgb', 'encode'),
    ]),
    choices: [
      '色空間のラベルをまちがえて読みこんでいる',
      'リニアのまま画面に出している',
      '露出が上がりすぎている',
      '正常',
    ],
    answer: 0,
    why: 'もっと広い色空間だと思って開いたので、色がうすくなっています。数値は正しいのに、解釈がまちがっています。',
    chapter: 'ch02.html', chapterLabel: '第2章',
  },
  {
    q: 'この画像に何が起きている?',
    scene: 'cgball',
    build: () => new TransformChain([
      gamutNode('AP1', 'sRGB'),
      new ClampNode(0, 1),
    ]),
    choices: [
      '色空間のラベルをまちがえて読みこんでいる',
      '光の量のまま、変換せずに画面に出している',
      '彩度を上げすぎている',
      '正常',
    ],
    answer: 1,
    why: '出力変換を通していないので、1.0 を超える明るさが全部白でつぶれ、暗い部分は沈んでいます。',
    chapter: 'ch06.html', chapterLabel: '第6章',
  },
];

const ALL = [...QUESTIONS.slice(0, 4), IMAGE_QUESTIONS[0], ...QUESTIONS.slice(4, 7), IMAGE_QUESTIONS[1], QUESTIONS[7]];

export default function i14(mount) {
  const w = createWidget(mount, {
    title: 'チェックテスト(全10問)',
    aim: '答え合わせはその場でします。まちがえた問題には、もどるべき章のリンクが出ます。',
  });

  const box = el('div', { class: 'quiz quiz-list' });
  w.view.appendChild(box);
  const answers = new Array(ALL.length).fill(null);
  const renderers = [];

  function render() {
    box.replaceChildren();
    ALL.forEach((q, i) => {
      const card = el('div', { class: 'quiz-card' });
      card.appendChild(el('p', { class: 'quiz-q', text: `問${i + 1}. ${q.q}` }));

      if (q.scene) {
        const canvas = el('canvas', { class: 'quiz-canvas' });
        card.appendChild(canvas);
        requestAnimationFrame(() => {
          const r = new Renderer(canvas);
          r.setImage(getScene(q.scene, 360, q.scene === 'chart' ? 240 : 203));
          r.resizeToDisplay(480);
          r.draw({ chainA: q.build() });
          renderers.push(r);
        });
      }

      const choices = el('div', { class: 'quiz-choices vertical' });
      q.choices.forEach((c, j) => {
        const b = button(c, () => {
          if (answers[i] !== null) return;
          answers[i] = j;
          render();
        }, 'btn-choice-q');
        if (answers[i] !== null) {
          b.disabled = true;
          if (j === q.answer) b.classList.add('is-right');
          else if (j === answers[i]) b.classList.add('is-wrong');
        }
        choices.appendChild(b);
      });
      card.appendChild(choices);

      if (answers[i] !== null) {
        const right = answers[i] === q.answer;
        card.appendChild(el('p', { class: 'quiz-why' }, [
          el('b', { text: right ? '正解。' : 'ざんねん。' }),
          el('span', { text: ' ' + q.why + ' ' }),
          el('a', { href: q.chapter, text: `${q.chapterLabel}を見なおす` }),
        ]));
      }
      box.appendChild(card);
    });
    updateScore();
  }

  const scoreBox = el('div', { class: 'quiz-score' });
  w.controls.appendChild(scoreBox);

  function updateScore() {
    const done = answers.filter((a) => a !== null).length;
    const right = answers.filter((a, i) => a === ALL[i].answer).length;
    if (done < ALL.length) {
      scoreBox.textContent = `${done} / ${ALL.length} 問おわり(正解 ${right} 問)`;
      w.say(`残り ${ALL.length - done} 問です。`);
      return;
    }
    scoreBox.textContent = `おつかれさま。${ALL.length} 問中 ${right} 問正解です。`;
    saveQuiz({ right, total: ALL.length });
    const wrong = ALL.filter((q, i) => answers[i] !== q.answer);
    if (!wrong.length) {
      w.say('<b>全問正解です。</b>もう「なぜ色を管理するのか」を自分の言葉で説明できます。');
    } else {
      const chapters = [...new Set(wrong.map((q) => q.chapterLabel))];
      w.say(`まちがえたのは ${wrong.length} 問です。
        <b>${chapters.join('、')}</b> をもう一度見てみてください。`);
    }
  }

  const prev = loadQuiz();
  if (prev) {
    w.controls.appendChild(el('p', {
      class: 'quiz-prev',
      text: `前回の結果: ${prev.total} 問中 ${prev.right} 問正解`,
    }));
  }

  w.controls.appendChild(el('div', { class: 'ctl-group' }, [
    button('もう一度はじめから', () => { answers.fill(null); render(); }),
  ]));
  w.onReset(() => { answers.fill(null); render(); });

  render();

  w.setDetails(`
    <p>結果はこの端末の中だけに保存されます。どこにも送りません。
       消したいときは、ブラウザの設定でこのサイトのデータを消してください。</p>
  `);
}
