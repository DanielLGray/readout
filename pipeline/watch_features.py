"""What Rate can say something about in a Watch change (company, device type, kind of change…),
for the notify job; the app's wFeatures (docs/watch.js) does the same. Only the standard library, so
the notify job needs nothing more installed."""
from __future__ import annotations

import re


def _parts(e: dict) -> list[str]:
    return [p.strip() for p in str(e.get("sub") or "").split(" · ") if p.strip()]


def org_of(e: dict) -> str:
    """The company or sponsor; older events carry it only in their subline."""
    if e.get("org"):
        return str(e["org"])[:100]
    parts, k = _parts(e), e.get("kind")
    if k == "device" and parts and not parts[0].startswith("product code"):
        return parts[0][:100]
    if k == "drug" and parts:
        return parts[0][:100]
    if k == "trial":
        rest = [p for p in parts if not p.startswith("Phase ") and not re.search(r"\bpatients$", p)]
        return rest[-1][:100] if rest else ""
    return ""


def code_of(e: dict) -> str:
    if e.get("pc"):
        return str(e["pc"])
    m = re.search(r"\bproduct code ([A-Z0-9]{3})\b", str(e.get("sub") or ""))
    return m[1] if m else ""


def phase_of(e: dict) -> str:
    if e.get("kind") != "trial":
        return ""
    return str(e.get("ph") or next((p for p in _parts(e) if p.startswith("Phase ")), ""))


def change_of(e: dict) -> str:
    """What kind of change: 510k, denovo, pma-new, pma-ind, drug-new, drug-ind, new, status, results, pcd,
    final, proposed, notice."""
    k, i, what = e.get("kind"), str(e.get("id") or ""), str(e.get("what") or "")
    if k == "device":
        return ("pma-new" if what.startswith("New device") else "pma-ind") if i.startswith("pma:") else "denovo" if i.startswith("device:DEN") else "510k"
    if k == "drug":
        return "drug-new" if what.startswith("New drug") else "drug-ind"
    if k == "trial":
        code = i.split(":", 2)[2] if i.count(":") >= 2 else ""
        return code.split("-")[0] if code.split("-")[0] in ("new", "status", "results", "pcd") else ""
    if k == "rule":
        head = what.split(";")[0].strip().lower()
        return "final" if head == "final rule" else "proposed" if head == "proposed rule" else "notice"
    return ""


def features(e: dict) -> list[str]:
    """What Rate can say something about: wk kind, wt topic, wc kind of change, wp device type (product
    code), wa AI, wo company or sponsor, wph phase."""
    f = [f"wk:{e.get('kind')}"]
    if e.get("topic") and e["topic"] not in ("devices", "drugs"):
        f.append(f"wt:{e['topic']}")
    for pre, v in (("wc", change_of(e)), ("wp", code_of(e))):
        if v:
            f.append(f"{pre}:{v}")
    if e.get("kind") == "device" and e.get("ai"):
        f.append("wa:ai")
    for pre, v in (("wo", org_of(e)), ("wph", phase_of(e))):
        if v:
            f.append(f"{pre}:{v}")
    return f
