// color.js — 色空間の定義と、色に関する基本計算。
//
// このファイルの数値はすべて公表された規格値です。出典は各定義のコメントに書いています。
// 行列はハードコードせず、原色 (primaries) と白色点 (white point) から計算します。
// そうすれば値の出所が1か所にまとまり、検算もできます。

// ---------------------------------------------------------------------------
// 3x3 行列のユーティリティ。行優先 (row-major) の長さ9の配列で表します。
// ---------------------------------------------------------------------------

export function matMul(a, b) {
  const out = new Float64Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] =
        a[r * 3 + 0] * b[0 * 3 + c] +
        a[r * 3 + 1] * b[1 * 3 + c] +
        a[r * 3 + 2] * b[2 * 3 + c];
    }
  }
  return out;
}

export function matApply(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function matInvert(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error('行列が逆行列を持ちません');
  const inv = 1 / det;
  return new Float64Array([
    A * inv, (c * h - b * i) * inv, (b * f - c * e) * inv,
    B * inv, (a * i - c * g) * inv, (c * d - a * f) * inv,
    C * inv, (b * g - a * h) * inv, (a * e - b * d) * inv,
  ]);
}

export function matDiag(v) {
  return new Float64Array([v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
}

export const MAT_IDENTITY = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

export function matEquals(a, b, eps = 1e-9) {
  for (let i = 0; i < 9; i++) if (Math.abs(a[i] - b[i]) > eps) return false;
  return true;
}

// ---------------------------------------------------------------------------
// 白色点。CIE xy 色度で持ちます。
// ---------------------------------------------------------------------------

export const WHITE_POINTS = {
  // D65: sRGB / Rec.709 / Display P3 / Rec.2020 が使う白。出典: IEC 61966-2-1, ITU-R BT.709-6
  D65: [0.3127, 0.3290],
  // D60 相当の ACES 白。出典: SMPTE ST 2065-1
  ACES: [0.32168, 0.33767],
  // DCI の白。劇場用。出典: SMPTE RP 431-2
  DCI: [0.314, 0.351],
};

export function xyToXYZ(xy, Y = 1) {
  const [x, y] = xy;
  return [(x / y) * Y, Y, ((1 - x - y) / y) * Y];
}

// ---------------------------------------------------------------------------
// 原色から RGB→XYZ 行列を作る。
// 手順は一般的なもの: 各原色を Y=1 の XYZ にし、白が (Xw,1,Zw) になるよう
// 各列のスケールを解いてから対角行列を掛けます。
// ---------------------------------------------------------------------------

export function rgbToXYZMatrix(primaries, whitePoint) {
  const { red, green, blue } = primaries;
  const M = new Float64Array([
    red[0] / red[1], green[0] / green[1], blue[0] / blue[1],
    1, 1, 1,
    (1 - red[0] - red[1]) / red[1],
    (1 - green[0] - green[1]) / green[1],
    (1 - blue[0] - blue[1]) / blue[1],
  ]);
  const W = xyToXYZ(whitePoint, 1);
  const S = matApply(matInvert(M), W);
  return matMul(M, matDiag(S));
}

// ---------------------------------------------------------------------------
// 白色順応 (chromatic adaptation)。Bradford 法。
// 白の違う色空間どうしをつなぐときに必要です。
// 出典: Lindbloom, "Chromatic Adaptation" / ACES の実装が使うのと同じ行列。
// ---------------------------------------------------------------------------

const BRADFORD = new Float64Array([
  0.8951, 0.2664, -0.1614,
  -0.7502, 1.7135, 0.0367,
  0.0389, -0.0685, 1.0296,
]);

export function adaptationMatrix(srcWhiteXY, dstWhiteXY) {
  if (srcWhiteXY[0] === dstWhiteXY[0] && srcWhiteXY[1] === dstWhiteXY[1]) {
    return MAT_IDENTITY.slice();
  }
  const srcCone = matApply(BRADFORD, xyToXYZ(srcWhiteXY, 1));
  const dstCone = matApply(BRADFORD, xyToXYZ(dstWhiteXY, 1));
  const scale = matDiag([
    dstCone[0] / srcCone[0],
    dstCone[1] / srcCone[1],
    dstCone[2] / srcCone[2],
  ]);
  return matMul(matInvert(BRADFORD), matMul(scale, BRADFORD));
}

// ---------------------------------------------------------------------------
// 色域 (原色 + 白色点) の定義。
// ---------------------------------------------------------------------------

export const GAMUTS = {
  // ITU-R BT.709-6 / IEC 61966-2-1 (sRGB は Rec.709 と同じ原色)
  sRGB: {
    label: 'sRGB',
    note: 'パソコンやスマホの標準',
    white: WHITE_POINTS.D65,
    primaries: { red: [0.640, 0.330], green: [0.300, 0.600], blue: [0.150, 0.060] },
  },
  Rec709: {
    label: 'Rec.709',
    note: 'ハイビジョンテレビの標準',
    white: WHITE_POINTS.D65,
    primaries: { red: [0.640, 0.330], green: [0.300, 0.600], blue: [0.150, 0.060] },
  },
  // SMPTE EG 432-1 / Apple の Display P3 は P3 原色 + D65 白
  P3D65: {
    label: 'Display P3',
    note: '最近のスマホやMacの画面',
    white: WHITE_POINTS.D65,
    primaries: { red: [0.680, 0.320], green: [0.265, 0.690], blue: [0.150, 0.060] },
  },
  // ITU-R BT.2020-2
  Rec2020: {
    label: 'Rec.2020',
    note: '4K/8K放送とHDR',
    white: WHITE_POINTS.D65,
    primaries: { red: [0.708, 0.292], green: [0.170, 0.797], blue: [0.131, 0.046] },
  },
  // SMPTE ST 2065-1 (ACES AP0)
  AP0: {
    label: 'ACES2065-1 (AP0)',
    note: 'ACES の保存・受け渡し用。目に見えない色まで含む',
    white: WHITE_POINTS.ACES,
    primaries: { red: [0.7347, 0.2653], green: [0.0000, 1.0000], blue: [0.0001, -0.0770] },
  },
  // ACES AP1 (ACEScg などが使う)
  AP1: {
    label: 'ACEScg (AP1)',
    note: 'CG と合成の作業用',
    white: WHITE_POINTS.ACES,
    primaries: { red: [0.713, 0.293], green: [0.165, 0.830], blue: [0.128, 0.044] },
  },
};

const _matrixCache = new Map();

export function gamutToXYZ(name) {
  const key = 'toXYZ:' + name;
  if (!_matrixCache.has(key)) {
    const g = GAMUTS[name];
    if (!g) throw new Error(`色域 "${name}" は定義されていません`);
    _matrixCache.set(key, rgbToXYZMatrix(g.primaries, g.white));
  }
  return _matrixCache.get(key);
}

export function xyzToGamut(name) {
  const key = 'fromXYZ:' + name;
  if (!_matrixCache.has(key)) _matrixCache.set(key, matInvert(gamutToXYZ(name)));
  return _matrixCache.get(key);
}

/** 色域 src から色域 dst への 3x3 行列。白が違う場合は Bradford で順応します。 */
export function gamutConversionMatrix(src, dst) {
  const key = `conv:${src}>${dst}`;
  if (_matrixCache.has(key)) return _matrixCache.get(key);
  const a = adaptationMatrix(GAMUTS[src].white, GAMUTS[dst].white);
  const m = matMul(xyzToGamut(dst), matMul(a, gamutToXYZ(src)));
  _matrixCache.set(key, m);
  return m;
}

/** その色域での相対輝度の重み (XYZ の Y 行)。 */
export function luminanceWeights(name) {
  const m = gamutToXYZ(name);
  return [m[3], m[4], m[5]];
}

// ---------------------------------------------------------------------------
// 伝達関数 (transfer function)。
// encode: 光の量 (linear) → 保存する数値
// decode: 保存する数値 → 光の量 (linear)
// どちらも負の値は符号を保って対称に扱います (グレーディングで負が出るため)。
// ---------------------------------------------------------------------------

function signPow(x, p) {
  return x < 0 ? -Math.pow(-x, p) : Math.pow(x, p);
}

export const TRANSFERS = {
  linear: {
    label: 'リニア',
    note: '光の量そのもの。曲げない',
    encode: (x) => x,
    decode: (x) => x,
  },

  // IEC 61966-2-1 (sRGB)
  srgb: {
    label: 'sRGB',
    note: 'パソコンやスマホの標準的な曲げ方',
    encode: (x) => {
      const a = Math.abs(x);
      const v = a <= 0.0031308 ? a * 12.92 : 1.055 * Math.pow(a, 1 / 2.4) - 0.055;
      return x < 0 ? -v : v;
    },
    decode: (x) => {
      const a = Math.abs(x);
      const v = a <= 0.04045 ? a / 12.92 : Math.pow((a + 0.055) / 1.055, 2.4);
      return x < 0 ? -v : v;
    },
  },

  // ITU-R BT.709-6 の OETF。sRGB とは少し違います。
  rec709: {
    label: 'Rec.709',
    note: 'テレビ用の曲げ方。sRGB と少し違う',
    encode: (x) => {
      const a = Math.abs(x);
      const v = a < 0.018 ? a * 4.5 : 1.099 * Math.pow(a, 0.45) - 0.099;
      return x < 0 ? -v : v;
    },
    decode: (x) => {
      const a = Math.abs(x);
      const v = a < 0.081 ? a / 4.5 : Math.pow((a + 0.099) / 1.099, 1 / 0.45);
      return x < 0 ? -v : v;
    },
  },

  gamma22: {
    label: 'ガンマ 2.2',
    note: 'いちばん単純な曲げ方',
    encode: (x) => signPow(x, 1 / 2.2),
    decode: (x) => signPow(x, 2.2),
  },

  gamma24: {
    label: 'ガンマ 2.4',
    note: '暗い部屋のテレビ向け',
    encode: (x) => signPow(x, 1 / 2.4),
    decode: (x) => signPow(x, 2.4),
  },

  // ACEScct。出典: Academy S-2016-001
  acescct: {
    label: 'ACEScct',
    note: '色を調整するとき用。暗いところの操作感が良い',
    encode: (x) => {
      const A = 10.5402377416545, B = 0.0729055341958355;
      if (x <= 0.0078125) return A * x + B;
      return (Math.log2(x) + 9.72) / 17.52;
    },
    decode: (x) => {
      const A = 10.5402377416545, B = 0.0729055341958355;
      const Y_BRK = 0.155251141552511;
      const MAXV = (Math.log2(65504) + 9.72) / 17.52;
      if (x <= Y_BRK) return (x - B) / A;
      if (x < MAXV) return Math.pow(2, x * 17.52 - 9.72);
      return 65504;
    },
  },

  // ACEScc。出典: Academy S-2014-003
  acescc: {
    label: 'ACEScc',
    note: 'ACEScct の兄弟。暗部にトゥが無い',
    encode: (x) => {
      if (x <= 0) return (Math.log2(Math.pow(2, -16)) + 9.72) / 17.52;
      if (x < Math.pow(2, -15)) return (Math.log2(Math.pow(2, -16) + x * 0.5) + 9.72) / 17.52;
      return (Math.log2(x) + 9.72) / 17.52;
    },
    decode: (x) => {
      const lo = (Math.log2(Math.pow(2, -16)) + 9.72) / 17.52;
      const hi = (Math.log2(65504) + 9.72) / 17.52;
      if (x <= lo) return 0;
      if (x < (9.72 - 15) / 17.52) return (Math.pow(2, x * 17.52 - 9.72) - Math.pow(2, -16)) * 2;
      if (x < hi) return Math.pow(2, x * 17.52 - 9.72);
      return 65504;
    },
  },

  // 学習用の疑似 Log。特定メーカーの曲線ではありません。
  // 「Log とはこういう形」を見せるためだけに使います。
  demolog: {
    label: 'Log(学習用の一例)',
    note: '広い明るさを詰め込む記録方式。実在の機種の曲線ではありません',
    encode: (x) => {
      const a = 0.2, b = 0.01;
      if (x <= 0) return 0;
      return Math.max(0, (Math.log10(x * a + b) - Math.log10(b)) / (Math.log10(a + b) - Math.log10(b)));
    },
    decode: (x) => {
      const a = 0.2, b = 0.01;
      const lb = Math.log10(b), span = Math.log10(a + b) - lb;
      return (Math.pow(10, x * span + lb) - b) / a;
    },
  },

  // SMPTE ST 2084 (PQ)。入出力は「絶対輝度 nit を 10000 で割った値」です。
  pq: {
    label: 'PQ (ST 2084)',
    note: 'HDR。絶対的な明るさを指定する方式',
    encode: (y) => {
      const m1 = 2610 / 16384, m2 = (2523 / 4096) * 128;
      const c1 = 3424 / 4096, c2 = (2413 / 4096) * 32, c3 = (2392 / 4096) * 32;
      const Y = Math.max(0, y);
      const Ym = Math.pow(Y, m1);
      return Math.pow((c1 + c2 * Ym) / (1 + c3 * Ym), m2);
    },
    decode: (v) => {
      const m1 = 2610 / 16384, m2 = (2523 / 4096) * 128;
      const c1 = 3424 / 4096, c2 = (2413 / 4096) * 32, c3 = (2392 / 4096) * 32;
      const V = Math.pow(Math.max(0, v), 1 / m2);
      const num = Math.max(0, V - c1);
      return Math.pow(num / (c2 - c3 * V), 1 / m1);
    },
  },

  // ARIB STD-B67 / ITU-R BT.2100 の HLG OETF。入力は 0..1 に正規化済みのシーン光。
  hlg: {
    label: 'HLG',
    note: 'HDR。従来のテレビとも両立しやすい方式',
    encode: (x) => {
      const a = 0.17883277, b = 0.28466892, c = 0.55991073;
      const E = Math.max(0, x);
      return E <= 1 / 12 ? Math.sqrt(3 * E) / 2 : a * Math.log(12 * E - b) + c;
    },
    decode: (v) => {
      const a = 0.17883277, b = 0.28466892, c = 0.55991073;
      const V = Math.max(0, v);
      return V <= 0.5 ? (V * V * 4) / 3 : (Math.exp((V - c) / a) + b) / 12;
    },
  },
};

// ---------------------------------------------------------------------------
// よく使う定数
// ---------------------------------------------------------------------------

/** 中間グレー。シーンリニアで 0.18。写真や映像でずっと基準になっている値です。 */
export const MIDDLE_GREY = 0.18;

/** シーンリニア値を EV(段)に。0.18 を 0 EV とします。 */
export function linearToEV(x) {
  return Math.log2(Math.max(1e-10, x) / MIDDLE_GREY);
}

export function evToLinear(ev) {
  return MIDDLE_GREY * Math.pow(2, ev);
}

/** 0..1 の値を 8bit のコード値にします。表示用。 */
export function to8bit(x) {
  return Math.round(Math.min(1, Math.max(0, x)) * 255);
}

export function clamp(x, lo = 0, hi = 1) {
  return x < lo ? lo : x > hi ? hi : x;
}
