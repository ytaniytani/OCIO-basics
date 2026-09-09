#!/usr/bin/env python3
"""ページ共通部分(head / ヘッダ / 目次 / 前後リンク / フッタ)を書き出す道具。

サイトの公開にビルドは要りません。これは執筆のための道具です。
共通部分を1か所で直せるようにするために使います。

使い方:
    python3 tools/build_pages.py          # 全ページの共通部分を更新(本文は残す)
    python3 tools/build_pages.py --check  # 差分が出るかどうかだけ調べる

本文は次の目印の間だけを守ります。目印の外は毎回上書きされます。
    <!-- BODY:START -->  ... 本文 ...  <!-- BODY:END -->
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

CHAPTERS = [
    ("ch01", "1", "色ってなんだろう", "光と目と数字。色が3つの数で表せる理由"),
    ("ch02", "2", "数字だけでは色は決まらない", "同じ数字が別の色になる。色空間という約束"),
    ("ch03", "3", "明るさの数字は正直じゃない", "50%グレーは光の量が半分ではない"),
    ("ch04", "4", "見える範囲がちがう", "白飛びはなぜ戻らないのか"),
    ("ch05", "5", "混ぜると壊れる", "足し算もぼかしも、リニアでないと狂う"),
    ("ch06", "6", "OCIO の登場", "バラバラの素材を1つの作品にまとめる"),
    ("ch07", "7", "config.ocio をさわる", "設定ファイルを自分で書きかえてみる"),
    ("ch08", "8", "ACES というみんなのルール", "共通の方眼紙に写してから作業する"),
    ("ch09", "9", "グレーディングはどこに入れる", "味付けは刷る前。3か所を実験で比べる"),
    ("ch10", "10", "HDR — 明るいテレビにも届ける", "1つのマスターから何通りにも出す"),
    ("ch11", "11", "まとめとチェックテスト", "全体像の確認と10問のテスト"),
]

EXTRA_PAGES = [
    ("glossary", "付録A", "用語集", "全部の言葉に、やさしい言いかえを付けました"),
    ("next", "付録B", "次に何をする?", "無料で試せる道具と、公式の資料"),
]

SITE_NAME = "色のきほん — OCIO と ACES をさわって学ぶ"


def nav_html(current: str) -> str:
    items = ['<li><a href="index.html"%s><span class="num">0</span>はじめに</a></li>'
             % (' aria-current="page"' if current == "index" else "")]
    for cid, num, title, _desc in CHAPTERS:
        cur = ' aria-current="page"' if current == cid else ""
        items.append(
            f'<li><a href="{cid}.html"{cur}><span class="num">{num}</span>{title}</a></li>'
        )
    for pid, num, title, _desc in EXTRA_PAGES:
        cur = ' aria-current="page"' if current == pid else ""
        items.append(
            f'<li><a href="{pid}.html"{cur}><span class="num">{num[-1]}</span>{title}</a></li>'
        )
    inner = "\n      ".join(items)
    return (
        '<nav class="chapter-nav" id="chapter-nav" aria-label="目次">\n'
        "    <ol>\n"
        f"      {inner}\n"
        "    </ol>\n"
        "  </nav>"
    )


def order() -> list[tuple[str, str, str, str]]:
    return [("index", "0", "はじめに", "このサイトの歩き方")] + list(CHAPTERS) + list(EXTRA_PAGES)


def foot_links(page_id: str) -> str:
    seq = order()
    ids = [p[0] for p in seq]
    if page_id not in ids:
        return ""
    i = ids.index(page_id)
    parts = ['<nav class="chapter-foot" aria-label="前後の章">']
    if i > 0:
        pid, _num, title, _d = seq[i - 1]
        href = "index.html" if pid == "index" else f"{pid}.html"
        parts.append(
            f'    <a class="prev" href="{href}" rel="prev">'
            f'<span class="dir">まえ</span><span class="ttl">{title}</span></a>'
        )
    if i < len(seq) - 1:
        pid, _num, title, _d = seq[i + 1]
        href = "index.html" if pid == "index" else f"{pid}.html"
        parts.append(
            f'    <a class="next" href="{href}" rel="next">'
            f'<span class="dir">つぎ</span><span class="ttl">{title}</span></a>'
        )
    parts.append("  </nav>")
    return "\n".join(parts)



CJK = (
    r"[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF"
    r"\u4E00-\u9FFF\uFF00-\uFFEF]"
)


def join_cjk_lines(html: str) -> str:
    """日本語の途中で改行すると、ブラウザで半角スペースになってしまう。

    行末と次の行頭がどちらも日本語の文字なら、改行ごと詰める。
    <pre> の中は手を付けない。
    """
    chunks = re.split(r"(<pre\b.*?</pre>)", html, flags=re.S)
    out = []
    for i, chunk in enumerate(chunks):
        if i % 2 == 1:  # <pre> の中身
            out.append(chunk)
            continue
        prev = None
        while prev != chunk:
            prev = chunk
            chunk = re.sub(
                r"(" + CJK + r")[ \t]*\n[ \t]*(" + CJK + r"|<)",
                r"\1\2",
                chunk,
            )
        out.append(chunk)
    return "".join(out)


HEAD_TMPL = """<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} | {site}</title>
<meta name="description" content="{desc}">
<meta name="color-scheme" content="light dark">
<link rel="stylesheet" href="assets/css/site.css">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%239a3d12'/%3E%3Ccircle cx='12' cy='13' r='6' fill='%23f2b134'/%3E%3Ccircle cx='20' cy='19' r='6' fill='%23e8e4dc' opacity='.85'/%3E%3C/svg%3E">
<script type="module" src="js/main.js"></script>
</head>
<body data-chapter="{chapter_attr}">
<header class="site-header">
  <div class="site-header-inner">
    <p class="site-title"><a href="index.html">色<span>の</span>きほん</a></p>
    <button class="btn nav-toggle" type="button" aria-controls="chapter-nav" aria-expanded="true" hidden>目次</button>
  </div>
  {nav}
</header>
<main>
"""

FOOT_TMPL = """
{footlinks}
</main>
<footer class="site-footer">
  <p>このページは外部に通信しません。アクセス解析もクッキーも使っていません。</p>
  <p><a href="glossary.html">用語集</a> ・ <a href="next.html">次に何をする?</a> ・
     <a href="https://github.com/ytaniytani/OCIO-basics">ソースと仕様書</a></p>
</footer>
</body>
</html>
"""

BODY_START = "<!-- BODY:START -->"
BODY_END = "<!-- BODY:END -->"

PLACEHOLDER = """
<p class="chapter-kicker">第{num}章</p>
<h1>{title}</h1>
<p class="lead">{desc}</p>
<p>(この章の本文はこれから書きます。)</p>
"""


def build_page(page_id: str, num: str, title: str, desc: str, body: str) -> str:
    filename = "index.html" if page_id == "index" else f"{page_id}.html"
    head = HEAD_TMPL.format(
        title=title,
        site=SITE_NAME,
        desc=desc,
        nav=nav_html(page_id),
        chapter_attr=page_id if page_id.startswith("ch") else "",
    )
    foot = FOOT_TMPL.format(footlinks=foot_links(page_id))
    body = join_cjk_lines(body)
    return f"{head}{BODY_START}\n{body.strip()}\n{BODY_END}{foot}", filename


def extract_body(path: pathlib.Path, num: str, title: str, desc: str) -> str:
    if not path.exists():
        return PLACEHOLDER.format(num=num, title=title, desc=desc)
    text = path.read_text(encoding="utf-8")
    m = re.search(
        re.escape(BODY_START) + r"(.*?)" + re.escape(BODY_END), text, re.S
    )
    if not m:
        print(f"  !! {path.name}: 本文の目印が見つかりません。中身をそのまま残します。",
              file=sys.stderr)
        return PLACEHOLDER.format(num=num, title=title, desc=desc)
    return m.group(1)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="書きかえずに差分の有無だけ調べる")
    args = ap.parse_args()

    changed = []
    for page_id, num, title, desc in order():
        filename = "index.html" if page_id == "index" else f"{page_id}.html"
        path = ROOT / filename
        body = extract_body(path, num, title, desc)
        out, _ = build_page(page_id, num, title, desc, body)
        old = path.read_text(encoding="utf-8") if path.exists() else None
        if old == out:
            continue
        changed.append(filename)
        if not args.check:
            path.write_text(out, encoding="utf-8")

    if args.check:
        if changed:
            print("共通部分が古いページ: " + ", ".join(changed))
            return 1
        print("すべてのページの共通部分は最新です。")
        return 0

    if changed:
        print("更新しました: " + ", ".join(changed))
    else:
        print("変更はありませんでした。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
