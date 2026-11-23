"""A Markdown document of a project as a readable HTML page, styled like the desk; standard library only.

A small subset of Markdown: YAML frontmatter (a metadata table), ATX and setext headings, paragraphs, emphasis, strong,
strikethrough, inline code, fenced code blocks, ordered, unordered and task lists with nesting, links, images, tables,
blockquotes and horizontal rules. Everything is HTML-escaped: raw HTML in the source shows as text. A link keeps only the
http, https and mailto schemes and in-page anchors; a relative link to another .md file opens it through the desk helper
(/doc?path=...), any other relative link shows as text.
"""

import html
import os
import re
import urllib.parse

FENCE = re.compile(r'^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)')
HEADING = re.compile(r'^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$')
RULE = re.compile(r'^ {0,3}([-*_])(?:\s*\1){2,}\s*$')
QUOTE = re.compile(r'^ {0,3}> ?')
LIST_ITEM = re.compile(r'^(\s*)([-*+]|\d{1,9}[.)])(\s+|$)(.*)$')
TABLE_RULE = re.compile(r'^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$')
SETEXT = re.compile(r'^ {0,3}(=+|-+)\s*$')
TASK = re.compile(r'^\[([ xX])\]\s+')
CELL_SPLIT = re.compile(r'(?<!\\)\|')

# Code spans, images, links, autolinks, backslash escapes and bare URLs, each kept apart before the emphasis pass.
INLINE = re.compile(
    r'(?P<ticks>`+)(?P<code>.+?)(?P=ticks)'
    r'|!\[(?P<alt>[^\]]*)\]\((?P<src>[^()\s]*)(?:\s+"[^"]*")?\)'
    r'|\[(?P<text>(?:[^\[\]]|\[[^\[\]]*\])+)\]\((?P<href>(?:[^()\s]|\([^()\s]*\))*)(?:\s+"(?P<title>[^"]*)")?\)'
    r'|<(?P<auto>(?:https?://|mailto:)[^\s<>]+)>'
    r'|\\(?P<escaped>[\\`*_{}\[\]()#+\-.!|>~])'
    r'|(?P<bare>(?<![\w/])https?://[^\s<>()]*[^\s<>().,;:!?\'"*_])')
EMPHASIS = (
    (re.compile(r'\*\*(?=\S)(.+?)(?<=\S)\*\*'), r'<strong>\1</strong>'),
    (re.compile(r'(?<!\w)__(?=\S)(.+?)(?<=\S)__(?!\w)'), r'<strong>\1</strong>'),
    (re.compile(r'\*(?=\S)(.+?)(?<=\S)\*'), r'<em>\1</em>'),
    (re.compile(r'(?<!\w)_(?=\S)(.+?)(?<=\S)_(?!\w)'), r'<em>\1</em>'),
    (re.compile(r'~~(?=\S)(.+?)(?<=\S)~~'), r'<del>\1</del>'),
)
SLOT = re.compile('\x00(\\d+)\x00')

# The desk's colour tokens and font (hooks/board.ts STYLE), light and dark.
STYLE = """
:root { color-scheme: light dark; --bg: #ffffff; --fg: #1f2328; --dim: #656d76; --line: #d0d7de; --chip: #f6f8fa; --on: #0969da; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #0d1117; --fg: #e6edf3; --dim: #8d96a0;
  --line: #30363d; --chip: #161b22; --on: #58a6ff; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px 48px; background: var(--bg); color: var(--fg); font: 15px/1.6 -apple-system, system-ui, sans-serif; }
main { max-width: 820px; margin: 0 auto; }
.source { color: var(--dim); font: 12px/1.4 ui-monospace, monospace; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 .6em; }
h1 { font-size: 26px; } h2 { font-size: 21px; padding-bottom: 4px; border-bottom: 1px solid var(--line); } h3 { font-size: 17px; }
h4, h5, h6 { font-size: 15px; } h6 { color: var(--dim); }
main > :first-child, .meta + h1 { margin-top: 0; }
p, ul, ol, blockquote, pre, table { margin: 0 0 1em; }
a { color: var(--on); text-decoration: none; } a:hover { text-decoration: underline; }
code { font: 13px ui-monospace, monospace; background: var(--chip); border: 1px solid var(--line); border-radius: 4px; padding: 1px 4px; }
pre { background: var(--chip); border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; overflow-x: auto; }
pre code { background: none; border: 0; padding: 0; }
blockquote { margin-left: 0; padding: 0 14px; border-left: 3px solid var(--line); color: var(--dim); }
ul, ol { padding-left: 1.6em; } li > ul, li > ol { margin: .2em 0; }
li.task { list-style: none; } li.task > input { margin: 0 .5em 0 -1.4em; vertical-align: middle; }
hr { border: 0; border-top: 1px solid var(--line); margin: 1.6em 0; }
table { border-collapse: collapse; display: block; overflow-x: auto; max-width: 100%; }
th, td { text-align: left; padding: 6px 10px; border: 1px solid var(--line); vertical-align: top; }
th { background: var(--chip); font-weight: 600; }
table.meta { font-size: 13px; display: table; }
table.meta th { width: 1%; white-space: nowrap; color: var(--dim); font-weight: 500; }
img { max-width: 100%; }
del { color: var(--dim); }
"""


def indent_of(line):
    return len(line.expandtabs(4)) - len(line.expandtabs(4).lstrip(' '))


def safe_href(url, base_dir):
    """The href a link may carry, or None: web and mail links, in-page anchors, other .md files through /doc."""
    url = url.strip()
    if url.startswith('#'):
        return url
    scheme = urllib.parse.urlsplit(url).scheme.lower()
    if scheme in ('http', 'https', 'mailto'):
        return url
    if scheme or not url or base_dir is None:
        return None
    target, _, fragment = url.partition('#')
    target = urllib.parse.unquote(target.split('?')[0])
    if not target.lower().endswith('.md'):
        return None
    full = os.path.normpath(os.path.join(base_dir, target))
    return '/doc?path=' + urllib.parse.quote(full, safe='/') + ('#' + fragment if fragment else '')


class Renderer:
    def __init__(self, base_dir=None):
        self.base_dir = base_dir
        self.slugs = {}

    # ---------------------------------------------------------------- inline

    def inline(self, text):
        slots = []

        def keep(markup):
            slots.append(markup)
            return '\x00%d\x00' % (len(slots) - 1)

        def token(match):
            group = match.lastgroup
            if match.group('code') is not None:
                return keep('<code>' + html.escape(match.group('code').strip() or match.group('code')) + '</code>')
            if match.group('src') is not None:
                alt = html.escape(match.group('alt'))
                src = match.group('src')
                if urllib.parse.urlsplit(src).scheme.lower() in ('http', 'https'):
                    return keep(f'<img src="{html.escape(src)}" alt="{alt}">')
                return keep(f'<em>[{alt or "image"}]</em>')
            if match.group('text') is not None:
                label = self.inline(match.group('text'))
                href = safe_href(match.group('href'), self.base_dir)
                if href is None:
                    return keep(label)
                title = match.group('title')
                extra = f' title="{html.escape(title)}"' if title else ''
                if href.startswith(('http:', 'https:')):
                    extra += ' target="_blank" rel="noopener"'
                return keep(f'<a href="{html.escape(href)}"{extra}>{label}</a>')
            if group == 'auto' or group == 'bare':
                url = match.group(group)
                label = url[7:] if url.startswith('mailto:') else url
                extra = '' if url.startswith('mailto:') else ' target="_blank" rel="noopener"'
                return keep(f'<a href="{html.escape(url)}"{extra}>{html.escape(label)}</a>')
            return keep(html.escape(match.group('escaped')))

        marked = html.escape(INLINE.sub(token, text), quote=False)
        for pattern, replacement in EMPHASIS:
            marked = pattern.sub(replacement, marked)
        marked = re.sub(r'(?: {2,}|\\)\n', '<br>\n', marked)
        while SLOT.search(marked):
            marked = SLOT.sub(lambda m: slots[int(m.group(1))], marked)
        return marked

    def slug(self, markup):
        text = re.sub(r'<[^>]+>', '', markup)
        base = re.sub(r'[^\w\- ]', '', html.unescape(text).lower()).strip().replace(' ', '-') or 'section'
        count = self.slugs.get(base, 0)
        self.slugs[base] = count + 1
        return base if not count else f'{base}-{count}'

    def heading(self, level, text):
        body = self.inline(text.strip())
        return f'<h{level} id="{self.slug(body)}">{body}</h{level}>'

    # ---------------------------------------------------------------- blocks

    def starts_block(self, lines, i):
        line = lines[i]
        return bool(FENCE.match(line) or HEADING.match(line) or RULE.match(line) or QUOTE.match(line) or LIST_ITEM.match(line)
                    or self.is_table(lines, i))

    @staticmethod
    def is_table(lines, i):
        return i + 1 < len(lines) and '|' in lines[i] and '|' in lines[i + 1] and '-' in lines[i + 1] and bool(TABLE_RULE.match(lines[i + 1]))

    def blocks(self, lines, tight=False):
        out = []
        i = 0
        while i < len(lines):
            line = lines[i]
            if not line.strip():
                i += 1
                continue
            fence = FENCE.match(line)
            if fence:
                mark = fence.group(1)
                code = []
                i += 1
                while i < len(lines) and not re.match(r'^ {0,3}' + re.escape(mark[0]) + '{%d,}\\s*$' % len(mark), lines[i]):
                    code.append(lines[i])
                    i += 1
                i += 1
                language = f' class="language-{html.escape(fence.group(2))}"' if fence.group(2) else ''
                out.append(f'<pre><code{language}>' + html.escape('\n'.join(code)) + ('\n' if code else '') + '</code></pre>')
                continue
            heading = HEADING.match(line)
            if heading:
                out.append(self.heading(len(heading.group(1)), heading.group(2) or ''))
                i += 1
                continue
            if RULE.match(line):
                out.append('<hr>')
                i += 1
                continue
            if QUOTE.match(line):
                quoted = []
                while i < len(lines) and lines[i].strip() and (QUOTE.match(lines[i]) or not self.starts_block(lines, i)):
                    quoted.append(QUOTE.sub('', lines[i], count=1))
                    i += 1
                out.append('<blockquote>\n' + self.blocks(quoted) + '\n</blockquote>')
                continue
            if LIST_ITEM.match(line):
                markup, i = self.list_block(lines, i)
                out.append(markup)
                continue
            if self.is_table(lines, i):
                markup, i = self.table(lines, i)
                out.append(markup)
                continue
            # Two trailing spaces (or a backslash) end a line with a break: they are kept on all but the last line.
            paragraph = [line.strip() + ('  ' if line.endswith('  ') else '')]
            i += 1
            while i < len(lines) and lines[i].strip() and not SETEXT.match(lines[i]) and not self.starts_block(lines, i):
                paragraph.append(lines[i].strip() + ('  ' if lines[i].endswith('  ') else ''))
                i += 1
            if i < len(lines) and lines[i].strip() and SETEXT.match(lines[i]):
                out.append(self.heading(1 if lines[i].strip()[0] == '=' else 2, ' '.join(part.strip() for part in paragraph)))
                i += 1
                continue
            body = self.inline('\n'.join(paragraph).rstrip())
            out.append(body if tight else '<p>' + body + '</p>')
        return '\n'.join(out)

    def list_block(self, lines, i):
        first = LIST_ITEM.match(lines[i])
        indent = indent_of(lines[i])
        ordered = first.group(2)[0].isdigit()
        items = []
        loose = False
        while i < len(lines):
            # Blank lines between two items of the list make it loose: each item's text becomes a paragraph.
            after = next((j for j in range(i, len(lines)) if lines[j].strip()), len(lines))
            match = LIST_ITEM.match(lines[after]) if after < len(lines) else None
            if not match or indent_of(lines[after]) != indent or match.group(2)[0].isdigit() != ordered:
                break
            loose = loose or after > i
            i = after
            content = indent + len(match.group(2)) + max(1, min(len(match.group(3).expandtabs(4)), 4))
            body = [match.group(4)]
            i += 1
            while i < len(lines):
                line = lines[i]
                if not line.strip():
                    after = next((j for j in range(i + 1, len(lines)) if lines[j].strip()), None)
                    if after is not None and indent_of(lines[after]) > indent:
                        body.append('')
                        i += 1
                        continue
                    break
                if indent_of(line) > indent:
                    expanded = line.expandtabs(4)
                    body.append(expanded[min(content, indent_of(line)):])
                    i += 1
                    continue
                if body[-1].strip() and not self.starts_block(lines, i):
                    body.append(line.strip())
                    i += 1
                    continue
                break
            while body and not body[-1].strip():
                body.pop()
            if '' in body:
                loose = True
            items.append(body)
        rendered = []
        for body in items:
            task = TASK.match(body[0]) if body else None
            if task:
                body = [body[0][task.end():]] + body[1:]
            inner = self.blocks(body, tight=not loose)
            if task:
                checked = ' checked' if task.group(1) != ' ' else ''
                rendered.append(f'<li class="task"><input type="checkbox" disabled{checked}>{inner}</li>')
            else:
                rendered.append(f'<li>{inner}</li>')
        start = int(re.match(r'\d+', first.group(2)).group()) if ordered else 1
        tag = 'ol' if ordered else 'ul'
        opening = f'<ol start="{start}">' if ordered and start != 1 else f'<{tag}>'
        return opening + '\n' + '\n'.join(rendered) + f'\n</{tag}>', i

    def table(self, lines, i):
        def cells(line):
            line = line.strip()
            if line.startswith('|'):
                line = line[1:]
            if line.endswith('|') and not line.endswith('\\|'):
                line = line[:-1]
            return [cell.strip() for cell in CELL_SPLIT.split(line)]

        head = cells(lines[i])
        aligns = []
        for rule in cells(lines[i + 1]):
            left, right = rule.startswith(':'), rule.endswith(':')
            aligns.append('center' if left and right else 'right' if right else 'left' if left else '')
        i += 2
        rows = []
        while i < len(lines) and lines[i].strip() and '|' in lines[i]:
            rows.append(cells(lines[i]))
            i += 1

        def row(values, tag):
            values = (values + [''] * len(head))[:len(head)]
            parts = []
            for index, value in enumerate(values):
                align = aligns[index] if index < len(aligns) else ''
                style = f' style="text-align: {align}"' if align else ''
                parts.append(f'<{tag}{style}>{self.inline(value)}</{tag}>')
            return '<tr>' + ''.join(parts) + '</tr>'

        body = '\n'.join(row(values, 'td') for values in rows)
        return '<table>\n<thead>' + row(head, 'th') + '</thead>\n<tbody>\n' + body + '\n</tbody>\n</table>', i


def split_frontmatter(text):
    """The top-level `key: value` pairs of a leading YAML frontmatter, and the Markdown after it."""
    lines = text.replace('\r\n', '\n').replace('\r', '\n').split('\n')
    if not lines or lines[0].strip() != '---':
        return [], lines
    for end in range(1, len(lines)):
        if lines[end].strip() in ('---', '...'):
            break
    else:
        return [], lines
    pairs = []
    for line in lines[1:end]:
        match = re.match(r'^([A-Za-z0-9_][\w.-]*):\s*(.*?)\s*$', line)
        if match:
            value = match.group(2)
            if len(value) >= 2 and value[0] == value[-1] and value[0] in '\'"':
                value = value[1:-1]
            pairs.append((match.group(1), value))
    return pairs, lines[end + 1:]


def render_markdown(text, base_dir=None):
    """The body of a Markdown document as HTML: its frontmatter as a small table, then its blocks."""
    pairs, lines = split_frontmatter(text)
    renderer = Renderer(base_dir)
    meta = ''
    if pairs:
        rows = ''.join(f'<tr><th>{html.escape(key)}</th><td>{html.escape(value)}</td></tr>' for key, value in pairs)
        meta = '<table class="meta">' + rows + '</table>\n'
    return meta + renderer.blocks(lines)


def document_title(path, text):
    pairs, lines = split_frontmatter(text)
    for key, value in pairs:
        if key == 'title' and value:
            return value
    for line in lines:
        heading = HEADING.match(line)
        if heading and len(heading.group(1)) == 1 and heading.group(2):
            return heading.group(2)
    return os.path.basename(path)


def document_page(path, text):
    """A whole HTML page for the Markdown file at `path`, its source path above the rendered text."""
    body = render_markdown(text, os.path.dirname(path))
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(document_title(path, text))}</title>
<style>{STYLE}</style>
</head>
<body>
<main>
<div class="source">{html.escape(path)}</div>
{body}
</main>
</body>
</html>
"""
