// render.js — シーンリニアの画像に色変換をかけて画面に出します。
//
// 第一手段は WebGL2。使えない環境では Canvas 2D + CPU で同じ結果を出します。
// どちらも transforms.js の同じノード列から生やすので、結果は一致します。

import { GLSL_PRELUDE } from './transforms.js';

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  vUV.y = 1.0 - vUV.y;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

function fragSource(bodyA, bodyB) {
  return `#version 300 es
precision highp float;
uniform sampler2D uImage;
uniform float uDiffGain;
uniform int uMode;        // 0=A, 1=B, 2=差分, 3=左右分割
uniform float uSplit;     // 分割位置 0..1
uniform int uZebra;       // 1 のとき白飛びに斜線
in vec2 vUV;
out vec4 fragColor;
${GLSL_PRELUDE}
vec3 transformA(vec3 c) {
${bodyA}
  return c;
}
vec3 transformB(vec3 c) {
${bodyB}
  return c;
}
void main() {
  vec3 src = texture(uImage, vUV).rgb;
  vec3 a = transformA(src);
  vec3 b = transformB(src);
  vec3 outc;
  if (uMode == 0) outc = a;
  else if (uMode == 1) outc = b;
  else if (uMode == 2) outc = clamp(abs(a - b) * uDiffGain, 0.0, 1.0);
  else outc = vUV.x < uSplit ? a : b;
  if (uZebra == 1 && (outc.r > 0.996 || outc.g > 0.996 || outc.b > 0.996)) {
    float s = mod(gl_FragCoord.x + gl_FragCoord.y, 12.0);
    if (s < 6.0) outc = vec3(1.0, 0.15, 0.15);
  }
  fragColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
}`;
}

/** シーンリニアの画像。data は RGB の3成分ずつ。 */
export class FloatImage {
  constructor(width, height, data = null, gamut = 'AP1') {
    this.width = width;
    this.height = height;
    this.data = data || new Float32Array(width * height * 3);
    this.gamut = gamut;
  }
  /** 座標 (x, y) のシーンリニア値。範囲外は端の値を返します。 */
  sample(x, y) {
    const xi = Math.min(this.width - 1, Math.max(0, Math.round(x)));
    const yi = Math.min(this.height - 1, Math.max(0, Math.round(y)));
    const i = (yi * this.width + xi) * 3;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }
  set(x, y, rgb) {
    const i = (y * this.width + x) * 3;
    this.data[i] = rgb[0]; this.data[i + 1] = rgb[1]; this.data[i + 2] = rgb[2];
  }
  clone() {
    return new FloatImage(this.width, this.height, this.data.slice(), this.gamut);
  }
}

const EMPTY_BODY = '';

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{maxCPUSize?: number}} [opts]
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.maxCPUSize = opts.maxCPUSize || 512;
    this.programs = new Map();
    this.image = null;
    this.gl = null;
    this.backend = 'none';
    this._initGL();
    if (!this.gl) this._initCPU();
  }

  get usesGPU() { return this.backend === 'webgl2'; }

  _initGL() {
    let gl = null;
    try {
      gl = this.canvas.getContext('webgl2', {
        alpha: false, antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false,
      });
    } catch (e) { gl = null; }
    if (!gl) return;
    this.gl = gl;
    this.backend = 'webgl2';
    this.linearFilter = !!gl.getExtension('OES_texture_float_linear');

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.vao = vao;
    this.quadBuffer = buf;
    this.texture = gl.createTexture();
  }

  _initCPU() {
    this.backend = 'cpu';
    this.ctx = this.canvas.getContext('2d');
  }

  _compile(bodyA, bodyB) {
    const key = bodyA + ' | ' + bodyB;
    if (this.programs.has(key)) return this.programs.get(key);
    const gl = this.gl;
    const make = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        console.error('シェーダのコンパイルに失敗しました', log, src);
        throw new Error('シェーダのコンパイルに失敗しました: ' + log);
      }
      return sh;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, make(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, make(gl.FRAGMENT_SHADER, fragSource(bodyA, bodyB)));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('シェーダのリンクに失敗しました: ' + gl.getProgramInfoLog(prog));
    }
    const info = {
      prog,
      uImage: gl.getUniformLocation(prog, 'uImage'),
      uDiffGain: gl.getUniformLocation(prog, 'uDiffGain'),
      uMode: gl.getUniformLocation(prog, 'uMode'),
      uSplit: gl.getUniformLocation(prog, 'uSplit'),
      uZebra: gl.getUniformLocation(prog, 'uZebra'),
    };
    this.programs.set(key, info);
    return info;
  }

  /** 表示する画像を差し替えます。 */
  setImage(image) {
    this.image = image;
    if (this.backend === 'webgl2') {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      // RGB32F は多くの実装で使えないため、RGBA に詰め替えます。
      const n = image.width * image.height;
      const rgba = new Float32Array(n * 4);
      for (let i = 0, j = 0; i < n; i++, j += 3) {
        rgba[i * 4] = image.data[j];
        rgba[i * 4 + 1] = image.data[j + 1];
        rgba[i * 4 + 2] = image.data[j + 2];
        rgba[i * 4 + 3] = 1;
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, image.width, image.height, 0, gl.RGBA, gl.FLOAT, rgba);
      const filt = this.linearFilter ? gl.LINEAR : gl.NEAREST;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    return this;
  }

  /**
   * 描画します。
   * @param {object} o
   * @param {import('./transforms.js').TransformChain} o.chainA
   * @param {import('./transforms.js').TransformChain} [o.chainB]
   * @param {'A'|'B'|'diff'|'split'} [o.mode]
   * @param {number} [o.diffGain]
   * @param {number} [o.split]
   * @param {boolean} [o.zebra]
   */
  draw({ chainA, chainB = null, mode = 'A', diffGain = 8, split = 0.5, zebra = false }) {
    if (!this.image) return;
    const table = { A: 0, B: 1, diff: 2, split: 3 };
    const modeIndex = table[mode] === undefined ? 0 : table[mode];
    if (this.backend === 'webgl2') {
      this._drawGL(chainA, chainB, modeIndex, diffGain, split, zebra);
    } else {
      this._drawCPU(chainA, chainB, modeIndex, diffGain, split, zebra);
    }
  }

  _drawGL(chainA, chainB, modeIndex, diffGain, split, zebra) {
    const gl = this.gl;
    const bodyA = chainA ? chainA.emitGLSLBody('c') : EMPTY_BODY;
    const bodyB = chainB ? chainB.emitGLSLBody('c') : bodyA;
    const p = this._compile(bodyA, bodyB);
    const w = this.canvas.width, h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    gl.useProgram(p.prog);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(p.uImage, 0);
    gl.uniform1f(p.uDiffGain, diffGain);
    gl.uniform1i(p.uMode, modeIndex);
    gl.uniform1f(p.uSplit, split);
    gl.uniform1i(p.uZebra, zebra ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  _drawCPU(chainA, chainB, modeIndex, diffGain, split, zebra) {
    const img = this.image;
    const scale = Math.min(1, this.maxCPUSize / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    this.canvas.width = w;
    this.canvas.height = h;
    const out = this.ctx.createImageData(w, h);
    const px = out.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const src = img.sample(x / scale, y / scale);
        const a = chainA ? chainA.applyCPU(src) : src;
        const b = chainB ? chainB.applyCPU(src) : a;
        let c;
        if (modeIndex === 0) c = a;
        else if (modeIndex === 1) c = b;
        else if (modeIndex === 2) c = [
          Math.abs(a[0] - b[0]) * diffGain,
          Math.abs(a[1] - b[1]) * diffGain,
          Math.abs(a[2] - b[2]) * diffGain,
        ];
        else c = x / w < split ? a : b;
        let r = c[0], g = c[1], bl = c[2];
        if (zebra && (r > 0.996 || g > 0.996 || bl > 0.996) && (x + y) % 12 < 6) {
          r = 1; g = 0.15; bl = 0.15;
        }
        const i = (y * w + x) * 4;
        px[i] = Math.round(Math.min(1, Math.max(0, r)) * 255);
        px[i + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
        px[i + 2] = Math.round(Math.min(1, Math.max(0, bl)) * 255);
        px[i + 3] = 255;
      }
    }
    this.ctx.putImageData(out, 0, 0);
  }

  /** キャンバスの解像度を要素の表示サイズに合わせます。 */
  resizeToDisplay(maxWidth = 1024) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.min(maxWidth, Math.round(rect.width * dpr));
    const aspect = this.image ? this.image.height / this.image.width : 9 / 16;
    const h = Math.round(w * aspect);
    if (this.canvas.width === w && this.canvas.height === h) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    return true;
  }

  dispose() {
    if (this.backend === 'webgl2') {
      const gl = this.gl;
      for (const p of this.programs.values()) gl.deleteProgram(p.prog);
      this.programs.clear();
      gl.deleteTexture(this.texture);
      gl.deleteBuffer(this.quadBuffer);
      gl.deleteVertexArray(this.vao);
    }
  }
}

/**
 * 画像を CPU で変換して新しい FloatImage を返します。
 * ぼかしや合成など、変換のあとにさらに画像処理をする部品で使います。
 */
export function mapImage(image, fn) {
  const out = new FloatImage(image.width, image.height, null, image.gamut);
  for (let i = 0; i < image.data.length; i += 3) {
    const c = fn([image.data[i], image.data[i + 1], image.data[i + 2]]);
    out.data[i] = c[0]; out.data[i + 1] = c[1]; out.data[i + 2] = c[2];
  }
  return out;
}

/** ガウスぼかし。半径はピクセル。第5章のリニア合成ラボで使います。 */
export function blur(image, radius) {
  if (radius <= 0) return image.clone();
  const sigma = radius / 2;
  const r = Math.ceil(radius);
  const k = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(v); sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const w = image.width, h = image.height;
  const tmp = new Float32Array(w * h * 3);
  const out = new FloatImage(w, h, null, image.gamut);
  // 横方向
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0, b = 0, c = 0;
      for (let i = -r; i <= r; i++) {
        const xi = Math.min(w - 1, Math.max(0, x + i));
        const j = (y * w + xi) * 3, kk = k[i + r];
        a += image.data[j] * kk; b += image.data[j + 1] * kk; c += image.data[j + 2] * kk;
      }
      const o = (y * w + x) * 3;
      tmp[o] = a; tmp[o + 1] = b; tmp[o + 2] = c;
    }
  }
  // 縦方向
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0, b = 0, c = 0;
      for (let i = -r; i <= r; i++) {
        const yi = Math.min(h - 1, Math.max(0, y + i));
        const j = (yi * w + x) * 3, kk = k[i + r];
        a += tmp[j] * kk; b += tmp[j + 1] * kk; c += tmp[j + 2] * kk;
      }
      const o = (y * w + x) * 3;
      out.data[o] = a; out.data[o + 1] = b; out.data[o + 2] = c;
    }
  }
  return out;
}

/** 単純な平均縮小。第5章の「縮小」の比較で使います。 */
export function downsample(image, factor) {
  const w = Math.max(1, Math.floor(image.width / factor));
  const h = Math.max(1, Math.floor(image.height / factor));
  const out = new FloatImage(w, h, null, image.gamut);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0, b = 0, c = 0, n = 0;
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const px = Math.min(image.width - 1, x * factor + sx);
          const py = Math.min(image.height - 1, y * factor + sy);
          const j = (py * image.width + px) * 3;
          a += image.data[j]; b += image.data[j + 1]; c += image.data[j + 2]; n++;
        }
      }
      out.set(x, y, [a / n, b / n, c / n]);
    }
  }
  return out;
}
