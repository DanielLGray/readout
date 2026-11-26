"""Radiology industry news: parse outlet feeds, group the same story across
outlets, and find phrases trending in headlines."""
from __future__ import annotations

import hashlib
import html
import math
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse
from xml.etree import ElementTree as ET

import feedparser

from .terms import STOP, _contains, display, phrases

SITEMAP_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
NEWS_NS = "{http://www.google.com/schemas/sitemap-news/0.9}"

# words that say nothing about what a headline is about
NEWS_GENERIC = set("""
radiology radiologist radiologists imaging medical health healthcare hospital hospitals patient patients
says say said announces announced launches launched unveils unveiled receives received names named new
first study studies finds found shows show could may might will report reports company companies system
systems center centers year years week today latest top best update news rsna webinar podcast video
people young older big win better chance back way help need needs key amid after over more most less
many much so very really just still even get gets got make makes
""".split())

# headline verbs: fine for matching stories, useless at the edge of a trending phrase
HEADLINE_VERBS = set("""
lose loses lost double doubles doubled rise rises rising fall falls cut cuts find finds shows win wins
see sees hit hits face faces plan plans warn warns add adds approve approves approved clear clears
join joins drop drops boost boosts slow slows grow grows grew end ends start starts begin begins
""".split())


def _utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_date(s: str) -> Optional[datetime]:
    if not s:
        return None
    s = s.strip()
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M%z", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(s.replace("Z", "+0000"), fmt)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def clean_text(s: str) -> str:
    s = html.unescape(s or "")                 # some feeds escape their HTML twice ("&lt;p&gt;")
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    s = " ".join(s.split())                   # first, so line breaks inside the HTML don't hide the rules below
    s = re.sub(r"\bThe post .{3,200}? (?:appeared first|first appeared) on .{2,80}?\.?$", "", s)
    s = re.sub(r"\b(Continue reading|Read more|READ MORE)\b.*$", "", s, flags=re.I)
    s = re.sub(r"^\([A-Z][\w .&'-]{1,40}\)\s*(?:--|—|–)\s*", "", s)                     # "(MedPage Today) -- "
    s = re.sub(r"^(?:Listen (?:and|&) subscribe|Subscribe and listen|Listen) (?:on|to|wherever) [^.]{0,160}?\.\s*", "", s,
               flags=re.I)                                                                  # podcast app promo
    s = re.sub(r"^Note that some links may require registration or subscription\.\s*", "", s, flags=re.I)
    return s.strip()


def teaser(s: str, limit: int = 220) -> str:
    """The outlet's own summary, cut to a teaser so the article stays the place to read it."""
    s = clean_text(s)
    if len(s) <= limit:
        return s
    cut = s[:limit].rsplit(" ", 1)[0].rstrip(",;:—-")
    return cut + "…"


def clean_link(url: str) -> str:
    u = urlparse(url.strip())
    q = [(k, v) for k, v in parse_qsl(u.query) if not k.lower().startswith(("utm_", "mc_", "fbclid", "gclid"))]
    return urlunparse(u._replace(query=urlencode(q), fragment=""))


def item_id(link: str, title: str, source: str) -> str:
    key = link or f"{source}|{title.lower()}"
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:12]


# a feed never needs its own entity definitions; they're how "billion laughs" and external-entity
# attacks work, so a document that declares any is refused before a parser sees it
_ENTITY_TRICK = re.compile(r"<!ENTITY|<!DOCTYPE[^>\[]*\[", re.I)


def check_xml(text: str) -> str:
    if _ENTITY_TRICK.search(text[:200_000]):
        raise ValueError("document declares XML entities; refused")
    return text


# sites whose name has two parts after the dot (bbc.co.uk)
_TWO_PART = {"co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "org.au", "net.au", "co.nz", "co.jp", "com.br", "co.in", "co.za"}


def site_of(url_or_host: str) -> str:
    """The registrable site of a link: news.bbc.co.uk → bbc.co.uk, www.nature.com → nature.com."""
    host = (urlparse(url_or_host).hostname if "//" in url_or_host else url_or_host or "").lower().rstrip(".")
    parts = host.split(".")
    n = 3 if len(parts) > 2 and ".".join(parts[-2:]) in _TWO_PART else 2
    return ".".join(parts[-n:])


def link_sites(src: dict) -> set:
    """Where an outlet's stories may link: its own site, its feed's site, and any partner sites it names."""
    return {site_of(u) for u in [src.get("home", "")] + list(src.get("urls", [])) if u} | \
           {site_of(d) for d in src.get("link_domains", [])}


_WIKI_P = re.compile(r"<p\b[^>]*>(.*?)</p>", re.S | re.I)
_WIKI_BOLD = re.compile(r"<b>\s*<a\s[^>]*?href=\"([^\"]+)\"[^>]*>(.*?)</a>\s*</b>", re.S | re.I)
_WIKI_LINK = re.compile(r"<a\s[^>]*?href=\"([^\"]+)\"[^>]*>(.*?)</a>", re.S | re.I)


def wikipedia_item(summary_html: str) -> Optional[tuple]:
    """Wikipedia's daily feeds (today's featured article, picture of the day) title every entry
    with the date. The subject is the first bold link in the blurb: (title, its page, the blurb)."""
    for para in _WIKI_P.findall(summary_html or ""):
        m = _WIKI_BOLD.search(para) or _WIKI_LINK.search(para)
        if not m:
            continue
        link = urljoin("https://en.wikipedia.org/", html.unescape(m.group(1)))
        if not re.match(r"^https://en\.wikipedia\.org/wiki/[^:?#]+$", link):
            continue
        title = clean_text(re.sub(r"<[^>]+>", "", m.group(2)))
        if title:
            return title, link, re.sub(r"<[^>]+>", "", para)      # links dropped without leaving gaps before commas
    return None


# ── one picture per story, from the outlet's own feed ──────────────────────
_IMG_TAG = re.compile(r"<img\b[^>]*>", re.I)
_ATTR = lambda name: re.compile(name + r"\s*=\s*[\"']([^\"']+)[\"']", re.I)
_SRC, _SRCSET, _W, _H, _FILEW = _ATTR("src"), _ATTR("srcset"), _ATTR("width"), _ATTR("height"), _ATTR("data-file-width")
_WIKI_SIZES = (330, 500, 960)          # Wikimedia's standard thumbnail widths
_NOT_A_PICTURE = re.compile(r"feedburner|/~r/|pixel|tracker|beacon|doubleclick|gravatar|/emoji/|spacer|blank\.gif|logo|icon|avatar|badge", re.I)


def _https(url: str) -> str:
    url = html.unescape(str(url or "").strip())
    if url.startswith("//"):
        url = "https:" + url
    return url if re.match(r"^https://[^\s\"'<>]{4,600}$", url) and not _NOT_A_PICTURE.search(url) else ""


def _sized(url: str) -> str:
    """Ask image services for a phone-sized copy (about 800–1000 pixels wide): BBC's thumbnails are
    blurry at 240, while NPR, Future plc and WordPress sites often link originals of several MB.
    A service that ignores the request just sends what it would have anyway."""
    url = re.sub(r"(ichef\.bbci\.co\.uk/(?:ace|news)/(?:standard|ws))/\d+/", r"\1/800/", url)
    url = re.sub(r"(brightspotcdn\.com/dims3/default/strip/false/crop/[^/]+)/resize/[^/]+/", r"\1/resize/800/", url)
    url = re.sub(r"(cdn\.mos\.cms\.futurecdn\.net/[^/?]+)-(?:1[0-9]{3}|[2-9][0-9]{3})-80\.", r"\1-970-80.", url)
    url = re.sub(r"(cdn\.mos\.cms\.futurecdn\.net/[^/?]+)-970-80\.png$", r"\1-650-80.png", url)     # PNGs are heavy
    if "/wp-content/uploads/" in url and not re.search(r"[?&](?:w|resize|fit)=", url) \
            and not re.search(r"-\d{2,4}x\d{2,4}\.(?:jpe?g|png|webp)(?:\?|$)", url):
        url += ("&" if "?" in url else "?") + "w=1024"
    if "/wp-content/uploads/" in url:
        url = re.sub(r"([?&]w=)(\d{4,})", lambda m: m.group(1) + ("1024" if int(m.group(2)) > 1280 else m.group(2)), url)
    return url


resize_image = _sized


def _num(v) -> int:
    try:
        return int(float(str(v).strip().rstrip("px")))
    except (TypeError, ValueError):
        return 0


def entry_image(e, summary_html: str = "") -> str:
    """The story's picture: media:content, media:thumbnail, an image enclosure, or the first real
    <img> in its summary. Only https, never tracking pixels, logos or tiny icons."""
    cands = []                                               # (preference, width, url)
    for m in e.get("media_content", []) or []:
        if str(m.get("medium", "")) == "image" or str(m.get("type", "")).startswith("image") or \
                re.search(r"\.(?:jpe?g|png|webp)(?:\?|$)", str(m.get("url", "")), re.I):
            cands.append((3, _num(m.get("width")), m.get("url")))
    for m in e.get("media_thumbnail", []) or []:
        cands.append((2, _num(m.get("width")), m.get("url")))
    for enc in e.get("enclosures", []) or []:
        if str(enc.get("type", "")).startswith("image"):
            cands.append((2, 0, enc.get("href")))
    for tag in _IMG_TAG.findall(summary_html or "")[:3]:
        w, h = _num((_W.search(tag) or [None, 0])[1]), _num((_H.search(tag) or [None, 0])[1])
        if (w and w < 120) or (h and h < 80):
            continue
        srcset = _SRCSET.search(tag)
        best = None
        if srcset:                                           # the largest copy offered
            opts = [x.strip().split() for x in srcset.group(1).split(",") if x.strip()]
            best = max(opts, key=lambda o: _num(o[1].rstrip("xw")) if len(o) > 1 else 1)[0] if opts else None
        src = best or (_SRC.search(tag) or [None, ""])[1]
        filew = _num((_FILEW.search(tag) or [None, 0])[1])
        if filew and re.search(r"wikimedia\.org/.+/\d+px-", src):          # a sharper Wikimedia thumbnail, never wider than the original
            fit = [x for x in _WIKI_SIZES if x <= filew]
            if fit:
                src = re.sub(r"/\d+px-", f"/{fit[-1]}px-", src, count=1)
        cands.append((1, w, src))
    for _, width, url in sorted(cands, key=lambda c: (-c[0], -c[1])):
        if width and width < 120:
            continue
        u = _https(url)
        if u:
            return _sized(u)
    return ""


_NOT_A_PERSON = re.compile(r"\b(?:staff|editors?|editorial|desk|team|newsroom|press|admin|news|wire|reuters|associated|AFP|bloomberg|"
                           r"contributors?|guest|correspondents?|feed|webmaster|no-?reply|unknown|anonymous|board|report|reporters?|"
                           r"service|magazine|journal|podcast|science|health|media|office|university|institute|society|nasa|npr|bbc|"
                           r"studios?|productions?|network|radio|channel)\b", re.I)
_CREDENTIAL = re.compile(r"(?:,\s*|\s+)(?:MD|M\.D\.|PhD|Ph\.D\.|DO|RN|MPH|MS|MBA|FACR|FACC|Jr\.?|Sr\.?|II|III)\b\.?", re.I)


def byline(e, source: str) -> list[str]:
    """The people who wrote a story, from its feed (author, dc:creator or Atom authors): at most
    three names of two to five words. Outlets, desks, wires and emails are left out."""
    raw = [a.get("name", "") for a in (e.get("authors") or []) if isinstance(a, dict)]
    if not any(raw):
        raw = [(e.get("author_detail") or {}).get("name") or e.get("author") or ""]
    out = []
    for r in raw:
        s = clean_text(r)
        s = re.sub(r"\S+@\S+\s*\(([^)]*)\)", r"\1", s)            # "news@site.com (Jane Doe)"
        s = re.sub(r"\S+@\S+", " ", s)
        s = _CREDENTIAL.sub("", s)
        s = re.sub(r"^\s*by\s+", "", s, flags=re.I)
        for part in re.split(r"\s*(?:,|;|\||&|\band\b)\s*", s):
            part = " ".join(part.strip(" .()-–—").split())
            words = part.split()
            if not (2 <= len(words) <= 5 and len(part) <= 60) or _NOT_A_PERSON.search(part):
                continue
            if not all(re.match(r"[^\W\d_]", w) for w in words) or part.lower() in source.lower() or part in out:
                continue
            out.append(part)
    return out[:3]


def parse_feed(text: str, source: str, now: datetime, verbatim: bool = False, style: str = "") -> list[dict]:
    """RSS, Atom or a Google News sitemap → [{id, title, link, source, date, summary}].
    verbatim: the outlet's terms say not to edit headlines, text or links (ScienceDaily, Medical
    Xpress), so the summary isn't shortened and the link keeps every parameter.
    style "wikipedia": take the headline and link from the blurb (see wikipedia_item)."""
    check_xml(text)
    head = text.lstrip()[:600]
    if "<urlset" in head:
        return _parse_sitemap(text, source, now)
    # Wikipedia's blurbs are read raw (its picture sizes live in attributes the sanitizer drops);
    # every summary is reduced to plain text below either way
    d = feedparser.parse(text, sanitize_html=style != "wikipedia")
    out = []
    for e in d.entries:
        title = clean_text(e.get("title", ""))
        title = title if verbatim else title[:300]
        link = (e.get("link", "") or "").strip() if verbatim else clean_link(e.get("link", "") or "")
        if not title or not link:
            continue
        t = e.get("published_parsed") or e.get("updated_parsed")
        when = datetime(*t[:6], tzinfo=timezone.utc) if t else now
        summary = e.get("summary", "") or (e.get("content") or [{}])[0].get("value", "")
        img = entry_image(e, summary + " " + ((e.get("content") or [{}])[0].get("value", "") or ""))
        if style == "wikipedia":
            got = wikipedia_item(summary)
            if not got:
                continue
            title, link, summary = got
        item = {"id": item_id(link, title, source), "title": title, "link": link, "source": source,
                "date": _utc(min(when, now)), "summary": clean_text(summary) if verbatim else teaser(summary)}
        by = byline(e, source)
        if by:
            item["by"] = by
        audio = _audio(e)                          # podcast episode: playable in the app
        if img and not (audio and "brightspotcdn.com" not in img):     # episode art is mostly the show's, at full size
            item["img"] = img
        if audio:
            item["audio"] = audio
            dur = _duration(e.get("itunes_duration", ""))
            if dur:
                item["duration"] = dur
        out.append(item)
    # some podcast feeds point every episode at the show's home page: tell them apart by title
    shared = Counter(i["link"] for i in out)
    for i in out:
        if shared[i["link"]] > 1:
            i["id"] = item_id(f"{i['link']}#{i['title'].lower()}", i["title"], source)
    return out


def _audio(e) -> str:
    for enc in e.get("enclosures", []) or []:
        href = enc.get("href", "")
        if href.startswith("http") and (str(enc.get("type", "")).startswith("audio") or href.split("?")[0].endswith((".mp3", ".m4a"))):
            return href
    return ""


def _duration(v: str) -> Optional[int]:
    """iTunes duration ('1234', '12:34' or '1:02:03') → minutes."""
    v = str(v or "").strip()
    if not v:
        return None
    try:
        parts = [int(float(x)) for x in v.split(":")]
    except ValueError:
        return None
    secs = parts[0] if len(parts) == 1 else sum(p * 60 ** i for i, p in enumerate(reversed(parts)))
    return max(1, round(secs / 60)) if secs else None


def _parse_sitemap(text: str, source: str, now: datetime) -> list[dict]:
    root = ET.fromstring(text)
    out = []
    for u in root.iter(f"{SITEMAP_NS}url"):
        loc = (u.findtext(f"{SITEMAP_NS}loc") or "").strip()
        news = u.find(f"{NEWS_NS}news")
        if not loc or news is None:
            continue
        title = clean_text(news.findtext(f"{NEWS_NS}title") or "")
        when = parse_date(news.findtext(f"{NEWS_NS}publication_date") or "") or now
        if title:
            link = clean_link(loc)
            out.append({"id": item_id(link, title, source), "title": title, "link": link, "source": source,
                        "date": _utc(min(when, now)), "summary": ""})
    return out


# ── categories ───────────────────────────────────────────────────────────────
def compile_categories(cfg: dict) -> dict:
    out = {}
    for key, c in cfg.items():
        pats = []
        for w in c["words"]:
            esc = re.escape(w).replace(r"\ ", r"[\s-]")
            if w.isupper() and len(w) <= 5:
                pats.append(re.compile(r"(?<![A-Za-z0-9])" + esc + r"(?![A-Za-z])"))
            else:
                pats.append(re.compile(r"(?<![A-Za-z])" + esc, re.I))
        out[key] = pats
    return out


def categorize(item: dict, compiled: dict) -> list[str]:
    text = item["title"] + " " + item.get("summary", "")
    return [k for k, pats in compiled.items() if any(p.search(text) for p in pats)]


# ── the same story across outlets ────────────────────────────────────────────
# words that tie unrelated stories together: dates, and topics every outlet of a kind covers daily
_CALENDAR = set("""january february march april may june july august september october november december jan feb
mar apr jun jul aug sep sept oct nov dec monday tuesday wednesday thursday friday saturday sunday weekly daily
monthly""".split())
STORY_GENERIC = set("""
cancer cancers disease diseases care drug drugs treatment treatments therapy therapies trial trials research
researchers scientists science scientist doctors doctor people women men children kids adults million billion
percent risk risks linked link links data experts expert world global national state states federal government
public life time times day days month months award awards winner winners nominee nominees list lists book books
review reviews fiction story stories series season episode trailer movie film game games
""".split())


def _words(title: str) -> set:
    """Distinctive words of a headline, for telling whether two outlets cover the same story."""
    toks = [part for tok in re.findall(r"[A-Za-z0-9][A-Za-z0-9\-]+", title) for part in tok.split("-")]
    out = set()
    for t in toks:
        lw = t.lower()
        if lw in STOP or lw in NEWS_GENERIC or len(lw) < 3 or lw in _CALENDAR or re.fullmatch(r"\d+(?:s|st|nd|rd|th)?", lw):
            continue
        w = lw[:-1] if lw.endswith("s") and len(lw) >= 4 and not lw.endswith(("ss", "us", "is")) else lw
        if w not in STORY_GENERIC and lw not in STORY_GENERIC:
            out.add(w)
    return out


def _core(cluster: dict) -> set:
    """Words that most of a story's headlines share (all words, for a single headline)."""
    n = len(cluster["words"])
    seen = Counter(x for ws in cluster["words"] for x in ws)
    return {x for x, k in seen.items() if k >= (1 if n == 1 else max(2, math.ceil(n / 2)))}


def top_stories(items: list[dict], now: datetime, days: int = 7, limit: int = 8,
                group_of: Optional[dict] = None, min_outlets: int = 2, match: float = 0.5) -> list[dict]:
    """Stories several publishers covered in the last `days` days, most-covered first.
    `group_of` maps sister outlets to one publisher so syndicated copies count once."""
    group_of = group_of or {}
    cutoff = _utc(now - timedelta(days=days))
    recent = sorted((i for i in items if i["date"] >= cutoff), key=lambda i: i["date"])
    clusters: list[dict] = []
    for it in recent:
        w = _words(it["title"])
        if len(w) < 2:
            continue
        best, best_sim = None, 0.0
        for c in clusters:
            # compare with the story's core (words most of its headlines share), not any one headline:
            # one loose match can't chain unrelated stories together
            core = _core(c)
            inter = len(w & core)
            sim = inter / max(1, min(len(w), len(core)))
            if inter >= 2 and sim >= match and sim > best_sim:
                best, best_sim = c, sim
        if best is not None:
            best["items"].append(it)
            best["words"].append(w)
        else:
            clusters.append({"items": [it], "words": [w]})
    # second pass: headlines arrive in any order, so join stories whose cores match
    joined = True
    while joined:
        joined = False
        for a in range(len(clusters)):
            for b in range(a + 1, len(clusters)):
                ca, cb = _core(clusters[a]), _core(clusters[b])
                inter = len(ca & cb)
                if inter >= 2 and inter / max(1, min(len(ca), len(cb))) >= match:
                    clusters[a]["items"] += clusters[b]["items"]
                    clusters[a]["words"] += clusters[b]["words"]
                    del clusters[b]
                    joined = True
                    break
            if joined:
                break
    out = []
    for c in clusters:
        sources = sorted({i["source"] for i in c["items"]})
        if len({group_of.get(i["source"], i["source"]) for i in c["items"]}) < min_outlets:
            continue
        lead = max(c["items"], key=lambda i: (len(i.get("summary", "")), i["date"]))
        out.append({"title": lead["title"], "date": max(i["date"] for i in c["items"]),
                    "sources": sources, "items": [i["id"] for i in sorted(c["items"], key=lambda i: i["date"], reverse=True)]})
    out.sort(key=lambda c: (len({group_of.get(x, x) for x in c["sources"]}), c["date"]), reverse=True)
    return out[:limit]


# ── death notices ────────────────────────────────────────────────────────────
# "Jane Doe, Pioneering Chemist, Dies at 91", "… Has Died", "… dies aged 79", "Name (1952–2026)",
# and The New York Times's obituary pages (their addresses end in -dead.html).
_OBIT_TITLE = re.compile(
    r"\b(?:dies|died|is dead)\b,?\s+(?:at|aged)\s+(?:age\s+)?\d{1,3}\b"
    r"|\bhas died\b(?=\s*(?:[.,:;!]|$|at\b|aged\b))"
    r"|\bdies\s*:"
    r"|\(\s*\d{4}\s*[–-]\s*\d{4}\s*\)\s*$", re.I)
_OBIT_LINK = re.compile(r"nytimes\.com/.+-dead\.html|/obituar(?:y|ies)/", re.I)
# people whose death is news whoever reports it
HIGH_OFFICE = re.compile(r"\b(?:President|Vice President|Prime Minister|Pope|Chief Justice|Supreme Court|Secretary of State"
                         r"|First Lady|Secretary-General|Emperor|Empress|Monarch|(?:King|Queen) \w+ I{1,3}V?)\b")
_HONORIFIC = {"Sir", "Dame", "Dr", "Lord", "Lady", "Rev", "Mr", "Mrs", "Ms", "Prof", "Gen", "Sen", "Rep", "Gov", "Former", "The",
              "Jr", "Sr", "II", "III", "IV"}


def is_obituary(title: str, link: str = "") -> bool:
    return bool(_OBIT_TITLE.search(title or "") or _OBIT_LINK.search(link or ""))


def _fold(s: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)).lower()


def obit_name(title: str) -> list[str]:
    """The person's name, as the last two capitalized words before the comma, colon or "dies"."""
    head = re.split(r",|:|\(|\s+(?:dies|died|has died|is dead)\b", title or "", maxsplit=1, flags=re.I)[0]
    words = [w.strip("’'\".") for w in head.split()]
    caps = [w for w in words if len(w) > 1 and w[:1].isupper() and w.rstrip(".") not in _HONORIFIC]
    return caps[-2:]


def obit_coverage(item: dict, headlines: list[dict], group_of: Optional[dict] = None, days: int = 3) -> int:
    """How many publishers ran a headline naming the same person within `days` days."""
    group_of = group_of or {}
    name = obit_name(item["title"])
    if not name:
        return 1
    pats = [re.compile(rf"(?<!\w){re.escape(_fold(w))}(?!\w)") for w in name]
    when = parse_date(item["date"]) or datetime.now(timezone.utc)
    lo, hi = _utc(when - timedelta(days=days)), _utc(when + timedelta(days=days))
    groups = {group_of.get(item["source"], item["source"])}
    for h in headlines:
        if lo <= h["date"] <= hi and all(p.search(_fold(h["title"])) for p in pats):
            groups.add(group_of.get(h["source"], h["source"]))
    return len(groups)


def mark_obituaries(items: list[dict], headlines: list[dict], group_of: Optional[dict] = None) -> int:
    """Give each death notice its coverage, so the app can show only those many outlets ran
    (or about someone who held high office)."""
    n = 0
    for it in items:
        it.pop("obit", None)
        if is_obituary(it["title"], it.get("link", "")):
            it["obit"] = {"n": obit_coverage(it, headlines, group_of)}
            if HIGH_OFFICE.search(it["title"]):
                it["obit"]["hi"] = True
            n += 1
    return n


# ── trending phrases in headlines ────────────────────────────────────────────
def trending(archive: list[dict], now: datetime, days: int, prior_days: int, top_n: int = 12,
             group_of: Optional[dict] = None) -> dict:
    """archive: [{id, title, source, date}]. Compares the last `days` days with
    the `prior_days` before. Until enough history builds up, ranks by how many
    outlets covered a phrase instead ("coverage")."""
    r_cut, p_cut = now - timedelta(days=days), now - timedelta(days=days + prior_days)
    recent, prior = [], []
    surfaces: dict[str, Counter] = defaultdict(Counter)
    where: dict[str, list] = defaultdict(list)      # how far into the headline a phrase starts
    for a in archive:
        when = parse_date(a["date"])
        if not when or when < p_cut:
            continue
        edge = NEWS_GENERIC | HEADLINE_VERBS
        ph = {k: v for k, v in phrases(a["title"]).items()
              if not any(w in edge for w in (k.split()[0], k.split()[-1]))}
        low = a["title"].lower()
        for k, v in ph.items():
            surfaces[k][v] += 1
            where[k].append(max(0, low.find(v.lower())) / max(1, len(low)))
        (recent if when >= r_cut else prior).append((a, set(ph)))
    R, P = len(recent), len(prior)
    rc, pc, srcs, ids = Counter(), Counter(), defaultdict(set), defaultdict(list)
    names: dict[str, set] = defaultdict(set)         # outlets as people know them, for the app
    for a, ks in recent:
        for k in ks:
            rc[k] += 1
            srcs[k].add((group_of or {}).get(a["source"], a["source"]))     # sister sites count once
            names[k].add(a["source"])
            ids[k].append((a["date"], a["id"]))
    for _, ks in prior:
        for k in ks:
            pc[k] += 1
    growth = []
    if P >= 40:
        ratio = lambda k: ((rc[k] + 1) / max(R, 1)) / ((pc[k] + 1) / P)
        growth = sorted((k for k in rc if rc[k] >= 3 and len(srcs[k]) >= 2 and ratio(k) >= 1.5),
                        key=lambda k: (-ratio(k) * math.log(rc[k] + 1), k))
    if len(growth) >= 4:
        basis, cands = "growth", growth
    else:                                      # not enough history yet: what most outlets are covering
        basis = "coverage"
        # ties go to the phrase nearer the start of headlines (the subject comes first)
        lead = lambda k: sum(where[k]) / len(where[k]) if where[k] else 1
        cands = sorted((k for k in rc if rc[k] >= 2 and len(srcs[k]) >= 2),
                       key=lambda k: (-len(srcs[k]), -rc[k], lead(k), k))
    chosen: list[str] = []
    docs = {k: {i for _, i in ids[k]} for k in cands[:200]}
    for k in cands:
        if any(_contains(k, c) for c in chosen):
            continue
        # two halves of the same headline ("loses measles elimination" / "elimination status")
        if any(len(docs.get(k, set()) & docs[c]) >= 0.6 * len(docs.get(k, set()) | docs[c]) for c in chosen if c in docs):
            continue
        chosen.append(k)
        if len(chosen) >= top_n:
            break
    return {
        "basis": basis, "days": days, "titles_recent": R, "titles_prior": P,
        "terms": [{"term": display(k, surfaces[k]), "key": k, "count": rc[k], "prior": pc[k],
                   "sources": sorted(names[k]), "ids": [i for _, i in sorted(ids[k], reverse=True)][:20]}
                  for k in chosen],
    }
