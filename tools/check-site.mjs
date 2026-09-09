// tools/check-site.mjs — サイト全体をブラウザで確かめる道具。
//
// 使いかた:
//   npx http-server -p 8811 -s .        (別のターミナルで)
//   node tools/check-site.mjs
//
// 確かめること:
//   1. どのページも読みこめて、コンソールにエラーが出ない
//   2. インタラクティブ部品が全部起動する
//   3. スマートフォンの幅で横スクロールが出ない
//   4. JavaScript を切っても本文が読める
//   5. 外部への通信がゼロである
//
// playwright が必要です。見つからない場合は、その旨だけ出して終わります。

const BASE = process.env.BASE || 'http://127.0.0.1:8811';

const PAGES = [
  'index.html', 'ch01.html', 'ch02.html', 'ch03.html', 'ch04.html', 'ch05.html',
  'ch06.html', 'ch07.html', 'ch08.html', 'ch09.html', 'ch10.html', 'ch11.html',
  'glossary.html', 'next.html', 'tests.html',
];

const VIEWPORTS = [
  { width: 360, height: 780, name: 'スマホ (360px)' },
  { width: 1280, height: 900, name: 'PC (1280px)' },
];

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (err) {
  try {
    ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs'));
  } catch (err2) {
    console.log('playwright が見つかりません。npm i -D playwright を実行してください。');
    process.exit(0);
  }
}

const launchOpts = { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] };
if (process.env.CHROME_PATH) launchOpts.executablePath = process.env.CHROME_PATH;
else if (await exists('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')) {
  launchOpts.executablePath = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
}

async function exists(p) {
  try { const fs = await import('node:fs/promises'); await fs.access(p); return true; } catch { return false; }
}

const browser = await chromium.launch(launchOpts);
const external = new Set();
let fails = 0;

/** 画面の下まで少しずつスクロールして、見えた部品を全部起動させる。 */
async function scrollThrough(page, step) {
  let y = 0;
  for (let guard = 0; guard < 60; guard++) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(260);
    const h = await page.evaluate(() => document.body.scrollHeight);
    y += step;
    if (y > h) break;
  }
  await page.waitForTimeout(1200);
}

for (const vp of VIEWPORTS) {
  console.log(`\n### ${vp.name} ###`);
  for (const p of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('request', (r) => {
      const u = r.url();
      if (!u.startsWith(BASE) && !u.startsWith('data:')) external.add(u);
    });

    const resp = await page.goto(`${BASE}/${p}`, { waitUntil: 'networkidle' });
    await scrollThrough(page, Math.round(vp.height * 0.7));

    const info = await page.evaluate(() => ({
      mounts: document.querySelectorAll('[data-widget]').length,
      widgets: document.querySelectorAll('.widget').length,
      glossaryReady: document.querySelectorAll('.gl-search').length,
      errWidgets: document.querySelectorAll('.widget-error').length,
      badCanvas: [...document.querySelectorAll('canvas')].filter((c) => !c.width || !c.height).length,
      hScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      chars: document.querySelector('main') ? document.querySelector('main').innerText.length : 0,
      failedTests: document.querySelectorAll('.t-fail').length,
    }));

    const mounted = info.widgets + info.glossaryReady;
    const ok = resp.status() === 200
      && info.errWidgets === 0
      && errors.length === 0
      && info.hScroll <= 1
      && info.badCanvas === 0
      && info.failedTests === 0
      && mounted >= info.mounts;
    if (!ok) fails++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${p.padEnd(14)} 部品 ${mounted}/${info.mounts}`
      + `  文字数 ${String(info.chars).padStart(4)}  横はみ出し ${info.hScroll}px`
      + (info.failedTests ? `  テスト失敗 ${info.failedTests}` : ''));
    if (errors.length) console.log('      ' + errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
}

console.log('\n### JavaScript オフ ###');
const noJS = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 800 } });
for (const p of PAGES) {
  if (p === 'tests.html') continue; // テストページは JavaScript が前提
  const page = await noJS.newPage();
  await page.goto(`${BASE}/${p}`, { waitUntil: 'domcontentloaded' });
  const info = await page.evaluate(() => ({
    chars: document.querySelector('main').innerText.replace(/\s/g, '').length,
    navVisible: !document.querySelector('.chapter-nav').hidden,
    fallbacks: document.querySelectorAll('.js-required').length,
    mounts: document.querySelectorAll('[data-widget]').length,
    glossaryItems: document.querySelectorAll('.gl-item').length,
  }));
  // 部品の代わりの説明が置いてあるか(用語集は中身そのものが静的に入っている)
  const covered = info.fallbacks >= info.mounts || info.glossaryItems > 0;
  const ok = info.chars > 300 && info.navVisible && covered;
  if (!ok) fails++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${p.padEnd(14)} 本文 ${String(info.chars).padStart(4)}字`
    + `  目次 ${info.navVisible ? '表示' : '非表示'}  代替 ${info.fallbacks}/${info.mounts}`);
  await page.close();
}
await noJS.close();
await browser.close();

console.log('\n外部への通信: ' + (external.size === 0 ? 'なし' : [...external].join(', ')));
if (external.size) fails++;
console.log(fails ? `\n${fails} 件の問題が見つかりました。` : '\nすべて問題ありません。');
process.exit(fails ? 1 : 0);
