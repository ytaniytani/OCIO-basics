#!/usr/bin/env python3
"""docs/GLOSSARY.md から assets/data/glossary.json を作る道具。

用語集の元は Markdown 1本にしておいて、ページ用のデータはそこから作ります。
2か所に同じ内容を書かないためです。

使い方:
    python3 tools/build_glossary.py
    python3 tools/build_glossary.py --check   # 作り直しが要るかだけ調べる
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "GLOSSARY.md"
OUT = ROOT / "assets" / "data" / "glossary.json"

CHAPTER_FILES = {
    "第1章": "ch01.html", "第2章": "ch02.html", "第3章": "ch03.html",
    "第4章": "ch04.html", "第5章": "ch05.html", "第6章": "ch06.html",
    "第7章": "ch07.html", "第8章": "ch08.html", "第9章": "ch09.html",
    "第10章": "ch10.html", "第11章": "ch11.html",
}

ENTRY_RE = re.compile(r"^\*\*(?P<term>[^*]+)\*\*\s+—\s+(?P<rest>.+)$")


def parse() -> list[dict]:
    if not SRC.exists():
        print(f"{SRC} がありません。", file=sys.stderr)
        return []
    entries: list[dict] = []
    section = ""
    for raw in SRC.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith("## "):
            section = line[3:].strip()
            continue
        m = ENTRY_RE.match(line)
        if not m:
            continue
        term = m.group("term").strip()
        rest = m.group("rest").strip()

        # 末尾の「第N章」や「付録」を取り出す
        chapter = ""
        cm = re.search(r"(第\d+章|付録)\s*$", rest)
        if cm:
            chapter = cm.group(1)
            rest = rest[: cm.start()].rstrip()

        # 「やさしい言い方 / くわしい説明」に分ける
        if " / " in rest:
            simple, detail = rest.split(" / ", 1)
        else:
            simple, detail = rest, ""

        # 用語から英語表記を取り出す
        en = ""
        em = re.match(r"^(?P<ja>[^(（]+)[（(](?P<en>[^)）]+)[)）]\s*$", term)
        if em:
            en = em.group("en").strip()
            term = em.group("ja").strip()

        entries.append({
            "term": term,
            "en": en,
            "section": section,
            "simple": simple.strip().rstrip("。") ,
            "detail": detail.strip(),
            "chapter": chapter,
            "href": CHAPTER_FILES.get(chapter, ""),
        })
    return entries



GL_START = "<!-- GLOSSARY:START -->"
GL_END = "<!-- GLOSSARY:END -->"


def esc(t: str) -> str:
    return (t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def render_html(entries: list[dict]) -> str:
    """用語集の中身を、そのまま HTML に書き出す。

    JavaScript が動かない環境でも全部読めるようにするため、
    検索機能ではなく中身のほうを静的に埋めこむ。
    """
    parts = ['<div class="gl-list">']
    for e in entries:
        head = [f'<span class="gl-term">{esc(e["term"])}</span>']
        if e["en"]:
            head.append(f'<span class="gl-en">{esc(e["en"])}</span>')
        if e["chapter"]:
            href = e["href"] or "#"
            head.append(f'<a class="gl-ch" href="{href}">{esc(e["chapter"])}</a>')
        parts.append(
            f'<div class="gl-item" data-section="{esc(e["section"])}" '
            f'data-search="{esc((e["term"] + " " + e["en"] + " " + e["simple"] + " " + e["detail"]).lower())}">'
        )
        parts.append('<div class="gl-head">' + "".join(head) + "</div>")
        parts.append(f'<p class="gl-simple">{esc(e["simple"])}</p>')
        if e["detail"]:
            parts.append(f'<p class="gl-detail">{esc(e["detail"])}</p>')
        parts.append("</div>")
    parts.append("</div>")
    return "\n".join(parts)


def write_page(entries: list[dict], check: bool) -> bool:
    """glossary.html の中の用語一覧を差しかえる。変更があれば True。"""
    page = ROOT / "glossary.html"
    if not page.exists():
        return False
    text = page.read_text(encoding="utf-8")
    if GL_START not in text or GL_END not in text:
        print("  !! glossary.html に用語一覧の目印がありません。", file=sys.stderr)
        return False
    start = text.index(GL_START) + len(GL_START)
    end = text.index(GL_END)
    new = text[:start] + "\n" + render_html(entries) + "\n" + text[end:]
    if new == text:
        return False
    if not check:
        page.write_text(new, encoding="utf-8")
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    entries = parse()
    if not entries:
        print("用語が1つも読めませんでした。", file=sys.stderr)
        return 1
    payload = json.dumps(entries, ensure_ascii=False, indent=1) + "\n"
    old = OUT.read_text(encoding="utf-8") if OUT.exists() else None

    if args.check:
        stale = (old != payload) or write_page(entries, check=True)
        if stale:
            print("用語集が古いです。python3 tools/build_glossary.py を実行してください。")
            return 1
        print(f"用語集は最新です({len(entries)} 語)。")
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(payload, encoding="utf-8")
    changed = write_page(entries, check=False)
    print(f"{OUT.relative_to(ROOT)} を書きました({len(entries)} 語)。"
          + ("glossary.html も更新しました。" if changed else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
