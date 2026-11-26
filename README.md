# Readout

A personal body-imaging literature app for your iPhone. It shows each new paper as one full-screen card, led by the **authors' own conclusion, word for word**, mixed with radiology industry news and science and health news. A second tab shows which topics are rising, breaking out, cooling or reaching practice over 1, 2 and 5 years.

- **Feed** (updated daily): new papers from radiology, nuclear medicine and high-impact clinical journals, filtered to abdomen and pelvis. Each card shows the authors' conclusion, an evidence-strength scale, sample size, and topic tags.
- **Explore** (updated weekly): about 30 curated topics, compared with the period before and adjusted for how fast imaging research grows overall. You also get an evidence ladder for each topic, its most-cited papers (NIH iCite), guidelines and consensus papers, newly registered trials (ClinicalTrials.gov), and phrases that are new in or fading from body-imaging titles.
- **Light reading and general news** (updated every 6 hours): curiosities, history, nature, books, food and wellness from Wikipedia (today's featured article and picture of the day), NASA's Image of the Day, Atlas Obscura, Smithsonian, Knowable Magazine, NYT Well and NPR; the day's top and national stories from NPR, The New York Times, The Wall Street Journal and the BBC; and business and markets news from WSJ, MarketWatch, NYT Business, NPR and Planet Money. Each has its own chip and a turn in Everything, and Today ends with **something lighter**.
- **News in the same feed** (updated every 6 hours): radiology industry and business headlines (AuntMinnie, Radiology Business, Imaging Technology News, The Imaging Wire, Signify Research, MedTech Dive) and science and health news (The New York Times, STAT, KFF Health News, NPR, MedPage Today, BBC Health, ScienceDaily, Phys.org, Science, Nature, Science News, Scientific American, The Conversation, Ars Technica, NIH and more). Chips at the top switch between Today, Everything, Papers and each kind of news. In Everything they take turns, and each busy outlet adds at most two stories a day. Story cards show the picture the outlet puts in its feed. The first card lists stories several publishers covered this week, and Explore shows trending headline phrases. Tapping **Read** opens the article on the outlet's site.
- **Today** (the view it opens on): a short stack each morning with the best new papers for your areas (two hide their conclusion so you can **guess the result**), the stories most outlets covered, the **classic of the day** and your next **Foundations** paper, ending with "You're caught up."
- **Pictures:** papers that are open access under a Creative Commons license show one figure, a CT, MRI, ultrasound or PET image rather than a chart, credited and linked.
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
   - Optional: `TMDB_TOKEN`, a free TMDB API Read Access Token (themoviedb.org → Settings → API), so sci-fi and fantasy release dates come from TMDB every day instead of the hand-checked list.
   - Tune → Updates → **Set up** in the app shows which of these are in place.
5. **Run the first update.** Open the **Actions** tab. If GitHub asks, tap the button to enable workflows. Then:
   - choose **Update feed** and tap **Run workflow**. This takes 1–3 minutes.
   - choose **Update trends** and tap **Run workflow**. This takes 10–30 minutes the first time.
6. **Install it on your iPhone.** Open `https://YOUR-GITHUB-USERNAME.github.io/readout/` in **Safari**. Tap **Share → Add to Home Screen → Add**. It now opens full screen from its own icon.

From then on, the feed updates every night (11:17 PM Eastern, inside NCBI's off-peak hours for large jobs), news about every six hours and the trends every week, with no further action from you. GitHub sometimes skips or delays scheduled runs when it's busy, so each job has backup times that skip themselves once the update has happened (`pipeline/due.py`).

---

## Using it

- **Coming up:** a card in Today shows the next 7 days of events you follow, and Explore → Coming up shows 90 days by week: Fed decisions, jobs/CPI/GDP/PCE reports, stock market holidays and earnings (markets); your meetings, FDA imaging and heart-device panels and J.P. Morgan Healthcare week (medicine); notable launches and eclipses (science); CES and other set dates (news); IRS deadlines, new contribution limits, the big sales weekends and each month's usual good buys (personal finance, worked out each year from the IRS's rules and the holiday calendar); awards nights, festivals, Comic-Con and Burning Man (culture); and the big sci-fi and fantasy releases (movies), plus events expected without a date yet. Explore → Coming up can show the next 12 months. A daily job (`pipeline/build_horizon.py`, `.github/workflows/horizon.yml`) reads the Federal Reserve, BLS and BEA calendars (BLS turns away GitHub's servers, so its published schedule is kept in the config and added to each fall), FDA meeting notices in the Federal Register and Launch Library 2, adds NYSE holidays and the hand-checked dates in `config/horizon.yaml`, and writes `docs/data/horizon.json` plus `.ics` files: tap an event for **Add to Calendar**, or **Subscribe in Calendar** for all of them. Earnings dates come to your phone from Alpha Vantage with your own free key (Tune → Interests → Coming up); the key stays on the phone, out of backups, and is sent only to alphavantage.co about once a day. Choose the event types and the companies to watch in the same place.
- **Weather:** a slim strip under the chips shows today's and tomorrow's high, low and forecast for Reno, NV (and the chance of rain or snow when it's 30% or more), from the National Weather Service. Tap it for the detailed forecast. Your phone fetches it from api.weather.gov (NOAA, public domain) about every half hour and on pull-down; turn it off in Tune → Reading.
- **Pull down** on the first card to check for new papers and news. With a GitHub token in Tune → Updates, pulling down also runs the news update on GitHub and brings the result back in about 2 minutes. **Tap a headline** to open it (the article for a story, the abstract for a paper). Cards you've already seen go to the end of each list, marked *Seen*, whenever a list starts fresh.
- **Swipe a card sideways:** left saves it to Saved (the card stays), right clears it and the next card slides into its place, with **Undo** for a few seconds. Cleared cards stay out of every list for 90 days; Tune → Rules → Feed mix can bring them all back or turn swiping off.
- **Why?** in the toast after a clear asks why: **Already know it**, **Not for me** (fewer cards like it: the same as *Less like this* in Rate), **Weak study** (papers only) or **Not now** (the card comes back in 3 days). Only *Not for me* changes what you see; Tune → Rules shows the tally.
- **Alerts** are rare cards pinned at the top of Everything and Today for a week: FDA approvals and safety warnings for radiopharmaceuticals and imaging agents (contrast, PET and SPECT tracers, radioligand therapy), and guideline changes from the USPSTF, the American Cancer Society and the imaging and cardiac societies. The news job (`pipeline/alerts.py`) makes one only when two different publishers carry a story, or when the FDA's own feeds or a society's do; the papers job adds new guidelines straight from PubMed: USPSTF recommendation statements, American Cancer Society guidelines in *CA*, and statements from the ACR, SAR, SNMMI, EANM, SCCT, the Fleischner Society, ACC/AHA, ESC and AASLD. At most two show at once; **Dismiss** removes one, and Tune → Rules → Alerts turns each kind off or lists the week's alerts. The rules are in `config/news.yaml` and `config/feeds.yaml` (both under `alerts:`).
- **Compact cards:** each card is as tall as what it holds, so several fit on a screen; very long conclusions continue in the abstract. Tune → Reading → Cards switches a phone back to one card per screen (swipe up for the next).
- **iPad and computer:** wider screens get the feed in columns (masonry, so short cards leave no gaps), weather and the meeting banner side by side, sheets as a centred window, Explore in two columns, and on wide screens the tabs down the left. It switches by itself with the window's width. With a mouse, a small ✕ on the card you point at clears it.
- The chips at the top filter by organ system. **Strong evidence** keeps only prospective studies, randomized trials, meta-analyses and guidelines.
- **Search** (magnifier, top right) finds any paper or story on your phone by words, author or journal: the feed, Most important, Explore, news and Saved. Accents don't matter.
- **Abstract** opens the full structured abstract. **PubMed**, **Journal** (DOI) and **Free full text** (when it's in PMC) open in the browser; **Copy citation** copies an AMA-style reference. Add your library's off-campus link in **Tune → Reading → Library access** and **Journal** opens articles through your institution's subscriptions.
- **Save** keeps a paper on your phone even after it leaves the feed. **Saved → Copy list** copies a numbered AMA reference list. **Tune → Reading → Back up** saves your saved items, settings and cleared cards to a file (Files, iCloud Drive) to restore on a new phone.
- **Text size** (Tune → Reading) makes conclusions, headlines and abstracts larger or smaller.
- **Today** opens the app: a handful of new papers chosen for your areas (no more than two from one organ system), the day's big stories, the classic of the day and your next Foundations paper, then the end. **Guess the result** cards show the study's question and methods; tap to see the authors' conclusion and say whether you called it. Choose how many papers and stories, whether guesses appear only in Today or everywhere, and which view the app opens on, in **Tune → Reading → Today**.
- **Outside your areas:** one paper a day in Today from NEJM, The Lancet, JAMA, BMJ, Nature Medicine, Annals and the big oncology and cardiology journals: papers from the last six months that none of your area searches found (imaging papers are left out, since your areas have them), ranked by early citations per month (NIH iCite) and study design, so a large trial beats a cohort study cited as often. The weekly Most important job picks about 40 (`wide:` in `config/feeds.yaml`); each shows once. Turn it off in Tune → Reading → Today.
- **Classic of the day:** a highly cited paper at least five years old from one of your areas (ranked by citations per year, NIH iCite), different each day; areas you weight more come round more often. It also sits a few cards into Everything.
- **Foundations** (top of Explore): a reading path of about 45 guidelines, reporting systems and landmark studies for body imaging, in groups (Start here, liver, pancreas, kidneys, female pelvis, prostate, bowel, technique, cardiac CT…). Tap the circle to mark one read; progress shows as "14 of 44 read" and Today brings you the next one. The list is `config/foundations.yaml`.
- **Rate** on a card opens **What do you think?**: choose More, Less, Same or Hide for each thing about it (its organ system, topic, journal, kind of study, outlet, and subjects such as AI, children or animal studies), or tap **More like this** / **Less like this** to nudge them all a little. More-liked cards move up the feed, less-liked move down, hidden ones leave every list. You can also follow or mute a phrase from the title (tap it to trim it first, say “PSMA PET/CT” down to “PSMA”) or type your own with **＋ Your own**, which shows how many cards it matches; or change the card's area. Everything you've said is in **Tune → Interests → What you like**, to change or undo.
- **Meetings:** four months before RSNA, SNMMI, SCCT, ARRS, ECR and the others in `config/meetings.yaml`, a banner under the chips counts down (✕ closes it). From a week before until a week after, a chip gathers every story that mentions the meeting. Turn meetings on or off in **Tune → Interests → Meetings**.
- **Pictures** come from NLM's PMC Open Access dataset on AWS (the route NLM provides for automated downloads), only for articles under a Creative Commons license, resized for a phone and credited with the figure number, license and a link to the article. Tap one for its caption; **Zoom** opens it full size. Turn them off in **Tune → Reading**.
- Tap a **topic tag** on a card to see only that topic. In **Explore**, tap a topic for its trend page, then **…cards in your feed** to jump back.
- The **ⓘ** button explains how cards are built.
- **Most important** (a chip in the feed) lists the papers cited far more than others of the same age. It draws on every paper from your journals over the last three years, ranked by citations against body-imaging papers from the same quarter (NIH iCite). **1 year** and **3 years** show proven original research; **New** covers the last six months, where a paper's journal record stands in until citations arrive. You can include reviews and guidelines, or open the app on this view, in Tune. It's rebuilt every Tuesday.
- **Interests** (Tune → Interests): papers come from four areas: **nuclear medicine** (every paper in the NM journals), **body imaging**, **cardiac & vascular CT** (TAVR planning, CCTA, CT-FFR, calcium) and **general radiology** (Radiology, AJR, RadioGraphics, JACR). Set each to Off, Less, Normal or More; follow words like "TAVR" to get a **Following** chip; choose which organ-system chips show. Under **Papers** and **Most important**, area chips narrow the list to one area. **ACR & societies** carries ACR, SNMMI and RSNA press releases (through Medical Xpress, whose feed terms allow this), SCCT's own news feed, and industry stories that mention a radiology society.
- **Tune** has four parts (Reading, Interests, Rules, Updates):
  - **Your reading:** what you read and opened over 7 or 30 days, by kind, outlet and organ system, plus what's in your feed right now. It's counted only on your phone.
  - **Feed rules:** how many turns each kind gets in Everything, the per-outlet daily limit, newest-first or ranked paper order (freshness × evidence, study size, labeled conclusion and your organ systems), muted words and outlets, and Explore's trend thresholds. Changes apply on your phone right away.
  - **Updates:** how each update job is doing, data-quality figures, the job's current settings, and buttons to edit its config file or run it on GitHub.

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

Everything you'd want to change lives in text files in `config/`. You can edit them on github.com (tap the file, then the pencil), or jump there from **Tune → Updates**. Feed order, mutes and trend thresholds for your own phone are set in **Tune → Feed rules** instead and need no editing.

- **`config/feeds.yaml`** sets the interest areas (and how long each keeps papers), their journals and PubMed searches ("streams"), the abdomen/pelvis word filter and the organ-system chips. Any block can be used in a search as `{name}`.
- **`config/news.yaml`** lists the news outlets (each with backup feed addresses) and the words behind each business category. Its `settings:` also set how long stories stay, what counts as a top story and the trending windows. The **Update news** run's summary shows which address each outlet is using.
- **`config/foundations.yaml`** is the Foundations reading path: each entry has a label, a one-line reason and a PubMed search (the most-cited match is used) or a pinned `pmid:`. Its `classics:` block sets how old and how many the classics are. Rebuilt on the 3rd of each month by **Update foundations and classics**, or run it from Actions after editing.
- **`config/meetings.yaml`** lists meetings with their dates, place, website and the words that mark a story as about them. Add next year's as their dates are announced.
- **`config/topics.yaml`** holds the Explore topics and, under `settings:`, the trend rules (what counts as a breakout, rising or cooling topic). It also controls how many papers a topic needs before it can trend. Each topic is a PubMed query, so you can copy a block, give it a new `id` and `name`, and write the query the way you would in PubMed. Add a `trials:` line to also count new ClinicalTrials.gov registrations.

After editing, run **Update trends** from the Actions tab. Its first step, *Check every query against PubMed*, prints a table in the run summary showing how many papers each topic matches, along with any PubMed warnings (for example, a quoted phrase PubMed doesn't recognize). A topic with very few papers usually means the query is too narrow.

---

## How it works

```
GitHub Actions (daily / weekly)
  pipeline/build_feed.py      PubMed E-utilities → parse abstracts → docs/data/feed.json
  pipeline/build_explore.py   PubMed counts + NIH iCite + ClinicalTrials.gov → docs/data/explore.json
  pipeline/build_library.py   Foundations + classics (monthly) → docs/data/library.json
  pipeline/figures.py         PMC Open Access (AWS) → one credited figure per CC-licensed paper → docs/data/figs/
GitHub Pages
  docs/                       the app (HTML/CSS/JS; opens from the copy on the phone, then updates; works offline)
```

- **Trend math:** for each window it compares `papers on topic ÷ all imaging papers` now vs. the period before. So "+40%" means the topic grew 40% faster than imaging research overall, not just that more papers exist.
- **Citations:** NIH iCite's Relative Citation Ratio is field- and time-normalized, so 1.0 is a typical NIH-funded paper. RCR isn't available for the newest papers, so the 1-year view ranks by raw citations and leans on paper counts.
- **Emerging phrases:** these count 1–3 word phrases in body-imaging titles over 10 years and compare recent vs. earlier use. Results are cached in `cache/` so each week only fetches new titles.

### Run it on a computer (optional)

```bash
pip install --require-hashes -r requirements.txt && pip install pytest
python -m pytest -q                 # offline tests with synthetic data
python -m pipeline.check_queries    # live: query counts and warnings
python -m pipeline.build_feed       # live: writes docs/data/feed.json
python -m pipeline.build_explore    # live: writes docs/data/explore.json
cd docs && python -m http.server    # open http://localhost:8000
```

### Security

- **The app** runs only its own files: a content security policy blocks scripts, frames and plug-ins from anywhere else, all feed text is shown as plain text, and links open only as web addresses. The forecast comes straight from api.weather.gov, the only other site the app talks to besides GitHub. Story pictures load from the outlets' own servers (https only, as images, which can't run code); turn Pictures off in Tune → Reading to load nothing from them. Sites you open aren't told you came from Readout. The app won't run inside another site's frame (a page that framed it could trick taps), and calendar files escape every line break, so event text can't add calendar fields of its own.
- **News outlets** can only link to their own site (or partner sites listed as `link_domains` in `config/news.yaml`), so a hacked feed can't slip in a link elsewhere; Tune → Updates counts any links dropped. Feeds that declare XML entities are refused, downloads are capped at 30 MB, and redirects may only go to public web addresses. An API token (TMDB's) goes only to its own host over https, checked again at every redirect. Pictures from papers are decoded only as JPEG, PNG, GIF, WebP or TIFF, and anything over 60 million pixels is refused.
- **Updates** install exact package versions checked against their published hashes (`requirements.txt`, generated from `requirements.in` with `pip-compile --generate-hashes`), and use GitHub's own actions pinned to exact commits. Each update runs as two jobs on separate machines. The build job, which reads outside feeds, PubMed and pictures, can only read the repository; it hands its files to a save job, which alone can push. The save job runs nothing the build made: it unpacks only plain files with the exact names that job writes (the news job may write only `news.json` and its headline archive, for example), refuses anything else, and then commits. So even a build step taken over by a malicious feed or picture couldn't change the app or reach the push token. Dependabot proposes updates monthly as pull requests; the Tests workflow checks each one before you merge it.
- **Optional phone token:** to let pull-to-refresh run the news job (and Run now start any job), add a fine-grained GitHub token in **Tune → Updates**, limited to this repository with only *Actions: Read and write* (the app won't take a classic `ghp_` token, which reaches every repository you have). It's kept only on your phone (not in settings or backups) and sent only to api.github.com. Delete it on GitHub any time.
- **Secrets:** `NCBI_API_KEY` and `NCBI_EMAIL`, given to the PubMed jobs (and the email, as a contact, to the Coming up job for BLS), sent in request bodies or headers, never in web addresses; and `TMDB_TOKEN`, given only to the Coming up job and sent only to api.themoviedb.org. The news job, which reads the most outside data, gets no secrets. Nothing secret is in the app's code; the optional phone token above lives only on your phone.
- **Your GitHub account is the key to all of it.** Turn on two-factor authentication (github.com → Settings → Password and authentication) if it isn't already.

### Terms of use

- **PubMed / NCBI:** requests stay within NCBI's rate limits (3 a second, 10 with an API key), carry the tool name and your `NCBI_EMAIL`, and the larger jobs run in NCBI's off-peak hours. The app credits MEDLINE/PubMed and links NCBI's disclaimer and copyright notice. NLM doesn't hold copyright in abstracts; publishers or authors may. Readout shows them for personal, non-commercial reading with credit and a PubMed link.
- **Pictures:** downloaded only from the PMC Article Datasets on AWS, which NLM offers for automated retrieval (scripts aren't allowed on the PMC website itself), and only for articles whose license is Creative Commons (CC BY, CC BY-SA, CC BY-NC, CC BY-NC-SA, CC BY-ND, CC BY-NC-ND or CC0). Each is shown unaltered apart from resizing for a phone, which the licenses allow, with the figure number, the license (linked) and the article credited. Author manuscripts and retracted articles are skipped.
- **Light reading:** Wikipedia's featured content is CC BY-SA, NASA's images are public domain and Knowable Magazine is CC BY-ND; NPR, the BBC and The New York Times allow their feeds on a personal, non-commercial site with credit, and Dow Jones (WSJ, MarketWatch) allows its feeds for individual, personal, non-commercial use. AP's own feeds stopped in 2024 and Reuters has none, so neither is included. The Guardian (personal use only), Good News Network (no redistribution) and PBS NewsHour (no stated feed terms) were left out.
- **News:** only outlets whose feeds may be shown on a personal, non-commercial website, each credited and linked (The New York Times and NPR allow exactly that; Phys.org, Medical Xpress and ScienceDaily allow more). No Google News feeds (personal use only). ScienceDaily, Medical Xpress, Phys.org and New York Times items are shown exactly as their feeds supply them. Keep Readout non-commercial: no ads, no charging for it.
- **Coming up:** the Federal Reserve, BLS, BEA, Federal Register (FDA meeting notices, through its public API) and NASA calendars are U.S. government works in the public domain, read once a day. Launch Library 2 (The Space Devs) is free to use within its rate limit (one request a day here) and is credited. Earnings dates come from Alpha Vantage with your own free key, for personal, non-commercial use on your own phone, as its terms allow; they're fetched by the phone, never published on the site. Stock market holidays are worked out from NYSE's published rules. Movie release dates come from TMDB, free for non-commercial use with credit: the app shows TMDB's logo and its notice ("This product uses the TMDB API but is not endorsed or certified by TMDB.") wherever they appear. IMDb doesn't allow robots or scraping, and its free datasets have no release dates, so each film only links to its IMDb page.
- **FDA:** the FDA's press-release and MedWatch safety feeds are U.S. government works in the public domain; only items that touch imaging, contrast or radiopharmaceuticals are kept, credited and linked to fda.gov.
- **GitHub:** the jobs build what this repository's site publishes, which is what Actions is for; the site is personal and non-commercial and far under Pages' limits.

### Limits worth knowing

- PubMed sometimes adds abstracts a few days after the record. Those cards say so, and the daily job re-checks them for 30 days.
- Study-design badges and sample sizes come from pattern matching. They're right most of the time, and the dashed badges mark the guesses.
- Paper counts in the most recent months are incomplete in PubMed. The field-growth adjustment cancels most of this, because the baseline has the same lag.
- Scheduled GitHub workflows pause after 60 days without repository activity. The daily feed commit counts as activity, so this only matters if the feed job keeps failing.

Data: PubMed (NLM), NIH iCite, ClinicalTrials.gov. Fonts: Literata and Atkinson Hyperlegible Next, under the SIL Open Font License (see `docs/fonts/`).
