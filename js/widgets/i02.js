// I-02 二倍の光クイズ(第3章)
// ねらい: 表示用の数値が曲げられていることを、当てて外して覚える。

import { createWidget, el, button } from '../core/ui.js';
import { TRANSFERS, to8bit } from '../core/color.js';

const QUESTIONS = [
  {
    q: '白い紙にあてる光を、ちょうど半分にしました。写真の数値(8bit)はいくつになるでしょう。',
    hint: '8bit は真っ黒 0 から真っ白 255 までの 256段階。もとの数値は 255(真っ白)です。',
    choices: [
      { v: '128', ok: false, why: 'ちょうど半分の数字ですが、実際はもっと大きな値になります。' },
      { v: '188', ok: true, why: 'これが正解です。半分の光でも、数値は 74% までしか下がりません。' },
      { v: '220', ok: false, why: '下がりかたが小さすぎます。' },
      { v: '64', ok: false, why: '4分の1にあたる数字です。下がりすぎです。' },
    ],
    after: '光は半分(50%)。でも数値は 188 で、もとの 74% です。',
  },
  {
    q: 'では逆に、8bit の数値が 128(255段階のちょうどまん中)のとき、光の量はもとの何%でしょう。',
    hint: '段階のまん中 = 光のまん中、でしょうか。',
    choices: [
      { v: '50%', ok: false, why: '多くの人がこう答えます。でも実際はもっとずっと暗い光です。' },
      { v: '35%', ok: false, why: 'まだ明るすぎます。' },
      { v: '21%', ok: true, why: 'これが正解です。段階のまん中は、光の量では5分の1くらいしかありません。' },
      { v: '75%', ok: false, why: '逆に明るくなっています。' },
    ],
    after: '8bit の 128 は、光の量にすると 21.6% です。',
  },
];

export default function i02(mount) {
  const w = createWidget(mount, {
    title: '光を半分にすると、数値はいくつ?',
    aim: '答えを予想してから確かめます。まちがえても大丈夫です。多くの人が同じところでつまずきます。ここでいう 8bit とは、真っ黒 0 から真っ白 255 までの 256段階のことです。',
  });

  const box = el('div', { class: 'quiz' });
  w.view.appendChild(box);

  let index = 0;
  let answered = false;

  function render() {
    const q = QUESTIONS[index];
    box.replaceChildren(
      el('p', { class: 'quiz-q', text: q.q }),
      el('p', { class: 'quiz-hint', text: q.hint }),
      el('div', { class: 'quiz-choices' }, q.choices.map((c) => {
        const b = button(c.v, () => choose(c, b), 'btn-choice-q');
        return b;
      })),
    );
    answered = false;
    w.say('数字を1つ選んでください。');
  }

  function choose(choice, btn) {
    if (answered) return;
    answered = true;
    const q = QUESTIONS[index];
    for (const b of box.querySelectorAll('.btn-choice-q')) b.disabled = true;
    btn.classList.add(choice.ok ? 'is-right' : 'is-wrong');
    for (const b of box.querySelectorAll('.btn-choice-q')) {
      const c = q.choices.find((x) => x.v === b.textContent);
      if (c && c.ok) b.classList.add('is-right');
    }
    box.appendChild(el('p', { class: 'quiz-why', text: choice.why }));
    box.appendChild(makeProof(index));
    w.say(`<b>${q.after}</b> 光の量と数値は、比例していません。`);
    if (index < QUESTIONS.length - 1) {
      box.appendChild(button('つぎの問題', () => { index++; render(); }, 'btn-primary'));
    } else {
      box.appendChild(el('p', {
        class: 'quiz-why',
        text: 'なぜこうなるのかを、このあとのグラフで確かめます。',
      }));
    }
  }

  // 実際の数値で確かめる表。言葉だけで終わらせません。
  function makeProof() {
    // 0.216 を入れているのは、ここが 8bit の 128(段階のまん中)になる光の量だからです。
    const rows = [1, 0.5, 0.25, 0.216, 0.125].map((lin) => {
      const code = TRANSFERS.srgb.encode(lin);
      return el('tr', {}, [
        el('td', { class: 'num', text: (lin * 100).toFixed(1) + '%' }),
        el('td', { class: 'num', text: code.toFixed(3) }),
        el('td', { class: 'num', text: String(to8bit(code)) }),
        el('td', {}, [el('span', {
          class: 'proof-chip',
          style: `background: rgb(${to8bit(code)},${to8bit(code)},${to8bit(code)})`,
        })]),
      ]);
    });
    return el('div', { class: 'table-wrap' }, [
      el('table', {}, [
        el('thead', {}, [el('tr', {}, [
          el('th', { class: 'num', text: '光の量' }),
          el('th', { class: 'num', text: '数値(0〜1)' }),
          el('th', { class: 'num', text: '8bit(0〜255)' }),
          el('th', { text: '見た目' }),
        ])]),
        el('tbody', {}, rows),
      ]),
    ]);
  }

  w.onReset(() => { index = 0; render(); });
  render();

  w.setDetails(`
    <p>この曲げかたには理由があります。人の目は暗いところの差にとても敏感で、
       明るいところの差にはにぶいからです。</p>
    <p>数値を素直に光の量どおりにすると、8bit(真っ黒 0 から真っ白 255 までの256段階)では暗い部分の段階が足りず、
       空のグラデーションなどに縞が出ます。そこで暗い側に段階を多く割りあてる形に曲げてあります。</p>
    <p>sRGB の式は次のとおりです。0.0031308 を境に、直線部分とべき乗部分に分かれます。</p>
    <pre><code>光の量 ≦ 0.0031308 のとき   数値 = 光の量 × 12.92
それより明るいとき          数値 = 1.055 × 光の量^(1/2.4) − 0.055</code></pre>
  `);
}
