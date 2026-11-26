from datetime import date, datetime, timezone

from pipeline import horizon as H
from pipeline.build_horizon import build

START, STOP = date(2026, 11, 25), date(2027, 3, 31)


def test_market_days_follow_nyse_rules():
    d26 = {d: (k, why) for d, k, why in H.market_days(2026)}
    assert d26[date(2026, 11, 26)][0] == "closed"            # Thanksgiving
    assert d26[date(2026, 11, 27)][0] == "early"             # the day after
    assert d26[date(2026, 12, 24)][0] == "early"             # Christmas Eve, a Thursday
    assert d26[date(2026, 12, 25)][0] == "closed"
    assert d26[date(2026, 7, 3)][0] == "closed"              # July 4 on a Saturday: the Friday before
    assert date(2026, 4, 3) in d26                           # Good Friday (Easter April 5, 2026)
    d27 = {d: k for d, k, _ in H.market_days(2027)}
    assert d27[date(2027, 1, 1)] == "closed" and d27[date(2027, 1, 18)] == "closed" and d27[date(2027, 2, 15)] == "closed"
    assert d27[date(2027, 3, 26)] == "closed"                # Good Friday (Easter March 28, 2027)
    assert d27[date(2027, 6, 18)] == "closed"                # Juneteenth on a Saturday
    assert d27[date(2027, 7, 5)] == "closed"                 # July 4 on a Sunday
    assert d27[date(2027, 12, 24)] == "closed"               # Christmas on a Saturday
    assert date(2027, 7, 2) not in d27                       # no early close then
    d22 = {d for d, _, _ in H.market_days(2022)}
    assert date(2021, 12, 31) not in d22 and date(2022, 1, 1) not in d22   # New Year's on a Saturday: no Friday closure


ICS = "\r\n".join([
    "BEGIN:VCALENDAR", "VERSION:2.0",
    "BEGIN:VEVENT", "DTSTART;TZID=US-Eastern:20261204T083000", "SUMMARY:Employment Situation for November 2026", "END:VEVENT",
    "BEGIN:VEVENT", "DTSTART:20261210T133000Z", "SUMMARY:Consumer Price Index", "DESCRIPTION:Consumer Price Index for Novem",
    " ber 2026", "END:VEVENT",
    "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261215", "SUMMARY:Producer Price Index for November 2026", "END:VEVENT",
    "BEGIN:VEVENT", "DTSTART;TZID=America/New_York:20250110T083000", "SUMMARY:Employment Situation for December 2024", "END:VEVENT",
    "END:VCALENDAR"])
RULES = [{"match": "^Employment Situation", "title": "Jobs report"}, {"match": "^Consumer Price Index", "title": "CPI inflation report"}]


def test_release_calendar_keeps_matching_upcoming_entries():
    evs = H.releases(ICS, RULES, "BLS", "https://www.bls.gov/schedule/", START, STOP)
    assert [e["title"] for e in evs] == ["Jobs report", "CPI inflation report"]
    jobs, cpi = evs
    assert jobs["start"] == "2026-12-04T08:30:00-05:00" and jobs["sub"] == "November 2026 numbers"
    assert cpi["start"] == "2026-12-10T13:30:00+00:00" and cpi["sub"] == "November 2026 numbers"   # from the folded description
    assert not jobs["allDay"] and jobs["kind"] == "markets"


FED_PAGE = """
<div class="panel"><h4>2026 FOMC Meetings</h4>
<div class="fomc-meeting"><div class="fomc-meeting__month"><strong>October</strong></div><div class="fomc-meeting__date">27-28</div>
<div>Minutes: (Released November 18, 2026)</div></div>
<div class="fomc-meeting"><div class="fomc-meeting__month"><strong>December</strong></div><div class="fomc-meeting__date">8-9*</div></div></div>
<div class="panel"><h4>2027 FOMC Meetings</h4>
<div><strong>January</strong></div><div>26-27</div><div><strong>April/May</strong></div><div>30-1</div>
<div><strong>October</strong></div><div>26-27</div><div><strong>November</strong></div><div>16-17*</div>
<p>Note: A two-day meeting is scheduled for January 25-26, 2028.</p></div>
"""


def test_fomc_page_and_events():
    ms = H.fomc_meetings(FED_PAGE)
    assert (date(2026, 12, 8), date(2026, 12, 9), True) in ms
    assert (date(2027, 4, 30), date(2027, 5, 1), False) in ms
    assert all(m[0] != date(2026, 11, 18) for m in ms)                 # a minutes date isn't a meeting
    assert (date(2028, 1, 25), date(2028, 1, 26), False) in ms and all(m[0] != date(2027, 1, 25) for m in ms)
    evs = H.fomc_events(ms, {date(2027, 10, 27)}, START, date(2027, 12, 31))
    dec = next(e for e in evs if e["id"] == "fomc-2026-12-09")
    assert dec["title"] == "Fed rate decision" and dec["start"] == "2026-12-09T14:00:00-05:00" and "projections" in dec["sub"]
    octo = next(e for e in evs if e["id"] == "fomc-2027-10-27")
    assert octo["title"] == "Fed strategy meeting" and octo["allDay"]


FDA_PAGE = """
<a href="/advisory-committees/advisory-committee-calendar/december-3-2026-circulatory-system-devices-panel-medical-devices-advisory-committee-meeting-announcement">December 3, 2026: Circulatory System Devices Panel of the Medical Devices Advisory Committee Meeting Announcement</a>
<a href="/advisory-committees/advisory-committee-calendar/january-14-15-2027-radiological-devices-panel-medical-devices-advisory-committee-meeting">January 14-15, 2027: Radiological Devices Panel of the Medical Devices Advisory Committee Meeting Announcement</a>
<a href="/advisory-committees/advisory-committee-calendar/microbiology-devices-panel-meeting-announcement-12082026">Microbiology Devices Panel Meeting Announcement</a>
<a href="/advisory-committees/advisory-committee-calendar/postponed-medical-imaging-drugs-advisory-committee-meeting-announcement-12102026">POSTPONED: Medical Imaging Drugs Advisory Committee</a>
"""


def test_fda_calendar_filters_and_dates():
    evs = H.fda_meetings(FDA_PAGE, "Circulatory System Devices|Radiological Devices|Medical Imaging", START, STOP)
    assert [e["title"] for e in evs] == ["FDA panel: Circulatory System Devices Panel", "FDA panel: Radiological Devices Panel"]
    assert evs[1]["start"] == "2027-01-14" and evs[1]["end"] == "2027-01-15"
    assert evs[0]["url"].startswith("https://www.fda.gov/advisory-committees/")
    assert H.fda_date("/x/pediatric-advisory-committee-meeting-announcement-09162026", "") == (date(2026, 9, 16), date(2026, 9, 16))


LL2 = {"results": [
    {"id": "a1", "name": "Falcon 9 Block 5 | Starlink Group 12-3", "net": "2026-12-02T10:00:00Z", "net_precision": {"name": "Minute"},
     "rocket": {"configuration": {"name": "Falcon 9"}}, "mission": {"type": "Communications"}},
    {"id": "a2", "name": "Falcon 9 Block 5 | Crew-13", "net": "2026-12-05T19:30:00Z", "net_precision": {"name": "Minute"},
     "rocket": {"configuration": {"name": "Falcon 9"}}, "mission": {"name": "Crew-13", "type": "Human Exploration", "description": "Crew rotation to the ISS."},
     "launch_service_provider": {"name": "SpaceX"}, "pad": {"location": {"name": "Kennedy Space Center, FL, USA"}}},
    {"id": "a3", "name": "Starship | Flight 14", "net": "2027-01-20T00:00:00Z", "net_precision": {"name": "Month"},
     "rocket": {"configuration": {"name": "Starship"}}, "mission": {"name": "Flight 14", "type": "Test Flight"}},
]}


def test_bea_gdp_label():
    ics = ("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;TZID=America/New_York:20261223T083000\r\nSUMMARY:GDP (Third Estimate), Industries, "
           "Corporate Profits, State GDP, and State Personal Income, 3rd Quarter 2026\r\nEND:VEVENT\r\nEND:VCALENDAR")
    ev, = H.releases(ics, [{"match": r"^GDP \((Advance|Second|Third) Estimate\)", "title": "GDP report"}], "BEA", "u", START, STOP)
    assert ev["sub"] == "Third estimate for Q3 2026"


FR = {"results": [
    {"title": "Circulatory System Devices Panel of the Medical Devices Advisory Committee; Notice of Meeting; Establishment of a Public Docket; Request for Comments--Transcatheter Tricuspid Valve",
     "dates": "The meeting will take place virtually on December 3, 2026, from 9 a.m. to 6 p.m. Eastern Time.", "html_url": "https://www.federalregister.gov/d/2026-1"},
    {"title": "Radiological Devices Panel of the Medical Devices Advisory Committee; Notice of Meeting",
     "dates": "The meeting will be held on January 14 and 15, 2027, from 8 a.m. to 5 p.m.", "html_url": "https://www.federalregister.gov/d/2026-2"},
    {"title": "Microbiology Devices Panel of the Medical Devices Advisory Committee; Notice of Meeting", "dates": "December 8, 2026"},
    {"title": "Circulatory System Devices Panel; Notice of Meeting", "dates": "The meeting was held on May 1, 2026."},
    {"title": "Medical Imaging Drugs Advisory Committee; Cancellation of Meeting", "dates": "December 10, 2026"},
]}


def test_federal_register_meetings():
    evs = H.fr_meetings(FR, "Circulatory System Devices|Radiological Devices|Medical Imaging", START, STOP)
    assert [e["title"] for e in evs] == ["FDA panel: Circulatory System Devices Panel", "FDA panel: Radiological Devices Panel"]
    assert evs[0]["sub"] == "Transcatheter Tricuspid Valve" and evs[0]["start"] == "2026-12-03"
    assert evs[1]["start"] == "2027-01-14" and evs[1]["end"] == "2027-01-15"
    assert evs[0]["url"] == "https://www.federalregister.gov/d/2026-1"


def test_launch_filter():
    evs = H.launch_events(LL2, {"rockets": "Starship|SLS", "mission_types": "Human Exploration|Planetary", "skip_names": "Starlink"}, START, STOP)
    assert [e["title"] for e in evs] == ["Launch: Crew-13", "Launch: Flight 14"]
    assert not evs[0]["allDay"] and evs[0]["place"].startswith("Kennedy")
    assert evs[1]["allDay"] and evs[1]["approx"] == "no earlier than"


def test_calendar_output_is_valid_ics():
    evs = [H.event("fomc-2026-12-09", "markets", "Fed rate decision", datetime(2026, 12, 9, 19, 0, tzinfo=timezone.utc), sub="FOMC, statement at 2:00 pm ET"),
           H.event("jpm2027", "medicine", "J.P. Morgan Healthcare Conference", date(2027, 1, 11), date(2027, 1, 14), place="San Francisco, CA",
                   about="A very long description " * 8)]
    ics = H.calendar(evs)
    assert ics.startswith("BEGIN:VCALENDAR\r\n") and ics.endswith("END:VCALENDAR\r\n")
    assert "DTSTART:20261209T190000Z" in ics and "DTEND:20261209T200000Z" in ics
    assert "DTSTART;VALUE=DATE:20270111" in ics and "DTEND;VALUE=DATE:20270115" in ics    # end is exclusive
    assert "LOCATION:San Francisco\\, CA" in ics and "statement at 2:00 pm ET" in ics.replace("\r\n ", "")
    assert all(len(l.encode()) <= 75 for l in ics.split("\r\n"))
    assert ics.count("BEGIN:VEVENT") == 2


class FakeHttp:
    def __init__(self, pages):
        self.pages = pages

    def get_text(self, url, params):
        for k, v in sorted(self.pages.items(), key=lambda kv: -len(kv[0])):      # the most specific match
            if k in url:
                if isinstance(v, Exception):
                    raise v
                return v
        raise RuntimeError(f"no page for {url}")

    def get_json(self, url, params):
        if "federalregister" in url:
            v = self.pages.get("federalregister", {"results": []})
            if isinstance(v, Exception):
                raise v
            return v
        return LL2


def test_build_keeps_a_failed_source_and_falls_back_for_the_fed():
    prev = {"events": [{"id": "bls-jobs-report-2026-12-04", "kind": "markets", "title": "Jobs report", "start": "2026-12-04T08:30:00-05:00",
                        "allDay": False, "src": "BLS"}]}
    http = FakeHttp({"federalreserve.gov": RuntimeError("503"), "bls.gov": RuntimeError("403 Forbidden"),
                     "bea.gov/news/schedule": '<a href="/news/schedule/ics/online-calendar-subscription.ics">ICS</a>',
                     "online-calendar-subscription.ics": "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;TZID=America/New_York:20261223T083000\r\n"
                                                         "SUMMARY:Personal Income and Outlays, November 2026\r\nEND:VEVENT\r\nEND:VCALENDAR",
                     "fda.gov": FDA_PAGE, "federalregister": FR})
    cfg = {"bea": [{"match": "^Personal Income and Outlays", "title": "PCE inflation report"}], "bls": RULES,
           "fda_include": "Circulatory", "launches": {"rockets": "Starship", "mission_types": "Human"},
           "fomc": {"fallback": [["2026-12-08", "2026-12-09", "sep"]]}, "bls_fallback": {"CPI inflation report": ["2026-12-10"]},
           "events": [{"id": "ces2027", "kind": "news", "title": "CES 2027", "start": "2027-01-06", "end": "2027-01-09"}],
           "unscheduled": [{"kind": "news", "title": "State of the Union", "when": "Usually early in the year."}]}
    meetings = [{"id": "rsna2026", "name": "RSNA 2026", "start": "2026-11-29", "end": "2026-12-03"},
                {"id": "old", "name": "Old", "start": "2025-11-30", "end": "2025-12-04"}]
    out = build(http, cfg, meetings, prev, datetime(2026, 11, 26, 15, 0, tzinfo=timezone.utc))
    ids = {e["id"] for e in out["events"]}
    assert "bls-cpi-inflation-report-2026-12-10" in ids and "bls-jobs-report-2026-12-04" not in ids   # the schedule in the config, not last run's
    assert not out["sources"]["bls"]["ok"] and out["sources"]["fed"].get("fallback")
    assert "fomc-2026-12-09" in ids and "bea-pce-inflation-report-2026-12-23" in ids
    assert next(e for e in out["events"] if e["id"] == "bea-pce-inflation-report-2026-12-23")["sub"] == "November 2026 numbers"
    assert "meeting-rsna2026" in ids and "meeting-old" not in ids and "ces2027" in ids
    assert "nyse-2026-11-27" in ids and "season-2027-01" in ids
    assert any(e["id"].startswith("fda-2026-12-03") for e in out["events"])
    assert out["events"] == sorted(out["events"], key=lambda e: (e["start"][:10], e["start"], e["title"]))
    assert out["unscheduled"][0]["title"] == "State of the Union"


def test_bls_fallback_when_nothing_kept():
    http = FakeHttp({"federalreserve.gov": FED_PAGE, "bls.gov": RuntimeError("403"), "bea.gov": RuntimeError("down"), "federalregister": "not json"})
    cfg = {"bls": RULES, "bls_fallback": {"CPI inflation report": ["2026-12-10", "2027-01-13"]}, "launches": {}}
    out = build(http, cfg, [], {}, datetime(2026, 11, 26, 15, 0, tzinfo=timezone.utc))
    cpi = [e for e in out["events"] if e["src"] == "BLS"]
    assert [e["start"] for e in cpi] == ["2026-12-10T08:30:00-05:00", "2027-01-13T08:30:00-05:00"]
    assert [e["sub"] for e in cpi] == ["November 2026 numbers", "December 2026 numbers"]
    assert out["sources"]["bls"]["fallback"] and not out["sources"]["fda"]["ok"]     # an odd answer is a failure, not "no meetings"


def test_irs_deadlines_follow_weekends_and_dc_holiday():
    assert H.irs_due(date(2027, 4, 15)) == date(2027, 4, 15)
    assert H.irs_due(date(2022, 4, 15)) == date(2022, 4, 18)      # Emancipation Day observed Friday the 15th
    assert H.irs_due(date(2028, 4, 15)) == date(2028, 4, 18)      # Saturday, then Emancipation Day observed Monday
    assert H.irs_due(date(2027, 1, 31)) == date(2027, 2, 1)
    assert H.irs_due(date(2027, 10, 15)) == date(2027, 10, 15)


def test_finance_events():
    cfg = {"buys": {1: "TVs", 11: "TVs and toys", "blackfriday": "TVs"}, "limits": {2027: {"sub": "401(k): $25,500", "src": "IRS"}}}
    evs = {e["id"]: e for e in H.finance_events(date(2026, 11, 25), date(2027, 12, 31), cfg)}
    assert evs["sale-blackfriday-2026"]["start"] == "2026-11-27" and evs["sale-cybermonday-2026"]["start"] == "2026-11-30"
    assert evs["tax-day-2027"]["start"] == "2027-04-15" and "IRA and HSA" in evs["tax-day-2027"]["sub"]
    assert evs["tax-w2-2027"]["start"] == "2027-02-01"
    assert evs["sale-presidents-2027"]["start"] == "2027-02-13" and evs["sale-presidents-2027"]["end"] == "2027-02-15"
    assert evs["limits-2027"]["sub"] == "401(k): $25,500"
    assert evs["buys-2027-01"]["title"] == "Good buys in January" and "buys-2027-02" not in evs   # only months with text
    assert all(e["kind"] == "money" for e in evs.values())
    assert "buys-2026-11" not in evs                                   # November 1 is before the window
    assert "sale-presidents-2026" not in evs


def test_config_events_take_their_section_kind():
    evs = H.config_events([{"id": "dune-3", "title": "Dune: Part Three", "start": "2026-12-18"}], START, STOP, kind="movies")
    assert evs[0]["kind"] == "movies" and evs[0]["allDay"]


DETAILS = {
    1: {"id": 1, "title": "Dune: Part Three", "popularity": 210.5, "genres": [{"name": "Science Fiction"}, {"name": "Adventure"}],
        "overview": "Paul Atreides rules as emperor.", "external_ids": {"imdb_id": "tt31378509"},
        "release_dates": {"results": [{"iso_3166_1": "GB", "release_dates": [{"release_date": "2026-12-16T00:00:00.000Z", "type": 3}]},
                                      {"iso_3166_1": "US", "release_dates": [{"release_date": "2026-12-16T00:00:00.000Z", "type": 1},
                                                                             {"release_date": "2026-12-18T00:00:00.000Z", "type": 3, "note": "IMAX"},
                                                                             {"release_date": "2027-03-01T00:00:00.000Z", "type": 4}]}]}},
    2: {"id": 2, "title": "Small Fantasy", "popularity": 3.2, "genres": [{"name": "Fantasy"}], "imdb_id": "",
        "release_dates": {"results": [{"iso_3166_1": "US", "release_dates": [{"release_date": "2027-01-22T00:00:00.000Z", "type": 2}]}]}},
    3: {"id": 3, "title": "Streaming Only", "popularity": 90, "genres": [{"name": "Science Fiction"}],
        "release_dates": {"results": [{"iso_3166_1": "US", "release_dates": [{"release_date": "2027-02-01T00:00:00.000Z", "type": 4}]}]}},
}


class TmdbHttp(FakeHttp):
    def __init__(self, fail=False):
        super().__init__({"federalreserve.gov": FED_PAGE, "bls.gov": RuntimeError("403"), "bea.gov": RuntimeError("x"), "federalregister": {"results": []}})
        self.fail = fail
        self.calls = []

    def get_json(self, url, params):
        if "themoviedb" in url:
            self.calls.append((url, dict(params)))
            if self.fail:
                raise RuntimeError("401 Unauthorized")
            if url.endswith("/discover/movie"):
                return {"results": [{"id": 1}, {"id": 2}, {"id": 3}], "total_pages": 1}
            return DETAILS[int(url.rsplit("/", 1)[1])]
        return super().get_json(url, params)


def test_tmdb_movie_event_picks_the_us_theatrical_date_and_imdb_link():
    ev = H.tmdb_movie_event(DETAILS[1], START, STOP)
    assert ev["start"] == "2026-12-18" and ev["title"] == "Dune: Part Three" and ev["kind"] == "movies"
    assert ev["url"] == "https://www.imdb.com/title/tt31378509/" and ev["sub"] == "Science Fiction, Adventure · IMAX"
    assert H.tmdb_movie_event(DETAILS[2], START, STOP)["url"] == "https://www.themoviedb.org/movie/2"   # limited release, no IMDb id
    assert H.tmdb_movie_event(DETAILS[3], START, STOP) is None                                         # streaming only


def test_build_uses_tmdb_with_a_token_and_the_config_without():
    cfg = {"movies": [{"id": "dune-3", "title": "Dune: Part Three", "start": "2026-12-18"}], "tmdb": {"max": 5}}
    now = datetime(2026, 11, 26, 15, 0, tzinfo=timezone.utc)
    http = TmdbHttp()
    out = build(http, cfg, [], {}, now, tmdb_token="abc123")
    movies = [e for e in out["events"] if e["kind"] == "movies"]
    assert [e["id"] for e in movies] == ["movie-1", "movie-2"] and out["sources"]["movies"]["via"] == "tmdb"
    assert http.calls[0][1]["api_key"] == "abc123" and http.calls[0][1]["with_release_type"] == "2|3"
    out = build(TmdbHttp(), cfg, [], {}, now)                              # no token: the hand-checked list
    assert [e["id"] for e in out["events"] if e["kind"] == "movies"] == ["dune-3"]
    assert out["sources"]["movies"] == {"ok": True, "n": 1, "fallback": True, "via": "config"}
    out = build(TmdbHttp(fail=True), cfg, [], {}, now, tmdb_token="bad")   # a bad token: the list, and the error shows
    assert [e["id"] for e in out["events"] if e["kind"] == "movies"] == ["dune-3"] and not out["sources"]["movies"]["ok"]


def test_calendar_text_cannot_start_a_line_of_its_own():
    ev = {"id": "x", "allDay": True, "start": "2026-12-18", "title": "Bad\r\nATTACH:http://e", "place": "A\rB",
          "url": "https://ok.example/a\r\nX:1"}
    lines = H.vevent(ev)
    assert all("\r" not in ln and "\n" not in ln for ln in lines)
    assert "SUMMARY:Bad\\nATTACH:http://e" in lines and not any(ln.startswith("URL:") for ln in lines)
    assert "URL:https://imdb.com/title/tt1" in H.vevent({**ev, "url": "https://imdb.com/title/tt1"})
