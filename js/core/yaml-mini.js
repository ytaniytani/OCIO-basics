// yaml-mini.js — config.ocio を読むためだけの、小さな YAML 読みとり器。
//
// 外部のライブラリを使わない方針なので自前で書いています。
// YAML の全部には対応しません。対応する範囲は docs/OCIO-ENGINE.md のとおりです。
//
// 大事にしていること:
//   ・エラーには必ず「行番号」「何が問題か」「どう直すか」を付ける
//   ・対応していない書きかたは、黙って無視せず、はっきりエラーにする

export class YamlError extends Error {
  /**
   * @param {number} line 1 から数えた行番号
   * @param {string} problem 何が問題か
   * @param {string[]} fixes どう直すか
   */
  constructor(line, problem, fixes = []) {
    super(`${line}行目: ${problem}`);
    this.name = 'YamlError';
    this.line = line;
    this.problem = problem;
    this.fixes = fixes;
  }
  /** 画面に出す用の文章。 */
  toDisplay() {
    const body = this.fixes.map((f) => `  → ${f}`).join('\n');
    return `${this.line}行目: ${this.problem}` + (body ? '\n' + body : '');
  }
}

const TAG_RE = /^!<([A-Za-z0-9_]+)>\s*/;

/** 生の行を、扱いやすい形にそろえます。空行とコメント行は落とします。 */
function scan(text) {
  const out = [];
  const rawLines = text.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const lineNo = i + 1;
    if (/^\s*$/.test(raw)) continue;
    if (/^\s*#/.test(raw)) continue;
    if (/^\t/.test(raw) || /^ *\t/.test(raw)) {
      throw new YamlError(lineNo, 'インデントにタブ文字が使われています。',
        ['YAML ではタブが使えません。半角スペースに置きかえてください。',
          'このサイトの設定ファイルは、スペース2つ分ずつ下げる書きかたです。']);
    }
    if (/^---\s*$/.test(raw) || /^\.\.\.\s*$/.test(raw)) {
      throw new YamlError(lineNo, '"---" や "..." の区切りには対応していません。',
        ['1つのファイルに1つの設定だけを書いてください。']);
    }
    const indent = raw.length - raw.replace(/^ +/, '').length;
    const content = stripComment(raw.slice(indent));
    if (!content) continue;
    if (/(^|[^\\])[&*][A-Za-z0-9_]/.test(content) && !/["'].*[&*]/.test(content)) {
      throw new YamlError(lineNo, 'アンカー( & )やエイリアス( * )には対応していません。',
        ['同じ内容をくり返して書いてください。']);
    }
    out.push({ indent, content, line: lineNo });
  }
  return out;
}

/** 行末のコメントを落とします。引用符の中の # は残します。 */
function stripComment(s) {
  let inS = false, inD = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === '#' && !inS && !inD) {
      if (i === 0 || /\s/.test(s[i - 1])) return s.slice(0, i).trimEnd();
    }
  }
  return s.trimEnd();
}

/** スカラー(ひとつの値)を JavaScript の値にします。 */
function parseScalar(s, line) {
  const t = s.trim();
  if (t === '') return '';
  if (t === 'null' || t === '~') return null;
  if (t === 'true' || t === 'True') return true;
  if (t === 'false' || t === 'False') return false;
  if (/^"(.*)"$/.test(t)) return t.slice(1, -1).replace(/\\"/g, '"');
  if (/^'(.*)'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  if (t.startsWith('[') || t.startsWith('{')) return parseFlow(t, line);
  if (TAG_RE.test(t)) {
    const m = t.match(TAG_RE);
    const rest = t.slice(m[0].length).trim();
    const v = rest ? parseScalar(rest, line) : {};
    if (v && typeof v === 'object') v.__tag = m[1];
    return v;
  }
  return t;
}

/** [a, b] や {a: 1, b: 2} のような、1行に収まる書きかたを読みます。 */
function parseFlow(s, line) {
  let i = 0;
  const src = s;

  function ws() { while (i < src.length && /\s/.test(src[i])) i++; }

  function value() {
    ws();
    if (src[i] === '[') return list();
    if (src[i] === '{') return map();
    if (src[i] === '"' || src[i] === "'") return quoted();
    const start = i;
    while (i < src.length && !',]}'.includes(src[i])) i++;
    return parseScalar(src.slice(start, i), line);
  }

  function quoted() {
    const q = src[i++];
    let out = '';
    while (i < src.length && src[i] !== q) {
      if (src[i] === '\\' && q === '"') { i++; out += src[i++]; } else out += src[i++];
    }
    if (src[i] !== q) throw new YamlError(line, '引用符が閉じられていません。', ['" や \' の数が合っているか確かめてください。']);
    i++;
    return out;
  }

  function list() {
    i++; // [
    const arr = [];
    ws();
    if (src[i] === ']') { i++; return arr; }
    for (;;) {
      arr.push(value());
      ws();
      if (src[i] === ',') { i++; continue; }
      if (src[i] === ']') { i++; return arr; }
      throw new YamlError(line, '[ ] の中の書きかたが読めません。', ['要素は , (カンマ)で区切ってください。']);
    }
  }

  function map() {
    i++; // {
    const obj = {};
    ws();
    if (src[i] === '}') { i++; return obj; }
    for (;;) {
      ws();
      const ks = i;
      while (i < src.length && src[i] !== ':' && src[i] !== '}') i++;
      if (src[i] !== ':') {
        throw new YamlError(line, '{ } の中に、: (コロン)のない項目があります。',
          ['{名前: 値} の形で書いてください。']);
      }
      const key = src.slice(ks, i).trim().replace(/^["']|["']$/g, '');
      i++; // :
      obj[key] = value();
      ws();
      if (src[i] === ',') { i++; continue; }
      if (src[i] === '}') { i++; return obj; }
      throw new YamlError(line, '{ } の中の書きかたが読めません。', ['項目は , (カンマ)で区切ってください。']);
    }
  }

  const v = value();
  ws();
  if (i < src.length) {
    throw new YamlError(line, `"${src.slice(i)}" の意味が分かりません。`, ['余分な文字が残っていないか確かめてください。']);
  }
  return v;
}

/** key: value の行を、キーと残りに分けます。引用符の中の : は無視します。 */
function splitKey(content) {
  let inS = false, inD = false, depth = 0;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (!inS && !inD) {
      if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') depth--;
      else if (c === ':' && depth === 0) {
        const after = content[i + 1];
        if (after === undefined || after === ' ') {
          return [content.slice(0, i).trim(), content.slice(i + 1).trim()];
        }
      }
    }
  }
  return null;
}

/**
 * YAML の文字列を読みとります。
 * @param {string} text
 * @returns {any} 素の JavaScript の値。型タグは __tag、行番号は __line に入ります。
 */
export function parseYAML(text) {
  const lines = scan(text);
  if (!lines.length) {
    throw new YamlError(1, 'ファイルが空です。', ['設定を書いてください。']);
  }
  const [value, next] = parseBlock(lines, 0, lines[0].indent);
  if (next < lines.length) {
    throw new YamlError(lines[next].line, 'インデント(行頭の空白の数)が合っていません。',
      ['同じ深さの項目は、行頭の空白の数をそろえてください。']);
  }
  return value;
}

function parseBlock(lines, i, indent) {
  if (i >= lines.length) return [null, i];
  if (lines[i].content.startsWith('- ') || lines[i].content === '-') {
    return parseSequence(lines, i, indent);
  }
  return parseMapping(lines, i, indent);
}

function parseMapping(lines, i, indent) {
  const obj = { __line: lines[i].line };
  while (i < lines.length && lines[i].indent === indent) {
    const { content, line } = lines[i];
    if (content.startsWith('- ')) {
      throw new YamlError(line, 'ここに "- " で始まる行があります。',
        ['名前と値の並び(名前: 値)と、リスト(- 値)は混ぜられません。']);
    }
    const kv = splitKey(content);
    if (!kv) {
      throw new YamlError(line, `"${content}" に : (コロン)がありません。`,
        ['「名前: 値」の形で書いてください。',
          'コロンのうしろには半角スペースが必要です。']);
    }
    const [rawKey, rest] = kv;
    const key = rawKey.replace(/^["']|["']$/g, '');
    if (key === '') {
      throw new YamlError(line, '名前が空です。', ['コロンの前に名前を書いてください。']);
    }

    if (rest === '|' || rest === '>') {
      const [text, next] = readBlockScalar(lines, i + 1, indent, rest);
      obj[key] = text;
      i = next;
      continue;
    }

    const tagMatch = rest.match(TAG_RE);
    const afterTag = tagMatch ? rest.slice(tagMatch[0].length).trim() : rest;

    if (afterTag !== '') {
      const v = parseScalar(afterTag, line);
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (tagMatch) v.__tag = tagMatch[1];
        if (v.__line === undefined) v.__line = line;
      }
      obj[key] = v;
      i++;
      continue;
    }

    // 値が次の行以降にある場合
    const childIndent = i + 1 < lines.length ? lines[i + 1].indent : -1;
    if (childIndent > indent) {
      const [v, next] = parseBlock(lines, i + 1, childIndent);
      if (tagMatch && v && typeof v === 'object') v.__tag = tagMatch[1];
      obj[key] = v;
      i = next;
    } else {
      obj[key] = tagMatch ? { __tag: tagMatch[1], __line: line } : null;
      i++;
    }
  }
  return [obj, i];
}

function parseSequence(lines, i, indent) {
  const arr = [];
  arr.__line = lines[i].line;
  while (i < lines.length && lines[i].indent === indent
         && (lines[i].content.startsWith('- ') || lines[i].content === '-')) {
    const { content, line } = lines[i];
    const rest = content === '-' ? '' : content.slice(2).trim();
    const tagMatch = rest.match(TAG_RE);
    const afterTag = tagMatch ? rest.slice(tagMatch[0].length).trim() : rest;

    if (afterTag === '') {
      // 中身は次の行以降にあります。
      const childIndent = i + 1 < lines.length ? lines[i + 1].indent : -1;
      if (childIndent > indent) {
        const [v, next] = parseBlock(lines, i + 1, childIndent);
        if (tagMatch && v && typeof v === 'object') v.__tag = tagMatch[1];
        if (v && typeof v === 'object' && v.__line === undefined) v.__line = line;
        arr.push(v);
        i = next;
      } else {
        arr.push(tagMatch ? { __tag: tagMatch[1], __line: line } : null);
        i++;
      }
      continue;
    }

    const kv = afterTag.startsWith('{') ? null : splitKey(afterTag);
    if (kv) {
      // "- name: foo" のように、1つ目の項目が - と同じ行にある形
      const innerIndent = indent + 2;
      const virtual = [{ indent: innerIndent, content: afterTag, line }];
      let j = i + 1;
      while (j < lines.length && lines[j].indent > indent
             && !(lines[j].indent === indent && lines[j].content.startsWith('- '))) {
        virtual.push({ ...lines[j], indent: innerIndent + (lines[j].indent - (indent + 2)) });
        j++;
      }
      const [v] = parseMapping(virtual, 0, innerIndent);
      if (tagMatch) v.__tag = tagMatch[1];
      v.__line = line;
      arr.push(v);
      i = j;
      continue;
    }

    const v = parseScalar(afterTag, line);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (tagMatch) v.__tag = tagMatch[1];
      if (v.__line === undefined) v.__line = line;
    }
    arr.push(v);
    i++;
  }
  return [arr, i];
}

function readBlockScalar(lines, i, parentIndent, kind) {
  const parts = [];
  while (i < lines.length && lines[i].indent > parentIndent) {
    parts.push(lines[i].content);
    i++;
  }
  return [kind === '|' ? parts.join('\n') : parts.join(' '), i];
}

/** __tag や __line を取りのぞいた、素の値を返します。表示や比較に使います。 */
export function plain(value) {
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === '__tag' || k === '__line') continue;
      out[k] = plain(v);
    }
    return out;
  }
  return value;
}
