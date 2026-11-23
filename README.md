# Readout

A personal body-imaging literature app for your iPhone. It shows each new paper as one full-screen card, led by the **authors' own conclusion, word for word**, mixed with radiology industry news and science and health news. A second tab shows which topics are rising, breaking out, cooling or reaching practice over 1, 2 and 5 years.

- **Feed** (updated daily): new papers from radiology, nuclear medicine and high-impact clinical journals, filtered to abdomen and pelvis. Each card shows the authors' conclusion, an evidence-strength scale, sample size, and topic tags.
- **Explore** (updated weekly): about 30 curated topics, compared with the period before and adjusted for how fast imaging research grows overall. You also get an evidence ladder for each topic, its most-cited papers (NIH iCite), guidelines and consensus papers, newly registered trials (ClinicalTrials.gov), and phrases that are new in or fading from body-imaging titles.
- **News in the same feed** (updated every 6 hours): radiology industry and business headlines (AuntMinnie, Radiology Business, Imaging Technology News, The Imaging Wire, Signify Research, MedTech Dive) and science and health news (STAT, KFF Health News, NPR Health, MedPage Today, BBC Health, ScienceDaily, Science, Nature, Science News, Scientific American, The Conversation, Ars Technica, NIH). Chips at the top switch between Everything, Papers, Industry news and Science & health. In Everything, papers, industry and science take turns, and each science outlet adds at most two stories a day. The first card lists stories several publishers covered this week, and Explore shows trending headline phrases. Tapping **Read** opens the article on the outlet's site.
- **No AI rewriting.** Everything comes from PubMed, iCite and ClinicalTrials.gov. The code that reads abstracts only cuts journal boilerplate (copyright lines, "supplemental material is available…").

It's free to run. GitHub does the daily work and hosts the app, and Safari installs it on your Home Screen. You don't need the App Store, a Mac or an Apple developer account.

---

## Set it up (about 10 minutes, once)

You can do all of this in Safari on your iPhone. A computer is a bit easier.

1. **Make a GitHub repository.** Sign in at github.com and tap **+ → New repository**. Name it `readout` and choose **Public**. Free GitHub Pages only serves public repositories, and nothing in the repository is private: it holds public PubMed data and this code. Your saved papers stay on your phone.
2. **Put these files in it.** Either upload the contents of this folder, or ask Claude to push them for you once the empty repository exists.
3. **Turn on the website.** In the repository go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, then branch **main** and folder **/docs**, and tap **Save**.
4. **(Optional, recommended) Add your NCBI details.** These make PubMed allow faster requests and tell NCBI who to contact if something goes wrong.
   - Create a free API key at https://account.ncbi.nlm.nih.gov/settings/ (under *API Key Management*).
   - In the repository, go to **Settings → Secrets and variables → Actions → New repository secret**.
   - Add `NCBI_API_KEY` set to your key, and `NCBI_EMAIL` set to your email.
5. **Run the first update.** Open the **Actions** tab. If GitHub asks, tap the button to enable workflows. Then:
   - choose **Update feed** and tap **Run workflow**. This takes 1–3 minutes.
   - choose **Update trends** and tap **Run workflow**. This takes 10–30 minutes the first time.
6. **Install it on your iPhone.** Open `https://YOUR-GITHUB-USERNAME.github.io/readout/` in **Safari**. Tap **Share → Add to Home Screen → Add**. It now opens full screen from its own icon.

From then on, the feed updates every morning and the trends every Monday, with no further action from you.

---

## Using it

- **Swipe up** for the next paper. The chips at the top filter by organ system. **Strong evidence** keeps only prospective studies, randomized trials, meta-analyses and guidelines.
- **Abstract** opens the full structured abstract. **PubMed**, **Journal** (DOI) and **Free full text** (when it's in PMC) open in the browser.
- **Save** keeps a paper on your phone even after it leaves the feed. **Saved → Copy list** copies the citations and links.
- Tap a **topic tag** on a card to see only that topic. In **Explore**, tap a topic for its trend page, then **…cards in your feed** to jump back.
- The **ⓘ** button explains how cards are built.

### What the labels mean

| On the card | Meaning |
|---|---|
| Authors’ conclusion | The abstract's labeled Conclusion section, verbatim |
| Last lines of the abstract | The abstract has no section labels, so you see its last two sentences, verbatim |
| Opening of a review | Review articles rarely conclude anything, so you see their first two sentences |
| Solid badge | From PubMed's own indexing (publication type) |
| Dashed badge | Detected from the abstract's wording (e.g. "retrospective"), so treat it as a hint |
| Hot-iron scale | Evidence strength: case report/review → retrospective → prospective → meta-analysis, RCT or guideline |

---

## Make it yours

Everything you'd want to change lives in two text files in `config/`. You can edit them on github.com (tap the file, then the pencil).

- **`config/feeds.yaml`** sets the journals, the abdomen/pelvis word filter, the organ-system chips, and how long cards stay (180 days by default).
- **`config/news.yaml`** lists the news outlets (each with backup feed addresses) and the words behind each business category. The **Update news** run's summary shows which address each outlet is using.
- **`config/topics.yaml`** holds the Explore topics. Each one is a PubMed query, so you can copy a block, give it a new `id` and `name`, and write the query the way you would in PubMed. Add a `trials:` line to also count new ClinicalTrials.gov registrations.

After editing, run **Update trends** from the Actions tab. Its first step, *Check every query against PubMed*, prints a table in the run summary showing how many papers each topic matches, along with any PubMed warnings (for example, a quoted phrase PubMed doesn't recognize). A topic with very few papers usually means the query is too narrow.

---

## How it works

```
GitHub Actions (daily / weekly)
  pipeline/build_feed.py      PubMed E-utilities → parse abstracts → docs/data/feed.json
  pipeline/build_explore.py   PubMed counts + NIH iCite + ClinicalTrials.gov → docs/data/explore.json
GitHub Pages
  docs/                       the app (HTML/CSS/JS, works offline once loaded)
```

- **Trend math:** for each window it compares `papers on topic ÷ all imaging papers` now vs. the period before. So "+40%" means the topic grew 40% faster than imaging research overall, not just that more papers exist.
- **Citations:** NIH iCite's Relative Citation Ratio is field- and time-normalized, so 1.0 is a typical NIH-funded paper. RCR isn't available for the newest papers, so the 1-year view ranks by raw citations and leans on paper counts.
- **Emerging phrases:** these count 1–3 word phrases in body-imaging titles over 10 years and compare recent vs. earlier use. Results are cached in `cache/` so each week only fetches new titles.

### Run it on a computer (optional)

```bash
pip install -r requirements.txt pytest
python -m pytest -q                 # offline tests with synthetic data
python -m pipeline.check_queries    # live: query counts and warnings
python -m pipeline.build_feed       # live: writes docs/data/feed.json
python -m pipeline.build_explore    # live: writes docs/data/explore.json
cd docs && python -m http.server    # open http://localhost:8000
```

### Limits worth knowing

- PubMed sometimes adds abstracts a few days after the record. Those cards say so, and the daily job re-checks them for 30 days.
- Study-design badges and sample sizes come from pattern matching. They're right most of the time, and the dashed badges mark the guesses.
- Paper counts in the most recent months are incomplete in PubMed. The field-growth adjustment cancels most of this, because the baseline has the same lag.
- Scheduled GitHub workflows pause after 60 days without repository activity. The daily feed commit counts as activity, so this only matters if the feed job keeps failing.

Data: PubMed (NLM), NIH iCite, ClinicalTrials.gov. Fonts: Literata and Atkinson Hyperlegible Next, under the SIL Open Font License (see `docs/fonts/`).
