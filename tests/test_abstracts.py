"""Unit tests for parsing and card building.  Run:  python -m pytest -q"""
from pathlib import Path

from pipeline.abstracts import clean, compile_systems, conclusion, design, sample_size, sentences, to_card
from pipeline.common import load_yaml
from pipeline.pubmed import parse_articles
from pipeline.terms import phrases

XML = (Path(__file__).parent / "fixtures" / "pubmed_sample.xml").read_text()
RECS = {r["pmid"]: r for r in parse_articles(XML)}
SYSTEMS = compile_systems(load_yaml("feeds.yaml")["systems"])


def test_parse_basics():
    r = RECS["90000001"]
    assert r["title"].startswith("Abbreviated MRI versus Ultrasound")
    assert "Prospective" in r["title"]                      # inline <i> kept as text
    assert r["journal"] == "Radiology"
    assert r["added"] == "2026-11-18"
    assert r["epub"] == "2026-11-18"
    assert r["doi"] == "10.9999/synthetic.1"
    assert len(r["sections"]) == 5
    assert RECS["90000002"]["ppub"] == "2026"                # MedlineDate
    assert RECS["90000002"]["pmcid"] == "PMC0000002"
    assert RECS["90000004"]["retracted"] is True
    assert RECS["90000003"]["authors"][-1] == "Synthetic Prostate Group"


def test_structured_conclusion_is_verbatim_minus_boilerplate():
    c, extras = conclusion(RECS["90000001"])
    assert c["kind"] == "structured"
    assert c["label"] == "Conclusion"
    assert c["text"] == "Abbreviated MRI detected more early-stage HCC than US, with similar specificity."
    assert extras == []


def test_conclusion_prefers_conclusion_label_and_keeps_extras():
    c, extras = conclusion(RECS["90000003"])
    assert c["text"].startswith("Biparametric MRI performed similarly")
    labels = [e["label"] for e in extras]
    assert "Clinical relevance statement" in labels
    assert "Key points" in labels


def test_trial_registration_stripped_and_clinical_impact_extra():
    c, extras = conclusion(RECS["90000006"])
    assert c["text"] == "Omitting oral contrast did not reduce accuracy."
    assert extras[0]["label"] == "Clinical impact"


def test_unstructured_review_uses_opening():
    c, _ = conclusion(RECS["90000002"])
    assert c["kind"] == "opening"
    assert c["text"].startswith("Pancreatic cysts are found")
    assert "e.g. a central scar vs. communication" in c["text"]   # abbreviations didn't split
    assert "©" not in c["text"]


def test_unstructured_research_uses_closing_lines():
    c, _ = conclusion(RECS["90000004"])
    assert c["kind"] == "closing"
    assert c["text"] == "Radiomics may predict grade before surgery. Further validation is needed."


def test_no_abstract():
    c, _ = conclusion(RECS["90000005"])
    assert c["kind"] == "none"


def test_design_badges():
    d1 = {b["label"] for b in design(RECS["90000001"])["badges"]}
    assert {"Prospective", "Multicenter"} <= d1
    d3 = design(RECS["90000003"])
    assert "Meta-analysis" in {b["label"] for b in d3["badges"]}
    assert d3["strength"] == 4
    d4 = {b["label"] for b in design(RECS["90000004"])["badges"]}
    assert "Retrospective" in d4
    d6 = design(RECS["90000006"])
    assert any(b["label"] == "Randomized trial" and b["source"] == "pubmed" for b in d6["badges"])


def test_sample_size():
    assert sample_size(RECS["90000001"]) == "1,284 participants"
    assert sample_size(RECS["90000003"]) == "31 studies"
    assert sample_size(RECS["90000004"]) == "212 patients"
    assert sample_size(RECS["90000006"]) == "n = 640"


def test_systems():
    assert to_card(RECS["90000001"], SYSTEMS)["systems"][0] == "liver"
    assert "pancreas_biliary" in to_card(RECS["90000002"], SYSTEMS)["systems"]
    assert "gu" in to_card(RECS["90000003"], SYSTEMS)["systems"]
    s5 = to_card(RECS["90000005"], SYSTEMS)["systems"]
    assert "pancreas_biliary" in s5 and "tech_ai" in s5


def test_clean_and_sentences():
    assert clean("Works well. © 2026 Elsevier B.V. All rights reserved.") == "Works well."
    assert clean("Done. Published under a CC BY 4.0 license.") == "Done."
    assert sentences("AUC was 0.91. Next sentence.") == ["AUC was 0.91.", "Next sentence."]
    # enumerations like (c) are not copyright notices
    assert clean("We tested (a) CT, (b) MRI and (c) US.") == "We tested (a) CT, (b) MRI and (c) US."


def test_phrases():
    p = phrases("Photon-Counting CT for Pancreatic Cancer Detection")
    assert "photon counting ct" in p and p["photon counting ct"] == "Photon-Counting CT"
    assert "ct" not in p                      # bare acronym dropped
    assert "for pancreatic" not in p          # stopword edge
    p2 = phrases("Large language models: a review")
    assert "large language models" in p2
    assert "models a" not in p2               # no joining across ':'


def test_inline_conclusion_heading():
    rec = {"title": "AI for prostate MRI", "journal": "Radiology", "pub_types": [],
           "sections": [{"label": "", "cat": "", "text": "Background Screening is hard. Purpose To test AI. "
                         "Results AUC was 0.91 (95% CI: 0.88, 0.93). Conclusion AI performed comparably to radiologists. "
                         "© RSNA, 2026"}]}
    c, _ = conclusion(rec)
    assert c["kind"] == "structured"
    assert c["text"] == "AI performed comparably to radiologists."
    # "conclusion" inside a normal sentence is not a heading
    rec2 = {"title": "x", "journal": "J", "pub_types": [],
            "sections": [{"label": "", "cat": "", "text": "We reached no firm conclusion about dosing in this group. More data are needed soon."}]}
    assert conclusion(rec2)[0]["kind"] == "closing"


def test_refresh_reprocesses_stored_card():
    from pipeline.abstracts import refresh
    card = {"title": "t", "journal": "Radiology", "pub_types": [],
            "sections": [{"label": "", "cat": "", "text": "Results It worked well overall. Conclusion The method is accurate and fast."}],
            "conclusion": {"kind": "closing", "label": "x", "text": "old"}}
    refresh(card, SYSTEMS)
    assert card["conclusion"]["text"] == "The method is accurate and fast."
