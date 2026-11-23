"""Tests of the Markdown rendering of a document: python3 -m unittest discover -s server"""

import unittest

import doc_page as dp


def render(text, base_dir='/repo/.pm'):
    return dp.render_markdown(text, base_dir)


class Blocks(unittest.TestCase):
    def test_headings_atx_and_setext_with_unique_ids(self):
        out = render('# Brief\n## Scope ##\nTitle\n===\nSub\n---\n## Scope\n')
        self.assertIn('<h1 id="brief">Brief</h1>', out)
        self.assertIn('<h2 id="scope">Scope</h2>', out)
        self.assertIn('<h1 id="title">Title</h1>', out)
        self.assertIn('<h2 id="sub">Sub</h2>', out)
        self.assertIn('<h2 id="scope-1">Scope</h2>', out)

    def test_paragraphs_join_lines_and_keep_hard_breaks(self):
        self.assertEqual(render('one\ntwo  \nthree\n\nnext'), '<p>one\ntwo<br>\nthree</p>\n<p>next</p>')

    def test_fenced_code_is_escaped_and_keeps_its_language(self):
        out = render('```py\nif a < b:\n    **x**\n```\n')
        self.assertEqual(out, '<pre><code class="language-py">if a &lt; b:\n    **x**\n</code></pre>')
        self.assertIn('<pre><code>~~~ inside\n</code></pre>', render('~~~~\n~~~ inside\n~~~~'))

    def test_tight_and_loose_lists_nested_ordered_and_tasks(self):
        out = render('- a\n  - b\n    1. c\n- [x] done\n- [ ] todo\n')
        self.assertEqual(out, '<ul>\n<li>a\n<ul>\n<li>b\n<ol>\n<li>c</li>\n</ol></li>\n</ul></li>\n'
                              '<li class="task"><input type="checkbox" disabled checked>done</li>\n'
                              '<li class="task"><input type="checkbox" disabled>todo</li>\n</ul>')
        self.assertEqual(render('3. x\n\n4. y'), '<ol start="3">\n<li><p>x</p></li>\n<li><p>y</p></li>\n</ol>')
        self.assertEqual(render('- a\n\n1. b'), '<ul>\n<li>a</li>\n</ul>\n<ol>\n<li>b</li>\n</ol>')

    def test_a_list_item_continues_on_lazy_and_indented_lines(self):
        self.assertEqual(render('- first line\nsecond line\n- next'), '<ul>\n<li>first line\nsecond line</li>\n<li>next</li>\n</ul>')

    def test_tables_with_alignment_and_escaped_pipes(self):
        out = render('| A | B | C |\n|:--|:-:|--:|\n| 1 | `x` | a \\| b |\n| 2 |\n')
        self.assertIn('<th style="text-align: left">A</th><th style="text-align: center">B</th><th style="text-align: right">C</th>', out)
        self.assertIn('<td style="text-align: center"><code>x</code></td><td style="text-align: right">a | b</td>', out)
        self.assertIn('<tr><td style="text-align: left">2</td><td style="text-align: center"></td>', out)

    def test_blockquotes_rules_and_frontmatter(self):
        self.assertEqual(render('> quoted **text**\n> more\n\n***'), '<blockquote>\n<p>quoted <strong>text</strong>\nmore</p>\n</blockquote>\n<hr>')
        out = render('---\ntitle: "Project Brief"\nstatus: approved\nnested:\n  key: x\n---\n\n# Body\n')
        self.assertTrue(out.startswith('<table class="meta"><tr><th>title</th><td>Project Brief</td></tr>'))
        self.assertIn('<tr><th>nested</th><td></td></tr></table>', out)
        self.assertNotIn('key', out)
        self.assertIn('<h1 id="body">Body</h1>', out)


class Inline(unittest.TestCase):
    def test_emphasis_strong_strike_and_code(self):
        self.assertEqual(render('*a* **b** _c_ __d__ ~~e~~ `f *g*` snake_case_name'),
                         '<p><em>a</em> <strong>b</strong> <em>c</em> <strong>d</strong> <del>e</del> <code>f *g*</code> snake_case_name</p>')

    def test_everything_is_escaped(self):
        out = render('<script>alert(1)</script> & "q"\n\n# <b>x</b>')
        self.assertIn('&lt;script&gt;alert(1)&lt;/script&gt; &amp; "q"', out)
        self.assertIn('&lt;b&gt;x&lt;/b&gt;</h1>', out)
        self.assertNotIn('<script>', out)
        self.assertNotIn('<b>', out)

    def test_backslash_escapes_keep_the_character(self):
        self.assertEqual(render(r'\*not em\* \# \[x\]'), '<p>*not em* # [x]</p>')

    def test_links_keep_only_safe_targets(self):
        out = render('[web](https://e.com "T") [mail](mailto:a@b.c) [top](#scope) [js](javascript:alert(1)) [file](file:///etc/passwd)')
        self.assertIn('<a href="https://e.com" title="T" target="_blank" rel="noopener">web</a>', out)
        self.assertIn('<a href="mailto:a@b.c">mail</a>', out)
        self.assertIn('<a href="#scope">top</a>', out)
        self.assertIn(' js ', out)
        self.assertIn(' file</p>', out)
        self.assertNotIn('javascript', out)
        self.assertNotIn('file://', out)

    def test_a_relative_markdown_link_opens_through_the_helper(self):
        out = render('[pid](pid.md#scope) [wp](work-packages/WP-01.md) [readme](../README.md) [image](shot.png)')
        self.assertIn('<a href="/doc?path=/repo/.pm/pid.md#scope">pid</a>', out)
        self.assertIn('<a href="/doc?path=/repo/.pm/work-packages/WP-01.md">wp</a>', out)
        self.assertIn('<a href="/doc?path=/repo/README.md">readme</a>', out)
        self.assertIn(' image</p>', out)
        self.assertIn('<p>pid</p>', render('[pid](pid.md)', None))

    def test_autolinks_bare_urls_and_images(self):
        out = render('<https://a.example/x> see https://b.example/a_b_c. ![shot](https://c.example/s.png) ![local](s.png)')
        self.assertIn('<a href="https://a.example/x" target="_blank" rel="noopener">https://a.example/x</a>', out)
        self.assertIn('<a href="https://b.example/a_b_c" target="_blank" rel="noopener">https://b.example/a_b_c</a>.', out)
        self.assertIn('<img src="https://c.example/s.png" alt="shot">', out)
        self.assertIn('<em>[local]</em>', out)

    def test_emphasis_around_a_link(self):
        self.assertEqual(render('**see [x](https://e.com)**'), '<p><strong>see <a href="https://e.com" target="_blank" rel="noopener">x</a></strong></p>')


class Page(unittest.TestCase):
    def test_the_page_takes_the_desk_tokens_and_its_title(self):
        page = dp.document_page('/repo/.pm/brief.md', '---\ntitle: Project Brief\n---\n# Other <x>\n')
        self.assertIn('<title>Project Brief</title>', page)
        self.assertIn('--bg: #ffffff', page)
        self.assertIn('prefers-color-scheme: dark', page)
        self.assertIn('max-width: 820px', page)
        self.assertIn('<div class="source">/repo/.pm/brief.md</div>', page)
        self.assertIn('<title>Other &lt;x&gt;</title>', dp.document_page('/r/a.md', '# Other <x>\n'))
        self.assertIn('<title>a.md</title>', dp.document_page('/r/a.md', 'no heading\n'))


if __name__ == '__main__':
    unittest.main()
