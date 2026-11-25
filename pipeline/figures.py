"""Pictures for the cards: one figure from each paper that's open access under a Creative
Commons license, credited, resized, and kept beside the data files.

    docs/data/figs/PMC13788141.webp

Where they come from: the PMC Article Datasets on AWS, which NLM provides for automated
retrieval (the PMC website itself is off limits to scripts). Each article's metadata gives
its license; the article XML gives each figure's label, caption and image file.

Which figure: radiology is visual, so the first one that shows images (CT, MRI, ultrasound,
PET, "a 64-year-old man…") rather than a flowchart, a study diagram or a graph. Papers whose
figures are all charts get no picture.

Every Creative Commons license allows sharing a figure unchanged, with credit, for a
noncommercial reader like this one. Resizing for a phone screen is the kind of technical
change the licenses allow; the app credits the authors and links the license and article.
"""
from __future__ import annotations

import io
import json
import os
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Iterable, Optional
from xml.etree import ElementTree as ET

from .common import CACHE, DATA, read_json, today, write_json
from .http import Http, HttpError, log

S3 = "https://pmc-oa-opendata.s3.amazonaws.com"
IDCONV = "https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/"
FIGS = "figs"
MAX_SIDE = 960              # pixels: sharp on a phone, ~40–100 KB as WebP
QUALITY = 74
RECHECK_NONE = 21           # days before asking again about an article that had no usable figure
LOOKUP_DAYS = 120           # look up PMCIDs for papers this young (older ones have theirs by now)

_CC = re.compile(r"^CC(?:0| BY(?:-NC)?(?:-SA|-ND)?)$")
_LICENSE_URL = {"CC0": "https://creativecommons.org/publicdomain/zero/1.0/"}
_FLOW = re.compile(r"flow ?(?:chart|diagram)|study (?:flow|design|selection|population|profile)|patient (?:selection|enrol|inclusion|recruit)"
                   r"|inclusion and exclusion|enrol+ment|\bSTARD\b|\bCONSORT\b|\bPRISMA\b|schemat|workflow|pipeline|framework|architecture"
                   r"|overview of (?:the )?(?:study|method|model)|graphical abstract|timeline", re.I)
_PLOT = re.compile(r"\bROC\b|receiver operating|\bcurves?\b|Kaplan|survival|forest plot|bar (?:chart|graph)|box(?:-and-whisker)? ?(?:plot|graph)"
                   r"|scatter|Bland|calibration|decision curve|heat ?map|correlation|histogram|nomogram|SHAP|violin|waterfall plot", re.I)
_IMAGE = re.compile(r"\b(?:CT|MRI|MR|PET|SPECT|PET/CT|PET/MRI|US|ultrasound|sonograph\w*|radiograph\w*|images?|scans?|axial|coronal|sagittal"
                    r"|T1\w*|T2\w*|weighted|DWI|ADC|contrast-enhanced|arterial phase|portal venous|hepatobiliary phase|fused|fusion"
                    r"|maximum intensity projection|MIP|fluoroscop\w*|angiogra\w*|elastogra\w*|Doppler|representative|example|case)\b", re.I)
_PATIENT = re.compile(r"\b\d{1,3}-year-old\b|\b(?:man|woman|boy|girl|patient) (?:with|who)\b", re.I)


def figure_score(label: str, caption: str, index: int) -> float:
    """Higher is more like a picture worth showing. Below zero: not a picture."""
    text = f"{label} {caption}"
    s = -0.2 * index
    if _FLOW.search(text):
        s -= 10
    if _PLOT.search(text):
        s -= 4
    if _IMAGE.search(text):
        s += 5
    if _PATIENT.search(text):
        s += 4
    return s


def _text(el: Optional[ET.Element]) -> str:
    return " ".join("".join(el.itertext()).split()) if el is not None else ""


def parse_figures(xml: str) -> "tuple[list[dict], str]":
    """[{label, caption, href}] in document order, and the license URL the article states."""
    if re.search(r"<!ENTITY|<!DOCTYPE[^>\[]*\[", xml[:200_000], re.I):     # entity tricks: refuse
        raise ValueError("article XML declares entities; refused")
    xml = re.sub(r"<!DOCTYPE[^>]*>", "", xml, count=1)
    root = ET.fromstring(xml)
    xl = "{http://www.w3.org/1999/xlink}href"
    lic = ""
    for el in root.iter():
        tag = el.tag.split("}")[-1]
        if tag == "license" and el.get(xl, "").startswith("http"):
            lic = el.get(xl)
            break
        if tag == "license_ref" and (el.text or "").strip().startswith("http"):
            lic = el.text.strip()
            break
    figs = []
    for fig in root.iter("fig"):
        g = next((x for x in fig.iter() if x.tag.split("}")[-1] == "graphic" and x.get(xl)), None)
        if g is None:
            continue
        cap = fig.find("caption")
        figs.append({"label": _text(fig.find("label")), "caption": _text(cap), "href": g.get(xl)})
    return figs, lic


def pick(figs: list[dict]) -> Optional[dict]:
    scored = [(figure_score(f["label"], f["caption"], i), i, f) for i, f in enumerate(figs) if f["caption"] or f["label"]]
    scored = [x for x in scored if x[0] >= 3]                  # must read as an image, not a chart
    return max(scored, key=lambda x: (x[0], -x[1]))[2] if scored else None


def shrink(data: bytes) -> "tuple[bytes, int, int]":
    """Any image PMC ships → a WebP no larger than MAX_SIDE on its long side."""
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = 60_000_000          # anything bigger is refused, not decoded
    im = Image.open(io.BytesIO(data))
    if im.format not in ("JPEG", "PNG", "GIF", "WEBP", "TIFF"):
        raise ValueError(f"not a picture format: {im.format}")
    im.load()
    if im.width < 160 or im.height < 120:
        raise ValueError("too small to be useful")
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (0, 0, 0))
        bg.paste(im, mask=im.split()[-1])
        im = bg
    im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, "WEBP", quality=QUALITY, method=5)
    return out.getvalue(), im.width, im.height


def license_url(code: str, stated: str) -> str:
    if re.match(r"^https?://creativecommons\.org/", stated or ""):
        return stated.replace("http://", "https://")
    if code in _LICENSE_URL:
        return _LICENSE_URL[code]
    return "https://creativecommons.org/licenses/" + code.replace("CC ", "").lower() + "/4.0/"


def _s3(url: str) -> str:
    return url.split("?")[0].replace("s3://pmc-oa-opendata", S3)


def media_for(href: str, urls: list[str]) -> Optional[str]:
    """The image file a figure's <graphic> points to. The XML often leaves off the extension."""
    names = {_s3(u).rsplit("/", 1)[-1]: _s3(u) for u in urls}
    if href in names:
        return names[href]
    base = re.sub(r"\.(?:jpe?g|png|gif|tiff?|webp)$", "", href, flags=re.I)
    for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".tif", ".tiff"):      # smallest formats first
        if base + ext in names:
            return names[base + ext]
    return None


def latest_metadata(http: Http, pmcid: str) -> Optional[str]:
    """The metadata key of the article's highest version, or None if it isn't in the open dataset."""
    xml = http.get_text(f"{S3}/", {"list-type": "2", "prefix": f"metadata/{pmcid}."})
    keys = re.findall(r"<Key>(metadata/PMC\d+\.(\d+)\.json)</Key>", xml)
    return max(keys, key=lambda k: int(k[1]))[0] if keys else None


def figure_for(http: Http, pmcid: str, folder: Path) -> "tuple[Optional[dict], str]":
    """Download, choose and save one figure. Returns (figure info, why-not)."""
    key = latest_metadata(http, pmcid)
    if not key:
        return None, "not in the open-access dataset"
    meta = http.get_json(f"{S3}/{key}", {})
    code = str(meta.get("license_code") or "").strip()
    if not _CC.match(code) or meta.get("is_manuscript") or meta.get("is_retracted"):
        return None, f"license {code or 'unknown'}"
    if not meta.get("xml_url"):
        return None, "no article XML"
    figs, stated = parse_figures(http.get_text(_s3(meta["xml_url"]), {}))
    best = pick(figs)
    if not best:
        return None, f"no picture among {len(figs)} figures"
    url = media_for(best["href"], meta.get("media_urls") or [])
    if not url:
        return None, "figure file missing"
    img, w, h = shrink(http.get_bytes(url))
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{pmcid}.webp").write_bytes(img)
    cap = best["caption"]
    return {"src": f"{FIGS}/{pmcid}.webp", "w": w, "h": h, "n": best["label"] or "Figure",
            "cap": cap if len(cap) <= 1200 else cap[:1199].rsplit(" ", 1)[0] + "…",
            "lic": code, "lu": license_url(code, stated)}, ""


def lookup_pmcids(http: Http, cards: list[dict], cache: dict, t: date) -> int:
    """PubMed records get their PMCID a little after the paper appears; ask PMC for any missing."""
    seen = cache.setdefault("idconv", {})
    want = []
    for c in cards:
        if c.get("pmcid") or not str(c.get("pmid", "")).isdigit():
            continue
        added = str(c.get("added") or c.get("epub") or "")[:10]
        try:
            young = (t - date.fromisoformat(added)).days <= LOOKUP_DAYS
        except ValueError:
            young = False
        last = seen.get(c["pmid"], "")
        if young and last < (t - timedelta(days=3)).isoformat():
            want.append(c)
    found = 0
    for i in range(0, len(want), 150):
        batch = want[i:i + 150]
        try:
            q = {"ids": ",".join(c["pmid"] for c in batch), "format": "json", "tool": "readout"}
            if os.environ.get("NCBI_EMAIL", "").strip():
                q["email"] = os.environ["NCBI_EMAIL"].strip()
            data = http.get_json(IDCONV, q)
        except HttpError as exc:
            log(f"  PMCID lookup failed ({exc}); trying again next run")
            break
        got = {str(r.get("pmid")): r.get("pmcid") for r in data.get("records", []) if r.get("pmcid")}
        for c in batch:
            seen[c["pmid"]] = t.isoformat()
            if re.match(r"^PMC\d+$", str(got.get(c["pmid"], ""))):
                c["pmcid"] = got[c["pmid"]]
                found += 1
    cutoff = (t - timedelta(days=LOOKUP_DAYS + 30)).isoformat()
    cache["idconv"] = {k: v for k, v in seen.items() if v >= cutoff}
    return found


def attach(http: Http, cards: Iterable[dict], data: Path = DATA, cache_dir: Path = CACHE,
           budget: int = 60, lookup: bool = True, job: str = "feed") -> dict:
    """Give each card with an open-access PMCID its figure (card["fig"]). At most `budget`
    new articles are asked about per run; the rest wait for the next one. Each job keeps its own
    notes (cache/figures-<job>.json), so jobs running at the same time never edit the same file."""
    cards = list(cards)
    t = today()
    path = cache_dir / f"figures-{job}.json"
    cache = read_json(path, {}) or {}
    done = cache.setdefault("figs", {})
    folder = data / FIGS
    stats = {"pmcids_found": lookup_pmcids(http, cards, cache, t) if lookup else 0, "new": 0, "none": 0, "errors": 0}
    for c in cards:
        c.pop("fig", None)
        pmcid = str(c.get("pmcid") or "")
        if not re.match(r"^PMC\d+$", pmcid):
            continue
        rec = done.get(pmcid)
        if rec and rec.get("fig") and (folder / f"{pmcid}.webp").exists():
            c["fig"] = rec["fig"]
            continue
        if rec and not rec.get("fig") and rec.get("t", "") >= (t - timedelta(days=RECHECK_NONE)).isoformat():
            continue
        if budget <= 0:
            continue
        budget -= 1
        try:
            fig, why = figure_for(http, pmcid, folder)
        except (HttpError, ValueError, OSError, ET.ParseError) as exc:
            stats["errors"] += 1
            log(f"  figure for {pmcid}: {type(exc).__name__}: {str(exc)[:120]}")
            done[pmcid] = {"t": t.isoformat(), "why": "error"}
            continue
        except Exception as exc:          # a broken image file must never sink the job
            stats["errors"] += 1
            log(f"  figure for {pmcid}: {type(exc).__name__}: {str(exc)[:120]}")
            done[pmcid] = {"t": t.isoformat(), "why": "error"}
            continue
        done[pmcid] = {"t": t.isoformat(), "fig": fig} if fig else {"t": t.isoformat(), "why": why}
        if fig:
            c["fig"] = fig
            stats["new"] += 1
        else:
            stats["none"] += 1
    cutoff = (t - timedelta(days=400)).isoformat()
    cache["figs"] = {k: v for k, v in done.items() if v.get("t", "") >= cutoff}
    write_json(path, cache, compact=False)
    log(f"Figures: {sum(1 for c in cards if c.get('fig'))} cards with a picture; {stats['new']} new, "
        f"{stats['none']} articles without a usable one, {stats['errors']} errors, {stats['pmcids_found']} PMCIDs found")
    return stats


def prune(data: Path = DATA, data_files: Iterable[str] = ("feed.json", "important.json", "library.json")) -> int:
    """Delete figure files no data file uses any more."""
    used = set()
    for name in data_files:
        d = read_json(data / name, None)
        if d is None:
            return 0                    # a file missing or unreadable: don't guess, keep everything
        text = json.dumps(d)
        used.update(re.findall(r"figs/(PMC\d+)\.webp", text))
    n = 0
    for f in (data / FIGS).glob("PMC*.webp"):
        if f.stem not in used:
            f.unlink()
            n += 1
    if n:
        log(f"Figures: removed {n} no longer used")
    return n
