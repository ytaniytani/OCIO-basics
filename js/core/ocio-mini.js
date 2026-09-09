// ocio-mini.js — config.ocio を読んで、そのとおりに色を変換する学習用のしくみ。
//
// 【はっきり書いておきます】
// これは OpenColorIO 本体の代わりではありません。学習用の縮小版です。
// 対応している範囲は docs/OCIO-ENGINE.md に書いてあります。
// 対応していない書きかたは、黙って無視せず、必ずエラーとして表示します。
//
// このエンジンでは、基準になる色空間(reference)を
// 「ACEScg (AP1) のシーンリニア」として扱います。教材の画像がその形だからです。

import { parseYAML, YamlError } from './yaml-mini.js';
import {
  TransformChain, GroupNode, MatrixNode, PowerNode, MonitorCurveNode, LogAffineNode,
  RangeNode, CDLNode, SaturationNode, ClampNode, gamutNode, buildOutputTransform,
  OUTPUT_PRESETS, TransferNode,
} from './transforms.js';

/** 基準の色空間。教材の画像はこの形で持っています。 */
export const REFERENCE_GAMUT = 'AP1';

export class ConfigError extends Error {
  constructor(line, problem, fixes = []) {
    super(`${line}行目: ${problem}`);
    this.name = 'ConfigError';
    this.line = line;
    this.problem = problem;
    this.fixes = fixes;
  }
  toDisplay() {
    const body = this.fixes.map((f) => `  → ${f}`).join('\n');
    return `${this.line}行目: ${this.problem}` + (body ? '\n' + body : '');
  }
}

// ---------------------------------------------------------------------------
// このサイトだけで使える BuiltinTransform
// ---------------------------------------------------------------------------

/**
 * 対応している BuiltinTransform の style。
 * "LEARNING - " で始まるものは、このサイト専用の簡略版です。
 * 本物の OpenColorIO では動きません。エディタ上でもその旨を表示します。
 */
export const BUILTIN_STYLES = {
  'ACEScg_to_ACES2065-1': {
    note: 'ACEScg (AP1) から ACES2065-1 (AP0) へ',
    make: () => gamutNode('AP1', 'AP0'),
  },
  'ACEScct_to_ACES2065-1': {
    note: 'ACEScct から ACES2065-1 へ',
    make: () => new GroupNode([
      new TransferNode('acescct', 'decode'),
      gamutNode('AP1', 'AP0'),
    ], 'ACEScct → ACES2065-1'),
  },
  'UTILITY - ACES-AP0_to_CIE-XYZ-D65_BFD': {
    note: 'ACES2065-1 から CIE XYZ (D65) へ',
    make: () => gamutNode('AP0', 'sRGB'),
    warn: 'このサイトでは XYZ のかわりに sRGB の座標を使っています。',
  },
  'LEARNING - ACES_OUTPUT_SDR100': {
    note: 'ふつうの画面用(100 nit)の出力変換',
    learning: true,
    make: () => buildOutputTransform(OUTPUT_PRESETS.sdr100.opts),
  },
  'LEARNING - ACES_OUTPUT_REC709': {
    note: 'ハイビジョンテレビ用(100 nit)の出力変換',
    learning: true,
    make: () => buildOutputTransform(OUTPUT_PRESETS.sdr709.opts),
  },
  'LEARNING - ACES_OUTPUT_HDR1000_PQ': {
    note: 'HDR 1000 nit(PQ)の出力変換',
    learning: true,
    make: () => buildOutputTransform(OUTPUT_PRESETS.hdr1000.opts),
  },
  'LEARNING - ACES_OUTPUT_HDR4000_PQ': {
    note: 'HDR 4000 nit(PQ)の出力変換',
    learning: true,
    make: () => buildOutputTransform(OUTPUT_PRESETS.hdr4000.opts),
  },
  'LEARNING - ACES_OUTPUT_HLG': {
    note: 'HLG(放送向け)の出力変換',
    learning: true,
    make: () => buildOutputTransform(OUTPUT_PRESETS.hlg1000.opts),
  },
};

/** 対応していないキー。見つけたら、はっきり伝えます。 */
const UNSUPPORTED_KEYS = {
  view_transforms: 'view_transforms',
  display_colorspaces: 'display_colorspaces',
  named_transforms: 'named_transforms',
  file_rules: 'file_rules',
  shared_views: 'shared_views',
  inactive_colorspaces: 'inactive_colorspaces',
};

const UNSUPPORTED_TRANSFORMS = {
  FileTransform: '外部の LUT ファイルは読めません。',
  DisplayViewTransform: 'このサイトでは使えません。',
  FixedFunctionTransform: 'このサイトでは使えません。',
  AllocationTransform: 'このサイトでは使えません。',
  ExposureContrastTransform: 'このサイトでは使えません。',
  GradingPrimaryTransform: 'このサイトでは使えません。',
};

const REQUIRED_ROLES = ['reference', 'scene_linear'];

// ---------------------------------------------------------------------------

export class OCIOConfig {
  constructor(doc) {
    this.doc = doc;
    this.errors = [];
    this.warnings = [];
    this.colorspaces = new Map();
    this.looks = new Map();
    this.displays = new Map();
    this.roles = {};
    this.name = doc.name || '(名前なし)';
    this._build();
  }

  /**
   * 文字列から設定を読みます。読めなかった場合も例外を投げず、
   * errors に理由を入れて返します。エディタで使うためです。
   */
  static parse(text) {
    try {
      const doc = parseYAML(text);
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
        const cfg = Object.create(OCIOConfig.prototype);
        cfg.errors = [new ConfigError(1, '設定の形になっていません。',
          ['いちばん外側は「名前: 値」の並びにしてください。'])];
        cfg.warnings = [];
        cfg.colorspaces = new Map();
        cfg.looks = new Map();
        cfg.displays = new Map();
        cfg.roles = {};
        return cfg;
      }
      return new OCIOConfig(doc);
    } catch (err) {
      const cfg = Object.create(OCIOConfig.prototype);
      cfg.errors = [err instanceof YamlError
        ? new ConfigError(err.line, err.problem, err.fixes)
        : new ConfigError(1, String(err && err.message ? err.message : err), [])];
      cfg.warnings = [];
      cfg.colorspaces = new Map();
      cfg.looks = new Map();
      cfg.displays = new Map();
      cfg.roles = {};
      return cfg;
    }
  }

  get ok() { return this.errors.length === 0; }

  _err(line, problem, fixes) { this.errors.push(new ConfigError(line || 1, problem, fixes)); }
  _warn(line, problem, fixes) { this.warnings.push(new ConfigError(line || 1, problem, fixes)); }

  _build() {
    const d = this.doc;

    // バージョン
    if (d.ocio_profile_version === undefined) {
      this._warn(d.__line, 'ocio_profile_version が書かれていません。',
        ['1行目に「ocio_profile_version: 2」と書くのがふつうです。']);
    } else if (Number(d.ocio_profile_version) < 2) {
      this._warn(d.__line, 'これは古い形式(バージョン1)の設定です。',
        ['このサイトはバージョン2を前提にしています。']);
    }

    // 対応していないキー
    for (const key of Object.keys(UNSUPPORTED_KEYS)) {
      if (d[key] !== undefined) {
        const line = (d[key] && d[key].__line) || d.__line;
        this._err(line, `${key} は、このサイトでは未対応です。`,
          ['本物の OpenColorIO では使えます。ここでは行ごと消してください。']);
      }
    }
    if (d.search_path !== undefined) {
      this._warn(d.__line, 'search_path は受けつけますが、このサイトでは効きません。',
        ['外部の LUT ファイルを読まないためです。']);
    }

    // colorspaces
    const list = d.colorspaces;
    if (!Array.isArray(list)) {
      this._err(d.__line, 'colorspaces がありません。',
        ['「colorspaces:」の下に、色空間を「- !<ColorSpace>」の形でならべてください。']);
    } else {
      for (const cs of list) {
        if (!cs || typeof cs !== 'object') continue;
        if (!cs.name) {
          this._err(cs.__line, '名前(name)のない色空間があります。',
            ['「name: 好きな名前」の行を足してください。']);
          continue;
        }
        if (this.colorspaces.has(cs.name)) {
          this._err(cs.__line, `色空間 "${cs.name}" が2回定義されています。`,
            ['同じ名前は1回だけにしてください。']);
          continue;
        }
        this.colorspaces.set(cs.name, {
          name: cs.name,
          family: cs.family || '',
          description: cs.description || '',
          encoding: cs.encoding || '',
          isdata: cs.isdata === true,
          line: cs.__line,
          raw: cs,
        });
      }
    }

    // looks
    if (d.looks !== undefined) {
      if (!Array.isArray(d.looks)) {
        this._err(d.looks.__line || d.__line, 'looks はリストで書きます。',
          ['「looks:」の下に「- !<Look>」をならべてください。']);
      } else {
        for (const lk of d.looks) {
          if (!lk || !lk.name) {
            this._err(lk && lk.__line, '名前(name)のない look があります。', ['「name: 好きな名前」を足してください。']);
            continue;
          }
          this.looks.set(lk.name, { name: lk.name, line: lk.__line, raw: lk });
        }
      }
    }

    // roles
    if (d.roles && typeof d.roles === 'object') {
      for (const [k, v] of Object.entries(d.roles)) {
        if (k === '__line' || k === '__tag') continue;
        this.roles[k] = v;
        if (typeof v !== 'string') {
          this._err(d.roles.__line, `ロール "${k}" の値が色空間の名前になっていません。`,
            ['「ロール名: 色空間の名前」の形で書いてください。']);
        } else if (!this.colorspaces.has(v)) {
          this._err(d.roles.__line, `ロール "${k}" が指している色空間 "${v}" が見つかりません。`,
            [`colorspaces に "${v}" を追加するか、名前を確かめてください。`,
              '大文字と小文字も区別されます。']);
        }
      }
    }
    // scene_linear は「光の量そのもの」の色空間を指していないといけません。
    // ここがずれていると、合成の計算がすべて狂います。第7章の課題2で使います。
    const slName = this.roles.scene_linear;
    if (slName && this.colorspaces.has(slName)) {
      const cs = this.colorspaces.get(slName);
      if (cs.encoding && cs.encoding !== 'scene-linear') {
        this._err(d.roles.__line,
          `ロール scene_linear が "${slName}" を指していますが、これは光の量そのものの色空間ではありません(encoding: ${cs.encoding})。`,
          ['scene_linear には、encoding が scene-linear の色空間を指定してください。',
            'ここがずれていると、合成やぼかしの計算が全部おかしくなります。']);
      }
    }

    for (const r of REQUIRED_ROLES) {
      if (!this.roles[r]) {
        this._err(d.roles ? d.roles.__line : d.__line, `ロール "${r}" が決められていません。`,
          [`roles の下に「${r}: 色空間の名前」を足してください。`]);
      }
    }

    // displays / views
    if (!d.displays || typeof d.displays !== 'object') {
      this._err(d.__line, 'displays がありません。',
        ['「displays:」の下に、画面の名前とその見せかたを書いてください。']);
    } else {
      for (const [dispName, views] of Object.entries(d.displays)) {
        if (dispName === '__line' || dispName === '__tag') continue;
        if (!Array.isArray(views)) {
          this._err(d.displays.__line, `display "${dispName}" の中身がリストになっていません。`,
            ['「- !<View> {name: 名前, colorspace: 色空間}」の形でならべてください。']);
          continue;
        }
        const parsed = [];
        for (const v of views) {
          if (!v || typeof v !== 'object') continue;
          if (v.view_transform || v.display_colorspace) {
            this._err(v.__line, 'view_transform / display_colorspace を使う書きかたは未対応です。',
              ['このサイトでは「colorspace:」で出力先の色空間を直接指定してください。']);
            continue;
          }
          if (!v.name) {
            this._err(v.__line, '名前(name)のない View があります。', ['「name: 好きな名前」を足してください。']);
            continue;
          }
          if (!v.colorspace) {
            this._err(v.__line, `View "${v.name}" に colorspace が書かれていません。`,
              ['「colorspace: 色空間の名前」を足してください。']);
            continue;
          }
          if (!this.colorspaces.has(v.colorspace)) {
            this._err(v.__line, `色空間 "${v.colorspace}" が見つかりません。`,
              [`View で使う前に、colorspaces に "${v.colorspace}" を追加してください。`,
                '名前の大文字と小文字も一致している必要があります。']);
            continue;
          }
          const looks = parseLookList(v.looks);
          for (const l of looks) {
            if (!this.looks.has(l.name)) {
              this._err(v.__line, `look "${l.name}" が見つかりません。`,
                [`looks に "${l.name}" を追加するか、名前を確かめてください。`]);
            }
          }
          parsed.push({ name: v.name, colorspace: v.colorspace, looks, line: v.__line });
        }
        this.displays.set(dispName, parsed);
      }
    }

    // active_displays / active_views で並び順を変えられます。
    if (Array.isArray(d.active_displays) && d.active_displays.length) {
      const ordered = new Map();
      for (const name of d.active_displays) {
        if (this.displays.has(name)) ordered.set(name, this.displays.get(name));
        else this._warn(d.__line, `active_displays の "${name}" は displays にありません。`, []);
      }
      for (const [k, v] of this.displays) if (!ordered.has(k)) ordered.set(k, v);
      this.displays = ordered;
    }
  }

  // -------------------------------------------------------------------------
  // 変換の組み立て
  // -------------------------------------------------------------------------

  getColorSpaceNames() { return [...this.colorspaces.keys()]; }
  getDisplayNames() { return [...this.displays.keys()]; }
  getViewNames(display) { return (this.displays.get(display) || []).map((v) => v.name); }
  getRole(name) { return this.roles[name]; }

  /** 色空間 → 基準の色空間 への変換。 */
  toReference(name) {
    const cs = this.colorspaces.get(name);
    if (!cs) throw new ConfigError(1, `色空間 "${name}" が見つかりません。`, []);
    if (cs.isdata) return new GroupNode([], 'データなので変換しない');
    const t = cs.raw.to_reference || cs.raw.to_scene_reference;
    if (t) return this.makeTransform(t);
    const f = cs.raw.from_reference || cs.raw.from_scene_reference;
    if (f) {
      const node = this.makeTransform(f);
      const inv = node.inverse();
      if (!inv) {
        throw new ConfigError(cs.line,
          `色空間 "${name}" は、基準の色空間にもどす向きの変換を作れません。`,
          ['to_reference を書き足してください。',
            '切りそろえ(クランプ)やべき乗が入っていると、逆向きは作れません。']);
      }
      return inv;
    }
    return new GroupNode([], '変換なし(基準そのもの)');
  }

  /** 基準の色空間 → 色空間 への変換。 */
  fromReference(name) {
    const cs = this.colorspaces.get(name);
    if (!cs) throw new ConfigError(1, `色空間 "${name}" が見つかりません。`, []);
    if (cs.isdata) return new GroupNode([], 'データなので変換しない');
    const f = cs.raw.from_reference || cs.raw.from_scene_reference;
    if (f) return this.makeTransform(f);
    const t = cs.raw.to_reference || cs.raw.to_scene_reference;
    if (t) {
      const inv = this.makeTransform(t).inverse();
      if (!inv) {
        throw new ConfigError(cs.line,
          `色空間 "${name}" は、基準の色空間から向かう変換を作れません。`,
          ['from_reference を書き足してください。']);
      }
      return inv;
    }
    return new GroupNode([], '変換なし(基準そのもの)');
  }

  /** look を1つ適用するノード。process_space に移動してから当てて、もどします。 */
  makeLook(entry) {
    const look = this.looks.get(entry.name);
    if (!look) throw new ConfigError(1, `look "${entry.name}" が見つかりません。`, []);
    const space = look.raw.process_space;
    const nodes = [];
    if (space && space !== this.roles.reference) {
      if (!this.colorspaces.has(space)) {
        throw new ConfigError(look.line, `look "${entry.name}" の process_space "${space}" が見つかりません。`,
          [`colorspaces に "${space}" を追加してください。`]);
      }
      nodes.push(this.fromReference(space));
    }
    if (entry.direction === 'forward') {
      if (!look.raw.transform) {
        throw new ConfigError(look.line, `look "${entry.name}" に transform がありません。`,
          ['「transform: !<CDLTransform> {...}」のような行を足してください。']);
      }
      nodes.push(this.makeTransform(look.raw.transform));
    } else {
      const inv = look.raw.inverse_transform
        ? this.makeTransform(look.raw.inverse_transform)
        : this.makeTransform(look.raw.transform).inverse();
      if (!inv) {
        throw new ConfigError(look.line, `look "${entry.name}" は逆向きに使えません。`,
          ['inverse_transform を書き足してください。']);
      }
      nodes.push(inv);
    }
    if (space && space !== this.roles.reference) nodes.push(this.toReference(space));
    return new GroupNode(nodes, `look: ${entry.name}`);
  }

  /**
   * 「素材の色空間 → 画面の見せかた」の変換をまとめて作ります。
   * @param {{src: string, display: string, view: string}} o
   * @returns {TransformChain}
   */
  getProcessor({ src, display, view }) {
    const views = this.displays.get(display);
    if (!views) {
      throw new ConfigError(1, `display "${display}" が見つかりません。`,
        ['displays に追加するか、名前を確かめてください。']);
    }
    const v = views.find((x) => x.name === view) || views[0];
    if (!v) {
      throw new ConfigError(1, `display "${display}" に View が1つもありません。`,
        ['「- !<View> {name: 名前, colorspace: 色空間}」を足してください。']);
    }
    const srcCS = this.colorspaces.get(src);
    if (!srcCS) {
      throw new ConfigError(1, `色空間 "${src}" が見つかりません。`, []);
    }
    if (srcCS.isdata || this.colorspaces.get(v.colorspace).isdata) {
      return new TransformChain([new ClampNode(0, 1)]);
    }
    const nodes = [this.toReference(src)];
    for (const l of v.looks) nodes.push(this.makeLook(l));
    nodes.push(this.fromReference(v.colorspace));
    return new TransformChain(nodes);
  }

  // -------------------------------------------------------------------------
  // YAML のノード → 変換ノード
  // -------------------------------------------------------------------------

  makeTransform(node, depth = 0) {
    if (depth > 24) {
      throw new ConfigError(node.__line, '変換の入れ子が深すぎます。', ['どこかで輪になっていないか確かめてください。']);
    }
    if (!node || typeof node !== 'object') {
      throw new ConfigError(1, '変換の書きかたが読めません。',
        ['「!<なんとかTransform> {…}」の形で書いてください。']);
    }
    const tag = node.__tag;
    const line = node.__line;
    if (!tag) {
      throw new ConfigError(line, '変換の種類(!<…Transform>)が書かれていません。',
        ['例: !<MatrixTransform> {matrix: [ … ]}']);
    }
    if (UNSUPPORTED_TRANSFORMS[tag]) {
      throw new ConfigError(line, `${tag} は、このサイトでは未対応です。`,
        [UNSUPPORTED_TRANSFORMS[tag], '本物の OpenColorIO では使えます。']);
    }
    const inverse = node.direction === 'inverse';
    const wrap = (n) => {
      if (!inverse) return n;
      const inv = n.inverse();
      if (!inv) {
        throw new ConfigError(line, `${tag} は逆向きにできません。`,
          ['切りそろえ(クランプ)などが入っていると、逆向きは作れません。']);
      }
      return inv;
    };

    switch (tag) {
      case 'MatrixTransform': {
        const m = node.matrix;
        if (!Array.isArray(m) || m.length !== 16) {
          throw new ConfigError(line, 'matrix には数を16個ならべます。',
            ['4行4列ぶんの数です。色だけを変えるなら、4行目と4列目は 0 0 0 1 にします。']);
        }
        return wrap(new MatrixNode([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]], '行列'));
      }
      case 'ExponentTransform': {
        const v = node.value;
        if (!Array.isArray(v) || v.length < 3) {
          throw new ConfigError(line, 'value には数を4個ならべます。', ['例: value: [2.2, 2.2, 2.2, 1]']);
        }
        return wrap(new PowerNode(v));
      }
      case 'ExponentWithLinearTransform': {
        const g = node.gamma, o = node.offset;
        if (!Array.isArray(g) || !Array.isArray(o)) {
          throw new ConfigError(line, 'gamma と offset を、それぞれ数4個で書きます。',
            ['例: gamma: [2.4, 2.4, 2.4, 1], offset: [0.055, 0.055, 0.055, 0]']);
        }
        return wrap(new MonitorCurveNode(g[0], o[0]));
      }
      case 'LogTransform':
        return wrap(new LogAffineNode({ base: node.base === undefined ? 2 : node.base }));
      case 'LogAffineTransform':
      case 'LogCameraTransform': {
        const num = (x, d) => (Array.isArray(x) ? x[0] : (x === undefined ? d : x));
        return wrap(new LogAffineNode({
          base: num(node.base, 2),
          logSideSlope: num(node.log_side_slope !== undefined ? node.log_side_slope : node.logSideSlope, 1),
          logSideOffset: num(node.log_side_offset !== undefined ? node.log_side_offset : node.logSideOffset, 0),
          linSideSlope: num(node.lin_side_slope !== undefined ? node.lin_side_slope : node.linSideSlope, 1),
          linSideOffset: num(node.lin_side_offset !== undefined ? node.lin_side_offset : node.linSideOffset, 0),
          linSideBreak: tag === 'LogCameraTransform'
            ? num(node.lin_side_break !== undefined ? node.lin_side_break : node.linSideBreak, undefined)
            : undefined,
        }));
      }
      case 'RangeTransform':
        return wrap(new RangeNode({
          minInValue: node.min_in_value, maxInValue: node.max_in_value,
          minOutValue: node.min_out_value, maxOutValue: node.max_out_value,
          style: node.style,
        }));
      case 'CDLTransform':
        return wrap(new CDLNode({
          slope: node.slope || [1, 1, 1],
          offset: node.offset || [0, 0, 0],
          power: node.power || [1, 1, 1],
          sat: node.sat === undefined ? 1 : node.sat,
          gamut: REFERENCE_GAMUT,
        }));
      case 'SaturationTransform':
        return wrap(new SaturationNode(node.sat === undefined ? 1 : node.sat, REFERENCE_GAMUT));
      case 'GroupTransform': {
        const kids = node.children;
        if (!Array.isArray(kids)) {
          throw new ConfigError(line, 'GroupTransform には children が要ります。',
            ['「children:」の下に変換をならべてください。']);
        }
        return wrap(new GroupNode(kids.map((k) => this.makeTransform(k, depth + 1)), 'まとまった変換'));
      }
      case 'ColorSpaceTransform': {
        const { src, dst } = node;
        if (!src || !dst) {
          throw new ConfigError(line, 'ColorSpaceTransform には src と dst が要ります。',
            ['例: !<ColorSpaceTransform> {src: linear, dst: srgb_texture}']);
        }
        for (const n of [src, dst]) {
          if (!this.colorspaces.has(n)) {
            throw new ConfigError(line, `色空間 "${n}" が見つかりません。`,
              [`colorspaces に "${n}" を追加するか、名前を確かめてください。`]);
          }
        }
        return wrap(new GroupNode([this.toReference(src), this.fromReference(dst)], `${src} → ${dst}`));
      }
      case 'LookTransform': {
        const looks = parseLookList(node.looks);
        if (!looks.length) {
          throw new ConfigError(line, 'LookTransform には looks が要ります。', ['例: looks: my_look']);
        }
        return wrap(new GroupNode(looks.map((l) => this.makeLook(l)), 'look をあてる'));
      }
      case 'BuiltinTransform': {
        const style = node.style;
        const b = BUILTIN_STYLES[style];
        if (!b) {
          throw new ConfigError(line, `BuiltinTransform の style "${style}" は、このサイトでは未対応です。`,
            ['使えるのは次のものです: ' + Object.keys(BUILTIN_STYLES).join(', ')]);
        }
        if (b.warn) this._warn(line, b.warn, []);
        return wrap(b.make());
      }
      default:
        throw new ConfigError(line, `${tag} という変換は知りません。`,
          ['名前のつづりを確かめてください。',
            'このサイトが対応している変換は docs/OCIO-ENGINE.md にまとめてあります。']);
    }
  }
}

/** "+look1, -look2" や "look1" を、向きつきのリストにします。 */
function parseLookList(spec) {
  if (!spec) return [];
  const items = String(spec).split(',').map((s) => s.trim()).filter(Boolean);
  return items.map((s) => {
    if (s.startsWith('-')) return { name: s.slice(1).trim(), direction: 'inverse' };
    if (s.startsWith('+')) return { name: s.slice(1).trim(), direction: 'forward' };
    return { name: s, direction: 'forward' };
  });
}

/**
 * 設定を読んで、変換まで作れるかどうかを確かめます。
 * エディタで「いま壊れているか」を判断するのに使います。
 * @returns {{config: OCIOConfig, errors: ConfigError[], warnings: ConfigError[]}}
 */
export function loadConfig(text) {
  const config = OCIOConfig.parse(text);
  const errors = [...config.errors];
  const warnings = [...config.warnings];
  if (!errors.length) {
    // 実際に変換を組み立ててみて、そこで初めて分かる問題も拾います。
    for (const display of config.getDisplayNames()) {
      for (const view of config.getViewNames(display)) {
        try {
          config.getProcessor({ src: config.getRole('scene_linear'), display, view });
        } catch (err) {
          if (err instanceof ConfigError) errors.push(err);
          else errors.push(new ConfigError(1, String(err.message || err), []));
        }
      }
    }
  }
  return { config, errors, warnings };
}
