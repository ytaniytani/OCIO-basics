// transforms.js — 色の変換を「ノード」として表します。
//
// 大事な決まり: どのノードも CPU 実行 (applyCPU) と GLSL 生成 (emitGLSL) の
// 両方を同じ定義から生やします。実装を二重に書くと必ずズレるためです。
// 一致することは tests.html の CPU/GPU 一致テストで確認します。

import {
  TRANSFERS, gamutConversionMatrix, luminanceWeights, clamp,
} from './color.js';

// ---------------------------------------------------------------------------
// GLSL の共通前置き。すべてのシェーダの先頭に入ります。
// CPU 側の実装 (color.js) と式を必ずそろえてください。
// ---------------------------------------------------------------------------

export const GLSL_PRELUDE = `
float sgn_pow(float x, float p) { return x < 0.0 ? -pow(-x, p) : pow(x, p); }

float srgb_encode(float x) {
  float a = abs(x);
  float v = a <= 0.0031308 ? a * 12.92 : 1.055 * pow(a, 1.0 / 2.4) - 0.055;
  return x < 0.0 ? -v : v;
}
float srgb_decode(float x) {
  float a = abs(x);
  float v = a <= 0.04045 ? a / 12.92 : pow((a + 0.055) / 1.055, 2.4);
  return x < 0.0 ? -v : v;
}
float rec709_encode(float x) {
  float a = abs(x);
  float v = a < 0.018 ? a * 4.5 : 1.099 * pow(a, 0.45) - 0.099;
  return x < 0.0 ? -v : v;
}
float rec709_decode(float x) {
  float a = abs(x);
  float v = a < 0.081 ? a / 4.5 : pow((a + 0.099) / 1.099, 1.0 / 0.45);
  return x < 0.0 ? -v : v;
}
float log2f(float x) { return log(x) / log(2.0); }

float acescct_encode(float x) {
  return x <= 0.0078125
    ? 10.5402377416545 * x + 0.0729055341958355
    : (log2f(x) + 9.72) / 17.52;
}
float acescct_decode(float x) {
  if (x <= 0.155251141552511) return (x - 0.0729055341958355) / 10.5402377416545;
  if (x < 1.4679963002376) return pow(2.0, x * 17.52 - 9.72);
  return 65504.0;
}
float acescc_encode(float x) {
  if (x <= 0.0) return (-16.0 + 9.72) / 17.52;
  if (x < 3.0517578125e-05) return (log2f(1.52587890625e-05 + x * 0.5) + 9.72) / 17.52;
  return (log2f(x) + 9.72) / 17.52;
}
float acescc_decode(float x) {
  if (x <= (-16.0 + 9.72) / 17.52) return 0.0;
  if (x < (9.72 - 15.0) / 17.52) return (pow(2.0, x * 17.52 - 9.72) - 1.52587890625e-05) * 2.0;
  if (x < 1.4679963002376) return pow(2.0, x * 17.52 - 9.72);
  return 65504.0;
}
float demolog_encode(float x) {
  const float a = 0.2, b = 0.01;
  if (x <= 0.0) return 0.0;
  float lb = log(b) / log(10.0);
  float span = log(a + b) / log(10.0) - lb;
  return max(0.0, (log(x * a + b) / log(10.0) - lb) / span);
}
float demolog_decode(float x) {
  const float a = 0.2, b = 0.01;
  float lb = log(b) / log(10.0);
  float span = log(a + b) / log(10.0) - lb;
  return (pow(10.0, x * span + lb) - b) / a;
}
float pq_encode(float y) {
  const float m1 = 0.1593017578125, m2 = 78.84375;
  const float c1 = 0.8359375, c2 = 18.8515625, c3 = 18.6875;
  float Y = max(0.0, y);
  float Ym = pow(Y, m1);
  return pow((c1 + c2 * Ym) / (1.0 + c3 * Ym), m2);
}
float pq_decode(float v) {
  const float m1 = 0.1593017578125, m2 = 78.84375;
  const float c1 = 0.8359375, c2 = 18.8515625, c3 = 18.6875;
  float V = pow(max(0.0, v), 1.0 / m2);
  return pow(max(0.0, V - c1) / (c2 - c3 * V), 1.0 / m1);
}
float hlg_encode(float x) {
  const float a = 0.17883277, b = 0.28466892, c = 0.55991073;
  float E = max(0.0, x);
  return E <= 1.0 / 12.0 ? sqrt(3.0 * E) / 2.0 : a * log(12.0 * E - b) + c;
}
float hlg_decode(float v) {
  const float a = 0.17883277, b = 0.28466892, c = 0.55991073;
  float V = max(0.0, v);
  return V <= 0.5 ? (V * V * 4.0) / 3.0 : (exp((V - c) / a) + b) / 12.0;
}
float gamma_encode(float x, float g) { return sgn_pow(x, 1.0 / g); }
float gamma_decode(float x, float g) { return sgn_pow(x, g); }
`;

// GLSL の数値リテラルは必ず小数点を含めます (int と float の型エラーを防ぐ)。
function f(x) {
  if (!isFinite(x)) throw new Error('GLSL に出せない数値: ' + x);
  const s = Number(x).toPrecision(9);
  return s.includes('.') || s.includes('e') ? s : s + '.0';
}

function mat3Literal(m) {
  // GLSL の mat3 は列優先。row-major の m を列優先の並びに置き換えます。
  const o = [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
  return `mat3(${o.map(f).join(', ')})`;
}

// ---------------------------------------------------------------------------
// ノードの基底
// ---------------------------------------------------------------------------

let _nodeId = 0;

export class Node {
  constructor(type) {
    this.type = type;
    this.id = ++_nodeId;
  }
  /** @param {number[]} rgb @returns {number[]} */
  applyCPU(rgb) { return rgb; }
  /** @param {string} v 変数名 @returns {string} GLSL の文 */
  emitGLSL(v) { return ''; }
  /** @returns {Node|null} 逆変換。作れない場合は null */
  inverse() { return null; }
  /** 画面に出す短い説明 */
  describe() { return this.type; }
}

// ---------------------------------------------------------------------------
// 個別のノード
// ---------------------------------------------------------------------------

export class MatrixNode extends Node {
  constructor(m, label = '行列') {
    super('matrix');
    this.m = Float64Array.from(m);
    this.label = label;
  }
  applyCPU(c) {
    const m = this.m;
    return [
      m[0] * c[0] + m[1] * c[1] + m[2] * c[2],
      m[3] * c[0] + m[4] * c[1] + m[5] * c[2],
      m[6] * c[0] + m[7] * c[1] + m[8] * c[2],
    ];
  }
  emitGLSL(v) { return `${v} = ${mat3Literal(this.m)} * ${v};`; }
  inverse() {
    // 逆行列は color.js の matInvert を使いますが、循環 import を避けて自前で持ちます。
    const [a, b, c, d, e, g, h, i, j] = this.m;
    const A = i * j - g * h, B = -(h * j - g * i), C = h * i - e * j === 0 ? 0 : 0;
    void A; void B; void C;
    return new MatrixNode(invert3(this.m), this.label + '(逆)');
  }
  describe() { return this.label; }
}

function invert3(m) {
  const [a, b, c, d, e, ff, g, h, i] = m;
  const A = e * i - ff * h, B = -(d * i - ff * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error('この行列は逆変換できません');
  const inv = 1 / det;
  return new Float64Array([
    A * inv, (c * h - b * i) * inv, (b * ff - c * e) * inv,
    B * inv, (a * i - c * g) * inv, (c * d - a * ff) * inv,
    C * inv, (b * g - a * h) * inv, (a * e - b * d) * inv,
  ]);
}

/** 色域の変換。src と dst は GAMUTS のキー。 */
export function gamutNode(src, dst) {
  if (src === dst) return new GroupNode([], `${src} のまま`);
  return new MatrixNode(gamutConversionMatrix(src, dst), `${src} → ${dst}`);
}

/** 伝達関数。direction は 'encode'(光→数値) か 'decode'(数値→光)。 */
export class TransferNode extends Node {
  constructor(name, direction = 'encode') {
    super('transfer');
    if (!TRANSFERS[name]) throw new Error(`伝達関数 "${name}" は定義されていません`);
    this.name = name;
    this.direction = direction;
  }
  applyCPU(c) {
    const fn = TRANSFERS[this.name][this.direction];
    return [fn(c[0]), fn(c[1]), fn(c[2])];
  }
  emitGLSL(v) {
    if (this.name === 'linear') return '';
    if (this.name === 'gamma22' || this.name === 'gamma24') {
      const g = this.name === 'gamma22' ? 2.2 : 2.4;
      const fn = this.direction === 'encode' ? 'gamma_encode' : 'gamma_decode';
      return `${v} = vec3(${fn}(${v}.r, ${f(g)}), ${fn}(${v}.g, ${f(g)}), ${fn}(${v}.b, ${f(g)}));`;
    }
    const fn = `${this.name}_${this.direction}`;
    return `${v} = vec3(${fn}(${v}.r), ${fn}(${v}.g), ${fn}(${v}.b));`;
  }
  inverse() {
    return new TransferNode(this.name, this.direction === 'encode' ? 'decode' : 'encode');
  }
  describe() {
    const t = TRANSFERS[this.name];
    return this.direction === 'encode' ? `${t.label} で数値にする` : `${t.label} から光にもどす`;
  }
}

/** 露出。段 (EV) 単位。リニア空間で使います。 */
export class ExposureNode extends Node {
  constructor(stops = 0) { super('exposure'); this.stops = stops; }
  get gain() { return Math.pow(2, this.stops); }
  applyCPU(c) { const g = this.gain; return [c[0] * g, c[1] * g, c[2] * g]; }
  emitGLSL(v) { return `${v} *= ${f(this.gain)};`; }
  inverse() { return new ExposureNode(-this.stops); }
  describe() { return `露出 ${this.stops >= 0 ? '+' : ''}${this.stops} EV`; }
}

/** ASC CDL。slope / offset / power / saturation。 */
export class CDLNode extends Node {
  constructor({ slope = [1, 1, 1], offset = [0, 0, 0], power = [1, 1, 1], sat = 1, gamut = 'AP1' } = {}) {
    super('cdl');
    this.slope = slope; this.offset = offset; this.power = power; this.sat = sat;
    this.lw = luminanceWeights(gamut);
  }
  applyCPU(c) {
    const out = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const x = c[i] * this.slope[i] + this.offset[i];
      out[i] = x < 0 ? 0 : Math.pow(x, this.power[i]);
    }
    if (this.sat !== 1) {
      const l = out[0] * this.lw[0] + out[1] * this.lw[1] + out[2] * this.lw[2];
      for (let i = 0; i < 3; i++) out[i] = l + this.sat * (out[i] - l);
    }
    return out;
  }
  emitGLSL(v) {
    const s = `vec3(${this.slope.map(f).join(', ')})`;
    const o = `vec3(${this.offset.map(f).join(', ')})`;
    const p = `vec3(${this.power.map(f).join(', ')})`;
    const w = `vec3(${this.lw.map(f).join(', ')})`;
    return [
      `${v} = max(vec3(0.0), ${v} * ${s} + ${o});`,
      `${v} = pow(${v}, ${p});`,
      `${v} = mix(vec3(dot(${v}, ${w})), ${v}, ${f(this.sat)});`,
    ].join('\n  ');
  }
  inverse() { return null; } // べき乗とクリップが入るため一般には戻せません
  describe() { return 'CDL(味付け)'; }
}

/** 彩度だけを変える。グレーディング用のかんたんな部品。 */
export class SaturationNode extends Node {
  constructor(sat = 1, gamut = 'AP1') { super('saturation'); this.sat = sat; this.lw = luminanceWeights(gamut); }
  applyCPU(c) {
    const l = c[0] * this.lw[0] + c[1] * this.lw[1] + c[2] * this.lw[2];
    return [l + this.sat * (c[0] - l), l + this.sat * (c[1] - l), l + this.sat * (c[2] - l)];
  }
  emitGLSL(v) {
    const w = `vec3(${this.lw.map(f).join(', ')})`;
    return `${v} = mix(vec3(dot(${v}, ${w})), ${v}, ${f(this.sat)});`;
  }
  inverse() { return this.sat === 0 ? null : new SaturationNode(1 / this.sat); }
  describe() { return `彩度 ×${this.sat}`; }
}

export class ClampNode extends Node {
  constructor(lo = 0, hi = 1) { super('clamp'); this.lo = lo; this.hi = hi; }
  applyCPU(c) { return [clamp(c[0], this.lo, this.hi), clamp(c[1], this.lo, this.hi), clamp(c[2], this.lo, this.hi)]; }
  emitGLSL(v) { return `${v} = clamp(${v}, vec3(${f(this.lo)}), vec3(${f(this.hi)}));`; }
  inverse() { return null; } // 捨てた情報は戻りません
  describe() { return `${this.lo} 〜 ${this.hi} に切りそろえる`; }
}

export class GroupNode extends Node {
  constructor(children = [], label = 'まとめ') {
    super('group');
    this.children = children.filter(Boolean);
    this.label = label;
  }
  applyCPU(c) {
    let v = c;
    for (const n of this.children) v = n.applyCPU(v);
    return v;
  }
  emitGLSL(v) {
    return this.children.map((n) => n.emitGLSL(v)).filter(Boolean).join('\n  ');
  }
  inverse() {
    const inv = [];
    for (let i = this.children.length - 1; i >= 0; i--) {
      const n = this.children[i].inverse();
      if (!n) return null;
      inv.push(n);
    }
    return new GroupNode(inv, this.label + '(逆)');
  }
  describe() { return this.label; }
  flatten() {
    const out = [];
    for (const n of this.children) {
      if (n instanceof GroupNode) out.push(...n.flatten());
      else out.push(n);
    }
    return out;
  }
}


// ---------------------------------------------------------------------------
// config.ocio に出てくる変換のためのノード
// ---------------------------------------------------------------------------

/** ExponentTransform。順方向は x の value 乗(曲げをほどく向き)です。 */
export class PowerNode extends Node {
  constructor(value = [2.2, 2.2, 2.2], direction = 'forward') {
    super('power');
    this.value = value.slice(0, 3);
    this.direction = direction;
  }
  get exps() {
    return this.direction === 'forward' ? this.value : this.value.map((v) => 1 / v);
  }
  applyCPU(c) {
    const e = this.exps;
    return c.map((x, i) => (x < 0 ? -Math.pow(-x, e[i]) : Math.pow(x, e[i])));
  }
  emitGLSL(v) {
    const e = this.exps;
    return `${v} = vec3(sgn_pow(${v}.r, ${f(e[0])}), sgn_pow(${v}.g, ${f(e[1])}), sgn_pow(${v}.b, ${f(e[2])}));`;
  }
  inverse() {
    return new PowerNode(this.value, this.direction === 'forward' ? 'inverse' : 'forward');
  }
  describe() { return `${this.direction === 'forward' ? '' : '逆に'}${this.value[0]} 乗する`; }
}

/**
 * ExponentWithLinearTransform。sRGB のような「暗い側だけ直線」の曲線です。
 * 順方向は 数値 → 光の量。
 *   さかい目 xbrk = offset / (gamma - 1)
 *   直線部分の傾き scale = ((1+offset)/gamma)^gamma × (gamma-1)^(gamma-1) / offset^(gamma-1)
 * gamma=2.4, offset=0.055 のとき、傾きは約 12.93 になり sRGB とほぼ同じ形です。
 */
export class MonitorCurveNode extends Node {
  constructor(gamma = 2.4, offset = 0.055, direction = 'forward') {
    super('monitor_curve');
    this.gamma = gamma;
    this.offset = offset;
    this.direction = direction;
    this.xbrk = offset / (gamma - 1);
    this.scale = Math.pow((1 + offset) / gamma, gamma)
      * Math.pow(gamma - 1, gamma - 1) / Math.pow(offset, gamma - 1);
    this.ybrk = this.xbrk / this.scale;
  }
  _fwd(x) {
    const a = Math.abs(x);
    const y = a >= this.xbrk ? Math.pow((a + this.offset) / (1 + this.offset), this.gamma) : a / this.scale;
    return x < 0 ? -y : y;
  }
  _inv(y) {
    const a = Math.abs(y);
    const x = a >= this.ybrk ? (1 + this.offset) * Math.pow(a, 1 / this.gamma) - this.offset : a * this.scale;
    return y < 0 ? -x : x;
  }
  applyCPU(c) {
    const fn = this.direction === 'forward' ? (x) => this._fwd(x) : (x) => this._inv(x);
    return c.map(fn);
  }
  emitGLSL(v) {
    const g = f(this.gamma), o = f(this.offset), sc = f(this.scale);
    if (this.direction === 'forward') {
      return `${v} = mix(abs(${v}) / ${sc}, pow((abs(${v}) + vec3(${o})) / ${f(1 + this.offset)}, vec3(${g})), step(vec3(${f(this.xbrk)}), abs(${v}))) * sign(${v});`;
    }
    return `${v} = mix(abs(${v}) * ${sc}, ${f(1 + this.offset)} * pow(abs(${v}), vec3(${f(1 / this.gamma)})) - vec3(${o}), step(vec3(${f(this.ybrk)}), abs(${v}))) * sign(${v});`;
  }
  inverse() {
    return new MonitorCurveNode(this.gamma, this.offset,
      this.direction === 'forward' ? 'inverse' : 'forward');
  }
  describe() { return `直線部分つきの ${this.gamma} 乗の曲線`; }
}

/**
 * LogAffineTransform / LogCameraTransform。
 * 順方向は 光の量 → 対数の数値。
 *   out = logSideSlope × log_base(linSideSlope × x + linSideOffset) + logSideOffset
 * linSideBreak を指定すると、それより暗い側は直線でつなぎます(LogCameraTransform)。
 */
export class LogAffineNode extends Node {
  constructor(o = {}, direction = 'forward') {
    super('log_affine');
    this.base = o.base === undefined ? 2 : o.base;
    this.logSideSlope = o.logSideSlope === undefined ? 1 : o.logSideSlope;
    this.logSideOffset = o.logSideOffset === undefined ? 0 : o.logSideOffset;
    this.linSideSlope = o.linSideSlope === undefined ? 1 : o.linSideSlope;
    this.linSideOffset = o.linSideOffset === undefined ? 0 : o.linSideOffset;
    this.linSideBreak = o.linSideBreak;
    this.direction = direction;
    if (this.linSideBreak !== undefined) {
      // さかい目でなめらかにつながるように、直線部分の傾きと切片を求めます。
      const b = this.linSideBreak;
      const lb = Math.log(this.base);
      const inner = this.linSideSlope * b + this.linSideOffset;
      this.logBreak = this.logSideSlope * (Math.log(inner) / lb) + this.logSideOffset;
      this.linearSlope = o.linearSlope === undefined
        ? this.logSideSlope * this.linSideSlope / (inner * lb)
        : o.linearSlope;
      this.linearOffset = this.logBreak - this.linearSlope * b;
    }
  }
  _fwd(x) {
    if (this.linSideBreak !== undefined && x <= this.linSideBreak) {
      return this.linearSlope * x + this.linearOffset;
    }
    const inner = this.linSideSlope * x + this.linSideOffset;
    if (inner <= 0) return -1e6;
    return this.logSideSlope * (Math.log(inner) / Math.log(this.base)) + this.logSideOffset;
  }
  _inv(y) {
    if (this.linSideBreak !== undefined && y <= this.logBreak) {
      return (y - this.linearOffset) / this.linearSlope;
    }
    const p = (y - this.logSideOffset) / this.logSideSlope;
    return (Math.pow(this.base, p) - this.linSideOffset) / this.linSideSlope;
  }
  applyCPU(c) {
    const fn = this.direction === 'forward' ? (x) => this._fwd(x) : (x) => this._inv(x);
    return c.map(fn);
  }
  emitGLSL(v) {
    const lb = f(Math.log(this.base));
    const lss = f(this.logSideSlope), lso = f(this.logSideOffset);
    const nss = f(this.linSideSlope), nso = f(this.linSideOffset);
    if (this.direction === 'forward') {
      const core = `(${lss} * (log(max(vec3(1e-10), ${nss} * ${v} + vec3(${nso}))) / ${lb}) + vec3(${lso}))`;
      if (this.linSideBreak === undefined) return `${v} = ${core};`;
      return `${v} = mix(${f(this.linearSlope)} * ${v} + vec3(${f(this.linearOffset)}), ${core}, step(vec3(${f(this.linSideBreak)}), ${v}));`;
    }
    const core = `((pow(vec3(${f(this.base)}), (${v} - vec3(${lso})) / ${lss}) - vec3(${nso})) / ${nss})`;
    if (this.linSideBreak === undefined) return `${v} = ${core};`;
    return `${v} = mix((${v} - vec3(${f(this.linearOffset)})) / ${f(this.linearSlope)}, ${core}, step(vec3(${f(this.logBreak)}), ${v}));`;
  }
  inverse() {
    const o = {
      base: this.base, logSideSlope: this.logSideSlope, logSideOffset: this.logSideOffset,
      linSideSlope: this.linSideSlope, linSideOffset: this.linSideOffset,
      linSideBreak: this.linSideBreak, linearSlope: this.linearSlope,
    };
    return new LogAffineNode(o, this.direction === 'forward' ? 'inverse' : 'forward');
  }
  describe() { return '対数のカーブ'; }
}

/** RangeTransform。範囲を移しかえます。クランプありのときは逆変換を作れません。 */
export class RangeNode extends Node {
  constructor(o = {}) {
    super('range');
    this.minIn = o.minInValue;
    this.maxIn = o.maxInValue;
    this.minOut = o.minOutValue;
    this.maxOut = o.maxOutValue;
    this.noClamp = o.style === 'noClamp';
    const hasAll = [this.minIn, this.maxIn, this.minOut, this.maxOut].every((x) => x !== undefined);
    this.scale = hasAll ? (this.maxOut - this.minOut) / (this.maxIn - this.minIn) : 1;
    this.shift = hasAll ? this.minOut - this.minIn * this.scale : 0;
  }
  applyCPU(c) {
    return c.map((x) => {
      let y = x * this.scale + this.shift;
      if (!this.noClamp) {
        if (this.minOut !== undefined) y = Math.max(this.minOut, y);
        if (this.maxOut !== undefined) y = Math.min(this.maxOut, y);
      }
      return y;
    });
  }
  emitGLSL(v) {
    const lines = [`${v} = ${v} * ${f(this.scale)} + vec3(${f(this.shift)});`];
    if (!this.noClamp) {
      if (this.minOut !== undefined) lines.push(`${v} = max(${v}, vec3(${f(this.minOut)}));`);
      if (this.maxOut !== undefined) lines.push(`${v} = min(${v}, vec3(${f(this.maxOut)}));`);
    }
    return lines.join('\n  ');
  }
  inverse() {
    if (!this.noClamp) return null; // 切りそろえた情報は戻せません
    return new RangeNode({
      minInValue: this.minOut, maxInValue: this.maxOut,
      minOutValue: this.minIn, maxOutValue: this.maxIn, style: 'noClamp',
    });
  }
  describe() { return '範囲を移しかえる'; }
}

// ---------------------------------------------------------------------------
// 学習用の出力変換 (Output Transform)
//
// 【重要】これは本物の ACES の出力変換ではありません。学習用の簡略版です。
// 挙動の傾向 (中間グレーの落ち着き先、ハイライトのなだらかな丸め、
// 明るいところが白に寄っていく感じ) だけを再現しています。
//
// 式: nit_c = P * (1 - exp(-(G / (0.18 * P)) * x_c))     ※ R,G,B それぞれに独立して適用
//   x_c : シーンリニア値 (AP1)
//   G   : 中間グレー 0.18 を何 nit に置くか
//   P   : その出力のピーク輝度 (nit)
// 性質:
//   - 暗いところは光の量にほぼ比例する (傾き G/0.18)
//   - 明るいところは P になめらかに近づき、決して超えない
//   - チャンネルごとに独立なので、明るい色は自然に白へ寄る
// ---------------------------------------------------------------------------

/** 8bit などの段階に丸めます。JPEG に焼いたときの粗さを見せるのに使います。 */
export class QuantizeNode extends Node {
  constructor(levels = 255) { super('quantize'); this.levels = levels; }
  applyCPU(c) {
    const n = this.levels;
    return c.map((x) => Math.round(clamp(x, 0, 1) * n) / n);
  }
  emitGLSL(v) {
    return `${v} = floor(clamp(${v}, vec3(0.0), vec3(1.0)) * ${f(this.levels)} + 0.5) / ${f(this.levels)};`;
  }
  inverse() { return null; } // 丸めた情報は戻りません
  describe() { return `${this.levels + 1} 段階に丸める`; }
}

export class ToneMapNode extends Node {
  constructor(greyNits = 10, peakNits = 100) {
    super('tonemap');
    this.greyNits = greyNits;
    this.peakNits = peakNits;
  }
  get a() { return this.greyNits / (0.18 * this.peakNits); }
  applyCPU(c) {
    const a = this.a, P = this.peakNits;
    return c.map((x) => P * (1 - Math.exp(-a * Math.max(0, x))));
  }
  emitGLSL(v) {
    return `${v} = ${f(this.peakNits)} * (vec3(1.0) - exp(-${f(this.a)} * max(vec3(0.0), ${v})));`;
  }
  inverse() { return null; }
  describe() { return `トーンマップ(グレー ${this.greyNits} nit / ピーク ${this.peakNits} nit)`; }
}

/** 絶対輝度 (nit) を、その出力方式のコード値 0..1 にします。 */
export class NitsToCodeNode extends Node {
  constructor(encoding = 'srgb', peakNits = 100) {
    super('nits_to_code');
    this.encoding = encoding;
    this.peakNits = peakNits;
  }
  applyCPU(c) {
    const { encoding, peakNits } = this;
    if (encoding === 'pq') {
      return c.map((n) => TRANSFERS.pq.encode(clamp(n, 0, 10000) / 10000));
    }
    if (encoding === 'hlg') {
      return c.map((n) => TRANSFERS.hlg.encode(clamp(n / peakNits, 0, 1)));
    }
    const t = TRANSFERS[encoding] || TRANSFERS.srgb;
    return c.map((n) => t.encode(clamp(n / 100, 0, 1)));
  }
  emitGLSL(v) {
    if (this.encoding === 'pq') {
      return [
        `${v} = clamp(${v}, vec3(0.0), vec3(10000.0)) / 10000.0;`,
        `${v} = vec3(pq_encode(${v}.r), pq_encode(${v}.g), pq_encode(${v}.b));`,
      ].join('\n  ');
    }
    if (this.encoding === 'hlg') {
      return [
        `${v} = clamp(${v} / ${f(this.peakNits)}, vec3(0.0), vec3(1.0));`,
        `${v} = vec3(hlg_encode(${v}.r), hlg_encode(${v}.g), hlg_encode(${v}.b));`,
      ].join('\n  ');
    }
    const name = TRANSFERS[this.encoding] ? this.encoding : 'srgb';
    return [
      `${v} = clamp(${v} / 100.0, vec3(0.0), vec3(1.0));`,
      `${v} = vec3(${name}_encode(${v}.r), ${name}_encode(${v}.g), ${name}_encode(${v}.b));`,
    ].join('\n  ');
  }
  inverse() { return null; }
  describe() { return `${this.encoding} で書き出す`; }
}

/**
 * 学習用の出力変換を組み立てます。
 * @param {object} o
 * @param {string} o.working  作業色域 (既定: AP1)
 * @param {string} o.display  表示色域 (Rec709 / sRGB / P3D65 / Rec2020)
 * @param {string} o.encoding srgb / rec709 / pq / hlg
 * @param {number} o.peakNits ピーク輝度
 * @param {number} o.greyNits 中間グレーの落ち着き先
 */
export function buildOutputTransform({
  working = 'AP1', display = 'Rec709', encoding = 'srgb',
  peakNits = 100, greyNits = 10,
} = {}) {
  return new GroupNode([
    new ToneMapNode(greyNits, peakNits),
    gamutNode(working, display),
    new NitsToCodeNode(encoding, peakNits),
  ], '出力変換(学習用の簡略版)');
}

/** サイトで使う出力プリセット。第10章の I-13 はここを切り替えます。 */
export const OUTPUT_PRESETS = {
  sdr100: {
    label: 'SDR 100 nit (sRGB)',
    short: 'SDR',
    note: '今までの映像。パソコンやスマホの標準',
    opts: { display: 'sRGB', encoding: 'srgb', peakNits: 100, greyNits: 10 },
  },
  sdr709: {
    label: 'SDR 100 nit (Rec.709)',
    short: 'SDR 709',
    note: 'ハイビジョンテレビ向け',
    opts: { display: 'Rec709', encoding: 'rec709', peakNits: 100, greyNits: 10 },
  },
  hdr1000: {
    label: 'HDR 1000 nit (PQ)',
    short: 'HDR 1000',
    note: '一般的なHDRテレビ',
    opts: { display: 'Rec2020', encoding: 'pq', peakNits: 1000, greyNits: 12 },
  },
  hdr4000: {
    label: 'HDR 4000 nit (PQ)',
    short: 'HDR 4000',
    note: 'とても明るいHDRディスプレイ',
    opts: { display: 'Rec2020', encoding: 'pq', peakNits: 4000, greyNits: 14 },
  },
  hlg1000: {
    label: 'HLG (放送向け)',
    short: 'HLG',
    note: '放送で使うHDRの方式',
    opts: { display: 'Rec2020', encoding: 'hlg', peakNits: 1000, greyNits: 12 },
  },
};

/**
 * 絶対輝度 (nit) を、SDR の画面で「HDR っぽく」見せるための圧縮。
 *
 * 【本物の HDR ではありません】SDR の画面は 100 nit までしか出せないので、
 * HDR の全域を 0〜1 に押しこんで見せています。
 * 使う画面には必ず「擬似表示です」と表示してください。
 *
 * 100 nit までは素直に(そのぶんだけ少し暗く)、
 * 100 nit からピークまでは対数で、残りの明るさに割りあてます。
 *   nit ≦ 100      : y = (nit / 100) × lowShare
 *   nit > 100       : y = lowShare + (1 - lowShare) × log2(nit/100) / log2(peak/100)
 */
export class HDRPreviewNode extends Node {
  constructor(peakNits = 1000, lowShare = 0.72) {
    super('hdr_preview');
    this.peakNits = Math.max(101, peakNits);
    this.lowShare = lowShare;
    this.span = Math.log2(this.peakNits / 100);
  }
  applyCPU(c) {
    return c.map((n) => {
      const x = Math.max(0, n) / 100;
      if (x <= 1) return x * this.lowShare;
      return this.lowShare + (1 - this.lowShare) * Math.log2(x) / this.span;
    });
  }
  emitGLSL(v) {
    return [
      `${v} = max(vec3(0.0), ${v}) / 100.0;`,
      `${v} = mix(${v} * ${f(this.lowShare)}, vec3(${f(this.lowShare)}) + ${f(1 - this.lowShare)} * log(max(${v}, vec3(1.0))) / log(2.0) / ${f(this.span)}, step(vec3(1.0), ${v}));`,
    ].join('\n  ');
  }
  inverse() { return null; }
  describe() { return `HDR の擬似表示(ピーク ${this.peakNits} nit を画面いっぱいに割りあて)`; }
}

/**
 * PQ で書き出された数値を、SDR の画面で見るための後処理。
 * PQ をほどいて nit にもどし、そこから擬似的に圧縮して sRGB にします。
 */
export function buildPQPreview({ gamut = 'Rec2020', peakNits = 1000 } = {}) {
  return new GroupNode([
    new TransferNode('pq', 'decode'),
    new ExposureNode(Math.log2(10000)),   // 0..1 を nit にもどす
    gamutNode(gamut, 'sRGB'),
    new HDRPreviewNode(peakNits),
    new ClampNode(0, 1),
    new TransferNode('srgb', 'encode'),
  ], 'HDR を SDR 画面で見るための擬似表示');
}

/**
 * HDR 非対応の画面で HDR の見え方を「ふんいき」だけ見せるための変換。
 * 本物ではありません。使う画面には必ずその旨を表示してください。
 */
export function buildHDRPreviewTransform({ working = 'AP1', peakNits = 1000, greyNits = 12 } = {}) {
  return new GroupNode([
    new ToneMapNode(greyNits, peakNits),
    gamutNode(working, 'sRGB'),
    new HDRPreviewNode(peakNits),
    new ClampNode(0, 1),
    new TransferNode('srgb', 'encode'),
  ], 'HDR 擬似プレビュー');
}

// ---------------------------------------------------------------------------
// チェーン: ノードの列をまとめて扱い、シェーダ本体を作ります。
// ---------------------------------------------------------------------------

export class TransformChain {
  constructor(nodes = []) {
    this.nodes = nodes.filter(Boolean);
  }
  static of(...nodes) { return new TransformChain(nodes); }
  add(n) { if (n) this.nodes.push(n); return this; }
  applyCPU(rgb) {
    let v = rgb;
    for (const n of this.nodes) v = n.applyCPU(v);
    return v;
  }
  /** GLSL の関数本体。`vec3 c` を受け取り `c` を返す形に埋め込みます。 */
  emitGLSLBody(varName = 'c') {
    const lines = this.nodes.map((n) => n.emitGLSL(varName)).filter(Boolean);
    return lines.length ? '  ' + lines.join('\n  ') : '';
  }
  /** 変換の中身を人が読める形で並べます。UI の「もっとくわしく」で使います。 */
  describe() {
    const out = [];
    for (const n of this.nodes) {
      if (n instanceof GroupNode) out.push(...n.flatten().map((x) => x.describe()));
      else out.push(n.describe());
    }
    return out;
  }
  /** シェーダ再コンパイルの要否を判定するための鍵。 */
  key(varName = 'c') { return this.emitGLSLBody(varName); }
}
