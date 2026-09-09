// scenes.js — 教材用の画像をプログラムで作ります。
//
// 実写素材は権利の問題があるので使いません。すべてここで計算して作ります。
// 作る値は「シーンリニア」、つまり現場にあった光の量に比例した数値です。
// 色域は AP1 (ACEScg) に統一します。1.0 を大きく超える値がふつうに出ます。

import { FloatImage } from './render.js';
import { gamutConversionMatrix, matApply, TRANSFERS } from './color.js';

const SRGB_TO_AP1 = gamutConversionMatrix('sRGB', 'AP1');

/** sRGB のリニア値を AP1 に持ってきます。 */
function srgbLinToAP1(rgb) {
  return matApply(SRGB_TO_AP1, rgb);
}

/** sRGB の 0..1 コード値(見た目の色)を、AP1 のシーンリニア値にします。 */
function srgbCodeToAP1(rgb, scale = 1) {
  const lin = rgb.map((v) => TRANSFERS.srgb.decode(v));
  return srgbLinToAP1(lin).map((v) => v * scale);
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// 決まった見た目を毎回作れるように、乱数は種つきの簡単なものを使います。
function makeRandom(seed) {
  let s = seed >>> 0;
  return function random() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// シーン1: 逆光の部屋(室内 + 明るい窓)
// 第4章の白飛び体験、第10章の HDR 比較で使います。
// 室内は 0.02〜0.2、窓の外は 6〜20、太陽の芯だけ 250 くらい。
// 明るさの比はおよそ 1 : 1万。SDR では窓が飛び、HDR 1000 nit では階調が残る値にしてあります。
// ---------------------------------------------------------------------------

export function sceneWindow(width = 640, height = 360) {
  const img = new FloatImage(width, height);
  const rand = makeRandom(12345);
  const windowLeft = 0.58, windowRight = 0.93;
  const windowTop = 0.12, windowBottom = 0.74;

  for (let y = 0; y < height; y++) {
    const v = y / height;
    for (let x = 0; x < width; x++) {
      const u = x / width;
      let c;

      const inWindow = u > windowLeft && u < windowRight && v > windowTop && v < windowBottom;
      const frame = 0.012;
      const onFrame = !inWindow &&
        u > windowLeft - frame && u < windowRight + frame &&
        v > windowTop - frame && v < windowBottom + frame;

      if (inWindow) {
        // 窓の外。上ほど濃い青空、下は明るい地面。太陽が右上に小さく入ります。
        const sv = (v - windowTop) / (windowBottom - windowTop);
        const sky = mix([7.5, 11, 19], [16, 17.5, 18], smoothstep(0.0, 0.75, sv));
        const ground = [11, 9.5, 6];
        c = mix(sky, ground, smoothstep(0.78, 0.86, sv));
        // 太陽
        const sx = (u - 0.84) * width / height, sy = sv - 0.18;
        const d = Math.sqrt(sx * sx + sy * sy);
        const sun = Math.exp(-d * d / 0.0016) * 260 + Math.exp(-d * d / 0.05) * 22;
        c = [c[0] + sun, c[1] + sun * 0.97, c[2] + sun * 0.9];
        // 窓わく(格子)
        const gx = Math.abs(u - (windowLeft + windowRight) / 2) < 0.006;
        if (gx) c = [c[0] * 0.02, c[1] * 0.02, c[2] * 0.02];
      } else if (onFrame) {
        c = [0.03, 0.028, 0.025];
      } else {
        // 室内。窓からの光で右に行くほど明るくなります。
        const distToWindow = Math.max(0, windowLeft - u);
        const falloff = 0.35 / (1 + distToWindow * distToWindow * 26);
        let wall = [0.145, 0.138, 0.126];
        wall = [wall[0] * (0.25 + falloff * 3), wall[1] * (0.25 + falloff * 3), wall[2] * (0.25 + falloff * 3.2)];

        // 床とテーブル
        if (v > 0.78) {
          const t = smoothstep(0.78, 0.86, v);
          wall = mix(wall, [wall[0] * 1.5, wall[1] * 1.2, wall[2] * 0.85], t);
        }
        // 壁に貼ったポスター(彩度の高い色。色域の話で効きます)
        if (u > 0.08 && u < 0.32 && v > 0.2 && v < 0.56) {
          const pu = (u - 0.08) / 0.24, pv = (v - 0.2) / 0.36;
          const base = pv < 0.5
            ? mix([0.9, 0.08, 0.05], [0.95, 0.55, 0.02], pu)
            : mix([0.03, 0.45, 0.85], [0.05, 0.75, 0.25], pu);
          wall = srgbLinToAP1(base).map((q) => q * (0.35 + falloff * 2.2));
          img.set(x, y, wall);
          continue;
        }
        // 机の上のマグカップ
        const mx = (u - 0.42) * 2.4, my = (v - 0.72) * 1.6;
        if (mx * mx + my * my < 0.0042) {
          wall = srgbLinToAP1([0.75, 0.72, 0.68]).map((q) => q * (0.3 + falloff * 2.5));
        }
        c = wall;
        // わずかな粒状感。バンディングが目立たなくなります。
        const n = (rand() - 0.5) * 0.0012;
        c = [c[0] + n, c[1] + n, c[2] + n];
      }
      img.set(x, y, [Math.max(0, c[0]), Math.max(0, c[1]), Math.max(0, c[2])]);
    }
  }
  return img;
}

// ---------------------------------------------------------------------------
// シーン2: 学習用カラーチャート
// 実在の測色チャートの複製ではありません。話に必要な色をならべたものです。
// ---------------------------------------------------------------------------

const CHART_PATCHES = [
  // 1段目: 身のまわりの色
  { name: '肌(明)', srgb: [0.85, 0.68, 0.58] },
  { name: '肌(暗)', srgb: [0.55, 0.38, 0.30] },
  { name: '空', srgb: [0.38, 0.55, 0.78] },
  { name: '葉', srgb: [0.30, 0.50, 0.24] },
  { name: '木', srgb: [0.45, 0.33, 0.20] },
  { name: '花', srgb: [0.85, 0.45, 0.60] },
  // 2段目: 原色
  { name: '赤', srgb: [0.85, 0.10, 0.10] },
  { name: '緑', srgb: [0.10, 0.70, 0.20] },
  { name: '青', srgb: [0.10, 0.20, 0.80] },
  { name: '黄', srgb: [0.92, 0.85, 0.12] },
  { name: 'シアン', srgb: [0.10, 0.70, 0.80] },
  { name: 'マゼンタ', srgb: [0.80, 0.15, 0.65] },
  // 3段目: 濃い色(色域の広さが効く)
  { name: '濃い赤', srgb: [0.65, 0.02, 0.02] },
  { name: '濃い緑', srgb: [0.02, 0.55, 0.05] },
  { name: '濃い青', srgb: [0.03, 0.05, 0.65] },
  { name: 'オレンジ', srgb: [0.95, 0.45, 0.05] },
  { name: '紫', srgb: [0.45, 0.10, 0.75] },
  { name: '若草', srgb: [0.55, 0.85, 0.10] },
  // 4段目: グレースケール
  { name: '白', srgb: [0.95, 0.95, 0.95] },
  { name: '明グレー', srgb: [0.75, 0.75, 0.75] },
  { name: '中グレー', srgb: [0.4614, 0.4614, 0.4614] }, // シーンリニア 0.18
  { name: '暗グレー', srgb: [0.30, 0.30, 0.30] },
  { name: '濃グレー', srgb: [0.16, 0.16, 0.16] },
  { name: '黒', srgb: [0.05, 0.05, 0.05] },
];

export function sceneChart(width = 600, height = 400) {
  const img = new FloatImage(width, height);
  const cols = 6, rows = 4;
  const pad = 0.03;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width, v = y / height;
      const cx = Math.floor(u * cols), cy = Math.floor(v * rows);
      const fx = u * cols - cx, fy = v * rows - cy;
      let c;
      if (fx < pad || fx > 1 - pad || fy < pad * 1.5 || fy > 1 - pad * 1.5) {
        c = [0.012, 0.012, 0.012]; // すきま
      } else {
        const p = CHART_PATCHES[Math.min(CHART_PATCHES.length - 1, cy * cols + cx)];
        c = srgbCodeToAP1(p.srgb);
      }
      img.set(x, y, c);
    }
  }
  return img;
}

export const CHART_PATCH_NAMES = CHART_PATCHES.map((p) => p.name);

// ---------------------------------------------------------------------------
// シーン3: 夕焼け
// なめらかなグラデーション。バンディングと色空間の違いが見やすいシーンです。
// ---------------------------------------------------------------------------

export function sceneSunset(width = 640, height = 360) {
  const img = new FloatImage(width, height);
  for (let y = 0; y < height; y++) {
    const v = y / height;
    for (let x = 0; x < width; x++) {
      const u = x / width;
      // 空のグラデーション
      let c = mix([1.2, 0.45, 0.10], [0.06, 0.10, 0.32], smoothstep(0.05, 0.72, v));
      c = mix(c, [3.5, 1.6, 0.5], smoothstep(0.42, 0.18, v) * smoothstep(0.15, 0.5, 1 - Math.abs(u - 0.62) * 2.4));
      // 太陽
      const sx = (u - 0.62) * width / height, sy = v - 0.34;
      const d = Math.sqrt(sx * sx + sy * sy);
      const sun = Math.exp(-d * d / 0.0009) * 110 + Math.exp(-d * d / 0.02) * 9;
      c = [c[0] + sun, c[1] + sun * 0.72, c[2] + sun * 0.38];
      // 水平線から下は海。空を映します。
      if (v > 0.72) {
        const t = (v - 0.72) / 0.28;
        const refl = mix([0.55, 0.22, 0.08], [0.02, 0.03, 0.08], t);
        const ripple = 1 + Math.sin(u * 90 + v * 30) * 0.12 * (1 - t);
        c = [refl[0] * ripple, refl[1] * ripple, refl[2] * ripple];
        // 太陽の道
        const road = Math.exp(-Math.pow((u - 0.62) / (0.03 + t * 0.18), 2)) * (1 - t) * 12;
        c = [c[0] + road, c[1] + road * 0.6, c[2] + road * 0.25];
      }
      img.set(x, y, [Math.max(0, c[0]), Math.max(0, c[1]), Math.max(0, c[2])]);
    }
  }
  return img;
}

// ---------------------------------------------------------------------------
// シーン4: CG の球と床
// 光の足し算とハイライトが出るので、第5章のリニア合成ラボに使います。
// かんたんなレイトレースで、物理的に正しい光の量を計算しています。
// ---------------------------------------------------------------------------

export function sceneCGBall(width = 640, height = 360, opts = {}) {
  const lightGain = opts.lightGain === undefined ? 1 : opts.lightGain;
  const img = new FloatImage(width, height);
  const aspect = width / height;
  const camY = 0.55, sphereR = 1.0, sphereC = [0, 1.0, 0];
  const lightDir = normalize([-0.5, 0.8, 0.45]);
  const lightColor = [3.2 * lightGain, 3.0 * lightGain, 2.7 * lightGain];
  const fill = [0.16, 0.20, 0.30];

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const u = (px / width * 2 - 1) * aspect * 0.55;
      const v = (1 - py / height * 2) * 0.55;
      const ro = [0, camY + 0.9, 5.2];
      const rd = normalize([u, v - 0.06, -1]);
      let c = skyColor(rd);

      // 球との交差
      const oc = [ro[0] - sphereC[0], ro[1] - sphereC[1], ro[2] - sphereC[2]];
      const b = 2 * dot(oc, rd);
      const cc = dot(oc, oc) - sphereR * sphereR;
      const disc = b * b - 4 * cc;
      let hitT = Infinity, n = null, albedo = null, spec = 0;

      if (disc > 0) {
        const t = (-b - Math.sqrt(disc)) / 2;
        if (t > 0.001) {
          hitT = t;
          const p = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
          n = normalize([p[0] - sphereC[0], p[1] - sphereC[1], p[2] - sphereC[2]]);
          albedo = srgbLinToAP1([0.62, 0.16, 0.13]);
          spec = 1;
        }
      }
      // 床 (y = 0) との交差
      if (rd[1] < 0) {
        const t = -ro[1] / rd[1];
        if (t > 0.001 && t < hitT) {
          hitT = t;
          const p = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
          if (Math.abs(p[0]) < 8 && p[2] > -8 && p[2] < 8) {
            n = [0, 1, 0];
            const check = (Math.floor(p[0] * 1.1) + Math.floor(p[2] * 1.1)) % 2 === 0;
            albedo = srgbLinToAP1(check ? [0.55, 0.55, 0.55] : [0.10, 0.11, 0.12]);
            spec = 0.15;
          } else {
            hitT = Infinity;
          }
        }
      }

      if (n) {
        const p = [ro[0] + rd[0] * hitT, ro[1] + rd[1] * hitT, ro[2] + rd[2] * hitT];
        // 影(球だけ)
        let shadow = 1;
        const so = [p[0] - sphereC[0], p[1] - sphereC[1], p[2] - sphereC[2]];
        const sb = 2 * dot(so, lightDir);
        const sc = dot(so, so) - sphereR * sphereR;
        const sdisc = sb * sb - 4 * sc;
        if (sdisc > 0) {
          const st = (-sb - Math.sqrt(sdisc)) / 2;
          if (st > 0.002) shadow = 0.06;
        }
        const ndl = Math.max(0, dot(n, lightDir));
        const diffuse = [
          albedo[0] * lightColor[0] * ndl * shadow,
          albedo[1] * lightColor[1] * ndl * shadow,
          albedo[2] * lightColor[2] * ndl * shadow,
        ];
        const amb = skyColor(n);
        const ambient = [albedo[0] * amb[0] * 0.5, albedo[1] * amb[1] * 0.5, albedo[2] * amb[2] * 0.5];
        // 鏡面反射。ここが 1.0 を大きく超えます。
        const h = normalize([lightDir[0] - rd[0], lightDir[1] - rd[1], lightDir[2] - rd[2]]);
        const s = Math.pow(Math.max(0, dot(n, h)), 220) * spec * 90 * shadow;
        c = [
          diffuse[0] + ambient[0] + s * lightColor[0] + fill[0] * albedo[0],
          diffuse[1] + ambient[1] + s * lightColor[1] + fill[1] * albedo[1],
          diffuse[2] + ambient[2] + s * lightColor[2] + fill[2] * albedo[2],
        ];
      }
      img.set(px, py, [Math.max(0, c[0]), Math.max(0, c[1]), Math.max(0, c[2])]);
    }
  }
  return img;

  function skyColor(d) {
    const t = Math.max(0, Math.min(1, d[1] * 0.5 + 0.5));
    const sky = mix([0.55, 0.42, 0.32], [0.22, 0.36, 0.85], t);
    // 太陽の方向は明るく
    const s = Math.pow(Math.max(0, dot(d, lightDir)), 400) * 400;
    return srgbLinToAP1([sky[0] + s, sky[1] + s * 0.95, sky[2] + s * 0.85]);
  }
}

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function normalize(v) {
  const l = Math.sqrt(dot(v, v)) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// ---------------------------------------------------------------------------
// シーン5: 夜の街
// 暗い中に強い光。HDR の比較で差がいちばん出るシーンです。
// ---------------------------------------------------------------------------

export function sceneNight(width = 640, height = 360) {
  const img = new FloatImage(width, height);
  // 明るさは SDR で飛び、HDR 1000 nit では階調が残る範囲にそろえてあります。
  const lamps = [
    { x: 0.18, y: 0.32, r: 0.012, i: 42, c: [1.0, 0.88, 0.62] },
    { x: 0.47, y: 0.26, r: 0.010, i: 58, c: [1.0, 0.92, 0.75] },
    { x: 0.78, y: 0.34, r: 0.011, i: 34, c: [1.0, 0.86, 0.58] },
  ];
  const neons = [
    { x0: 0.06, x1: 0.30, y0: 0.55, y1: 0.61, i: 16, c: [1.0, 0.15, 0.35] },
    { x0: 0.62, x1: 0.90, y0: 0.48, y1: 0.53, i: 11, c: [0.20, 0.85, 1.0] },
    { x0: 0.36, x1: 0.55, y0: 0.66, y1: 0.70, i: 8, c: [0.35, 1.0, 0.45] },
  ];
  for (let y = 0; y < height; y++) {
    const v = y / height;
    for (let x = 0; x < width; x++) {
      const u = x / width;
      // 夜空と建物のシルエット
      let c = mix([0.028, 0.036, 0.082], [0.006, 0.008, 0.026], smoothstep(0.0, 0.45, v));
      if (v > 0.42) {
        const t = smoothstep(0.42, 1.0, v);
        c = mix(c, [0.016, 0.017, 0.024], t);
        // 濡れた路面の反射
        if (v > 0.74) c = [c[0] * 1.4, c[1] * 1.3, c[2] * 1.5];
      }
      // ネオン看板
      for (const nn of neons) {
        if (u > nn.x0 && u < nn.x1 && v > nn.y0 && v < nn.y1) {
          c = [nn.c[0] * nn.i, nn.c[1] * nn.i, nn.c[2] * nn.i];
        } else {
          const dx = Math.max(nn.x0 - u, 0, u - nn.x1);
          const dy = Math.max(nn.y0 - v, 0, v - nn.y1);
          const d = Math.sqrt(dx * dx + dy * dy);
          const g = Math.exp(-d * d / 0.0025) * nn.i * 0.35;
          c = [c[0] + nn.c[0] * g, c[1] + nn.c[1] * g, c[2] + nn.c[2] * g];
        }
      }
      // 街灯
      for (const l of lamps) {
        const dx = (u - l.x) * width / height, dy = v - l.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const core = d < l.r ? l.i : 0;
        const glow = Math.exp(-d * d / 0.004) * l.i * 0.30 + Math.exp(-d * d / 0.06) * l.i * 0.03;
        const t = core + glow;
        c = [c[0] + l.c[0] * t, c[1] + l.c[1] * t, c[2] + l.c[2] * t];
        // 路面に落ちる光
        if (v > 0.74) {
          const rd = Math.abs(u - l.x);
          const rl = Math.exp(-rd * rd / 0.02) * l.i * 0.012 * (1 - (v - 0.74) / 0.26);
          c = [c[0] + l.c[0] * rl, c[1] + l.c[1] * rl, c[2] + l.c[2] * rl];
        }
      }
      img.set(x, y, [Math.max(0, c[0]), Math.max(0, c[1]), Math.max(0, c[2])]);
    }
  }
  return img;
}

// ---------------------------------------------------------------------------
// シーン6: グレーの段階(ステップウェッジ)と連続グラデーション
// 第3章のガンマの話で使います。段ごとの明るさは 1段 = 1 EV(2倍)です。
// ---------------------------------------------------------------------------

export function sceneGreySteps(width = 640, height = 200, steps = 11, startEV = -5) {
  const img = new FloatImage(width, height);
  for (let y = 0; y < height; y++) {
    const v = y / height;
    for (let x = 0; x < width; x++) {
      const i = Math.min(steps - 1, Math.floor((x / width) * steps));
      const ev = startEV + i;
      const lin = 0.18 * Math.pow(2, ev);
      let c = srgbLinToAP1([lin, lin, lin]);
      if (v > 0.78) {
        // 下段は連続グラデーション
        const t = x / width;
        const l2 = 0.18 * Math.pow(2, startEV + t * steps);
        c = srgbLinToAP1([l2, l2, l2]);
      }
      img.set(x, y, c);
    }
  }
  return img;
}

/** 肌色のグラデーション帯。色空間を取り違えたときの違和感が分かりやすい素材です。 */
export function sceneSkinRamp(width = 640, height = 200) {
  const img = new FloatImage(width, height);
  for (let y = 0; y < height; y++) {
    const v = y / height;
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const base = mix([0.30, 0.18, 0.14], [0.98, 0.86, 0.78], u);
      const warm = mix([1.0, 0.98, 0.96], [1.0, 1.02, 1.06], v);
      img.set(x, y, srgbCodeToAP1([base[0] * warm[0], base[1] * warm[1], base[2] * warm[2]]));
    }
  }
  return img;
}

// ---------------------------------------------------------------------------
// まとめ
// ---------------------------------------------------------------------------

export const SCENES = {
  window: { label: '逆光の部屋', make: sceneWindow, note: '室内と窓の外で明るさが40万倍ちがう' },
  chart: { label: 'カラーチャート', make: sceneChart, note: '色ごとの変化を見くらべる' },
  sunset: { label: '夕焼け', make: sceneSunset, note: 'なめらかなグラデーション' },
  cgball: { label: 'CGの球', make: sceneCGBall, note: '光の計算がそのまま入っている' },
  night: { label: '夜の街', make: sceneNight, note: '暗い中に強い光。HDR で差が出る' },
  greysteps: { label: 'グレーの段', make: sceneGreySteps, note: '1段が2倍の明るさ' },
  skin: { label: '肌色の帯', make: sceneSkinRamp, note: '色のズレに気づきやすい' },
};

const _cache = new Map();

/** 同じシーンを何度も作らないようにキャッシュします。 */
export function getScene(name, width, height) {
  const key = `${name}:${width}x${height}`;
  if (!_cache.has(key)) {
    const s = SCENES[name];
    if (!s) throw new Error(`シーン "${name}" はありません`);
    _cache.set(key, s.make(width, height));
  }
  return _cache.get(key);
}
