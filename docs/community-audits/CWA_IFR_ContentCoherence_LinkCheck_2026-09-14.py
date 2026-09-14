#!/usr/bin/env python3
"""Link/structure integrity for IFR Pages content (repo-local, pinned commit).

Site conventions (verified): GitHub Pages serves docs/ as the host root for
ifrunit.tech; root-absolute paths (/assets/...) map to docs/...; absolute
https://ifrunit.tech/... URLs are same-site internal links.
"""
import html.parser, os, urllib.parse, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # repo root
SITE_ROOT = "docs"
SITE_HOSTS = {"ifrunit.tech", "www.ifrunit.tech"}
PAGES = ["docs/index.html", "docs/builder.html", "docs/web3/index.html"] + [
    os.path.join("docs/wiki", f) for f in sorted(os.listdir(os.path.join(ROOT, "docs/wiki")))
    if f.endswith(".html")
]

class LinkParser(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links, self.ids = [], set()
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        for k in ("href", "src"):
            if k in a and a[k]:
                self.links.append((tag, k, a[k].strip(), self.getpos()))
        if "id" in a:
            self.ids.add(a["id"])

def to_repo_path(url, base):
    """Return (repo_rel_path, fragment) for internal links, else None."""
    if url.startswith(("mailto:", "tel:", "javascript:", "data:")):
        return None
    if url.startswith("#"):
        return ("__self__", urllib.parse.unquote(url[1:]))
    u = urllib.parse.urlparse(url)
    if u.scheme in ("http", "https"):
        if u.netloc not in SITE_HOSTS:
            return None
        path = u.path
    else:
        path = u.path
    frag = urllib.parse.unquote(u.fragment) if u.fragment else ""
    if path.startswith("/"):
        rel = os.path.normpath(os.path.join(SITE_ROOT, path.lstrip("/")))
    else:
        rel = os.path.normpath(os.path.join(base, urllib.parse.unquote(path)))
    return (rel, frag)

parsers = {}
def get_parser(rel):
    if rel not in parsers:
        p = LinkParser()
        with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
            p.feed(fh.read())
        parsers[rel] = p
    return parsers[rel]

for p in PAGES:
    get_parser(p)

problems, ext = [], collections.Counter()
linked = set()
for p in PAGES:
    base = os.path.dirname(p)
    for tag, attr, url, pos in parsers[p].links:
        u = urllib.parse.urlparse(url)
        if u.scheme in ("http", "https") and u.netloc not in SITE_HOSTS:
            ext[u.netloc] += 1
            continue
        res = to_repo_path(url, base)
        if res is None:
            continue
        rel, frag = res
        if rel == "__self__":
            if frag and frag not in parsers[p].ids:
                problems.append(f"DEAD-ANCHOR-SELF\t{p}:{pos[0]}\t#{frag}")
            continue
        if os.path.isdir(os.path.join(ROOT, rel)):
            rel = os.path.join(rel, "index.html")
        if not os.path.exists(os.path.join(ROOT, rel)):
            problems.append(f"DEAD-LINK\t{p}:{pos[0]}\t{url}\t-> {rel}")
            continue
        if rel.endswith(".html"):
            linked.add(rel)
            if frag and frag not in get_parser(rel).ids:
                problems.append(f"DEAD-ANCHOR\t{p}:{pos[0]}\t{url}")

orphans = [p for p in PAGES if p not in linked and p != "docs/index.html"]

print(f"pages scanned: {len(PAGES)}")
print(f"internal problems: {len(problems)}")
for pr in problems:
    print(" ", pr)
print(f"orphan pages (not linked from any scanned page): {len(orphans)}")
for o in orphans:
    print(" ", o)
print("external hosts referenced (not checked):")
for host, n in ext.most_common():
    print(f"  {host}\t{n}")
