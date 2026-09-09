# ミニOCIOエンジン 仕様

- 親文書: `docs/SPEC.md`
- 対象部品: I-10(`config.ocio` ライブエディタ)、および I-08 / I-11 / I-12 の内部変換
- 実装: `js/core/ocio-mini.js`, `js/core/yaml-mini.js`, `js/core/transforms.js`

## 1. 目的とスコープ

ブラウザ内で `config.ocio` を読み、その通りに画像を変換する **学習用の縮小実装**。

- 目的は「設定ファイルを書き換えたら絵が変わる」という因果を体験させること。
- OpenColorIO 本体の互換実装ではない。**本物の代わりに使ってはいけない**とUI上に明記する。
- 実際の OpenColorIO で通用する書き方だけを教える。このエンジン独自の構文は作らない。
  - 例外はゼロ。サポート外の構文は「このサイトでは未対応です」と表示し、独自代替を用意しない。

## 2. 対応する config のサブセット

### 2.1 トップレベルキー

| キー | 対応 | 備考 |
|---|---|---|
| `ocio_profile_version` | ○ | `2` のみ受理。`1` は警告して続行 |
| `name` | ○ | 表示のみ |
| `description` | ○ | 表示のみ |
| `search_path` | △ | 構文は受理。外部 LUT ファイルは読まないため実質無効。警告を出す |
| `roles` | ○ | 下記 |
| `displays` | ○ | 下記 |
| `active_displays` | ○ | 並び順の制御 |
| `active_views` | ○ | 同上 |
| `looks` | ○ | 下記 |
| `colorspaces` | ○ | 下記 |
| `view_transforms` | × | 未対応。検出したら明示的にエラー |
| `display_colorspaces` | × | 同上 |
| `named_transforms` | × | 同上 |
| `file_rules` | × | 同上 |
| `shared_views` | × | 同上 |

未対応キーは無視せず、**「このサイトでは未対応です(本物の OCIO では使えます)」** と行番号付きで表示する。黙って無視しない。

### 2.2 `roles`

対応するロール名:

- `scene_linear`(必須)
- `reference`(必須)
- `color_timing`
- `compositing_log`
- `data`
- `default`
- `color_picking`
- `texture_paint`
- `matte_paint`
- `aces_interchange`
- `cie_xyz_d65_interchange`

必須ロールが欠けている場合はエラー。存在しない色空間を指しているロールもエラー。第7章の課題2はこの挙動を利用する。

### 2.3 `colorspaces`

各色空間で対応するフィールド:

```yaml
- !<ColorSpace>
  name: ACEScg
  family: ACES
  description: ...
  equalitygroup: ...
  bitdepth: 32f          # 受理するが挙動には影響しない
  isdata: false          # true のときは一切変換しない
  encoding: scene-linear # 受理。表示に使う
  allocation: lg2        # 受理。GPU 配分は行わないため挙動に影響しない(警告なし)
  allocationvars: [-8, 5]
  to_reference:   <transform>
  from_reference: <transform>
  to_scene_reference:   <transform>   # v2 の別名。同義として扱う
  from_scene_reference: <transform>
```

- `to_reference` と `from_reference` の片方だけがある場合、可能なら自動で逆変換を作る。逆変換が作れない変換(後述)しか無い場合はエラー。
- 両方ある場合は両方を使う。整合性チェックはしない。

### 2.4 対応する変換 (transform)

| 変換 | 対応 | 逆変換 | 備考 |
|---|---|---|---|
| `!<MatrixTransform>` | ○ | ○ | `matrix` は 16 要素 (4x4) |
| `!<ExponentTransform>` | ○ | ○ | `value` は 4 要素 |
| `!<ExponentWithLinearTransform>` | ○ | ○ | sRGB / Rec.709 の分割式に使う |
| `!<LogTransform>` | ○ | ○ | `base` 指定 |
| `!<LogAffineTransform>` | ○ | ○ | `logSideSlope` 等 |
| `!<LogCameraTransform>` | ○ | ○ | ACEScct の toe を表現するのに必要 |
| `!<ColorSpaceTransform>` | ○ | ○ | `src` / `dst` |
| `!<GroupTransform>` | ○ | ○ | `children` を順に適用。逆は逆順 |
| `!<RangeTransform>` | ○ | △ | クランプありの場合は逆変換不可としてエラー |
| `!<CDLTransform>` | ○ | × | slope/offset/power/sat。look 用 |
| `!<BuiltinTransform>` | △ | △ | 下表の限定リストのみ |
| `!<FileTransform>` | × | × | 外部 LUT は読まない。明示エラー |
| `!<LookTransform>` | ○ | ○ | look の適用 |
| `!<DisplayViewTransform>` | × | × | 未対応 |
| `!<FixedFunctionTransform>` | × | × | 未対応 |

`direction: inverse` はすべての対応変換で受理する。

#### 対応する `BuiltinTransform` の style

学習に必要な最小限に絞る。それ以外は「未対応」と表示する。

- `UTILITY - ACES-AP0_to_CIE-XYZ-D65_BFD`
- `ACEScg_to_ACES2065-1`(内部行列で実装)
- `ACEScct_to_ACES2065-1`
- `LEARNING - ACES_OUTPUT_SDR100`(本サイト独自の簡略出力変換)
- `LEARNING - ACES_OUTPUT_HDR1000_PQ`
- `LEARNING - ACES_OUTPUT_HDR4000_PQ`
- `LEARNING - ACES_OUTPUT_HLG`

`LEARNING - ` で始まる style は **本サイト専用の簡略実装**。本物の OCIO では動かないことを、エディタ上でその行にバッジを出して明示する。教材の中でしか使わないと文章でも書く。実物の `ACES 1.x` / `ACES 2.0` の Output Transform を名乗らせない。

### 2.5 `displays` と `views`

```yaml
displays:
  sRGB:
    - !<View> {name: ACES, colorspace: out_srgb, looks: my_look}
    - !<View> {name: Raw,  colorspace: raw}
  Rec709:
    - !<View> {name: ACES, colorspace: out_rec709}
```

- `View` の `name`, `colorspace`, `looks` に対応。
- `looks` は `+look1, -look2` の記法(順方向 / 逆方向)に対応する。
- `view_transform` / `display_colorspace` を使う v2 形式の View は未対応としてエラー。

### 2.6 `looks`

```yaml
looks:
  - !<Look>
    name: my_look
    process_space: ACEScct
    transform: !<CDLTransform> {slope: [1.0, 1.0, 1.05]}
```

- `process_space` に指定された色空間へ変換 → transform 適用 → 元に戻す、の順で処理する。
- `inverse_transform` があれば逆適用に使う。無ければ逆適用時にエラー。
- 第7章の課題3、第9章の I-12 で使う。

## 3. 評価モデル

### 3.1 パイプラインの組み立て

「ソース色空間 → display/view」の変換は次の順で合成する。

```
src → (src.to_reference) → reference
    → [looks: process_space へ移動 → transform → 戻す] (view.looks の順)
    → (view.colorspace.from_reference) → 表示値
```

- `isdata: true` の色空間が絡む場合、変換を一切行わない(パススルー)。
- 途中の色空間が見つからない場合は、その時点でエラーにして変換を実行しない(壊れた絵を出さない)。

### 3.2 実行方式

1. パースして **変換ノードの木** を作る。
2. 木を平坦化し、可能な範囲で行列を事前合成する(連続する MatrixTransform は1つにまとめる)。
3. **GLSL のフラグメントシェーダ関数を文字列生成**し、WebGL2 で 1 パス実行する。
4. WebGL が使えない環境では、同じノード列を JS で CPU 実行する(解像度を落とす)。

GLSL 生成とCPU実行は **同じノード定義から** 生やす。実装を二重に書かない。各ノードは次のインターフェースを持つ。

```js
{
  type: 'matrix',
  applyCPU(rgb) -> rgb,
  emitGLSL(varName) -> string,
  inverse() -> node | null
}
```

### 3.3 数値の扱い

- 内部は float32。負値とスーパーホワイト(1.0 超)を **クランプしない**。第4章・第10章の学習に必要。
- 表示の直前だけ 0〜1 にクランプし、その際「クランプが起きた画素」を記録してゼブラ表示に使える形で返す。

## 4. YAML パーサ (`yaml-mini.js`)

外部ライブラリを使わないため、必要最小限の YAML サブセットを自前で実装する。

**対応する構文**

- マッピング、シーケンス、ネスト(インデント2スペース基準、任意深さ)
- インラインマップ `{a: 1, b: [1,2]}`、インラインリスト `[1, 2, 3]`
- 型タグ `!<ColorSpace>` `!<View>` 等 → ノードに `__tag` として保持
- スカラー: 文字列(引用あり/なし)、数値、真偽値、`null`
- コメント `#`
- 複数行文字列 `|` と `>`

**対応しない構文**(検出したら行番号付きでエラー)

- アンカーとエイリアス `&` `*`
- 複合キー `? `
- ドキュメント区切り `---` の複数ドキュメント
- タブインデント(「YAML ではタブが使えません。スペースにしてください」と案内する)

**エラーの要件**

すべてのエラーは次の3点を持つ。
1. 行番号(と可能なら列)
2. 何が問題か(日本語、専門用語なし)
3. どう直すか(具体的な修正案)

例:
```
12行目: 色空間 "my_gamma22" が見つかりません。
  → views で使う前に、colorspaces に my_gamma22 を追加してください。
  → 名前の大文字小文字も一致している必要があります。
```

## 5. 教材用 config ファイル

`assets/data/configs/` に配置する。すべて実際の OpenColorIO で読める形式にする(`LEARNING -` の BuiltinTransform を除く)。

| ファイル | 用途 | 内容 |
|---|---|---|
| `minimal.ocio` | 第7章 課題1 の初期状態 | 色空間3つ(raw, linear, srgb)、display 1つ、view 2つ。40行程度 |
| `broken-role.ocio` | 課題2 | `scene_linear` が sRGB を指している壊れた config |
| `looks.ocio` | 課題3 | look を足すための土台 |
| `two-displays.ocio` | 課題4 | sRGB と Rec.709 の2 display |
| `aces-lite.ocio` | 第8〜10章の内部で使用 | ACES 風の簡略 config。AP0/AP1/ACEScct と学習用 output transform |

`minimal.ocio` は全文を第7章の本文に掲載し、行ごとに注釈を付ける。40行を超えないこと。

## 6. 課題の自動判定

文字列比較ではなく、**エンジンが評価した結果**で判定する。

| 課題 | 判定方法 |
|---|---|
| 1. 色空間を足す | `my_gamma22` が定義され、いずれかの view から到達でき、既知のテスト色 3点の変換結果が gamma 2.2 の期待値と誤差 0.5% 以内 |
| 2. ロールを直す | `scene_linear` ロールが `encoding: scene-linear` の色空間を指し、リニア合成テスト(0.5+0.5)の結果が期待値と一致 |
| 3. look を足す | look が定義され、view に適用され、テスト色の青成分が元より 2% 以上増えている |
| 4. 出力を替える | 2つの display が存在し、同じテスト色の出力値が両者で異なる |

判定に失敗したときは「何が足りないか」を1つだけ指摘する。全部を並べない。

## 7. 制限事項の表示

I-10 のエディタには常時、次の注記を表示する。

> このエディタは学習用の簡略版です。本物の OpenColorIO の機能の一部だけを再現しています。
> ここで書いた config は、`LEARNING -` で始まる行を除けば、本物の OpenColorIO でも読めます。

## 8. テスト

`js/core/` にはテストを付ける(ブラウザで開く簡易テストランナー。ビルド不要)。

- **往復テスト**: 各色空間で `to_reference → from_reference` が元の値に戻る(誤差 1e-5 以内)
- **既知値テスト**: sRGB 0.5 → linear 0.2140 など、公表値との一致
- **行列テスト**: AP0 ↔ AP1 の往復、sRGB ↔ XYZ の往復
- **CPU/GPU 一致テスト**: 同じ config で CPU 実行と GLSL 実行の差が 1/255 未満
- **パーサテスト**: 教材 config 5本がすべてパースでき、意図したエラーが意図した行で出る
