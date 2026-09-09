// main.js — 全ページ共通の起動処理。
//
// やること:
//   1. スマートフォン用の目次の開閉
//   2. data-widget が付いた場所に、その章のインタラクティブ部品を読みこむ
//   3. 読み終えた章を(この端末の中だけに)覚える
//   4. トップページの目次に「読んだ」印を付ける

import { guard, whenVisible } from './core/ui.js';
import { markRead, readChapters, isAvailable } from './core/progress.js';

/** 章の一覧。目次と前後リンクの元になります。tools/build_pages.py と同じ内容です。 */
export const CHAPTERS = [
  { id: 'ch01', file: 'ch01.html', num: '1', title: '色ってなんだろう' },
  { id: 'ch02', file: 'ch02.html', num: '2', title: '数字だけでは色は決まらない' },
  { id: 'ch03', file: 'ch03.html', num: '3', title: '明るさの数字は正直じゃない' },
  { id: 'ch04', file: 'ch04.html', num: '4', title: '見える範囲がちがう' },
  { id: 'ch05', file: 'ch05.html', num: '5', title: '混ぜると壊れる' },
  { id: 'ch06', file: 'ch06.html', num: '6', title: 'OCIO の登場' },
  { id: 'ch07', file: 'ch07.html', num: '7', title: 'config.ocio をさわる' },
  { id: 'ch08', file: 'ch08.html', num: '8', title: 'ACES というみんなのルール' },
  { id: 'ch09', file: 'ch09.html', num: '9', title: 'グレーディングはどこに入れる' },
  { id: 'ch10', file: 'ch10.html', num: '10', title: 'HDR — 明るいテレビにも届ける' },
  { id: 'ch11', file: 'ch11.html', num: '11', title: 'まとめとチェックテスト' },
];

function setupNavToggle() {
  const btn = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.chapter-nav');
  if (!btn || !nav) return;
  // JavaScript が動かないときのために、HTML では目次を開いたままにしています。
  // 動く環境ではボタンで開け閉めできるので、最初は閉じておきます。
  nav.hidden = true;
  btn.hidden = false;
  btn.setAttribute('aria-expanded', String(!nav.hidden));
  btn.addEventListener('click', () => {
    nav.hidden = !nav.hidden;
    btn.setAttribute('aria-expanded', String(!nav.hidden));
  });
}

async function mountWidgets() {
  const mounts = document.querySelectorAll('[data-widget]');
  for (const mount of mounts) {
    const name = mount.getAttribute('data-widget');
    whenVisible(mount, async () => {
      try {
        const mod = await import(`./widgets/${name}.js`);
        guard(mount, () => mod.default(mount));
      } catch (err) {
        console.error(`部品 ${name} を読みこめませんでした`, err);
        guard(mount, () => { throw err; });
      }
    });
  }
}

function markThisChapterRead() {
  const id = document.body.dataset.chapter;
  if (!id) return;
  const foot = document.querySelector('.chapter-foot');
  if (!foot) { markRead(id); return; }
  // 章の終わりまで来たら「読んだ」ことにします。
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { markRead(id); io.disconnect(); }
  }, { rootMargin: '0px 0px -20% 0px' });
  io.observe(foot);
}

function decorateIndex() {
  const cards = document.querySelectorAll('.toc-card[data-chapter]');
  if (!cards.length) return;
  const done = new Set(readChapters());
  for (const card of cards) {
    if (done.has(card.dataset.chapter)) {
      const mark = document.createElement('span');
      mark.className = 'done';
      mark.textContent = '✓ 読んだ';
      card.appendChild(mark);
    }
  }
  const notice = document.querySelector('[data-storage-notice]');
  if (notice && !isAvailable()) {
    notice.textContent = 'このブラウザでは読んだ記録を保存できない設定になっています。学習の内容には影響しません。';
    notice.hidden = false;
  }
}

function start() {
  setupNavToggle();
  mountWidgets();
  markThisChapterRead();
  decorateIndex();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
