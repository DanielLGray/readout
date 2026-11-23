"""Small HTTP helper: polite rate limiting, retries, and a swappable transport
so the whole pipeline can be tested offline."""
from __future__ import annotations

import json
import os
import random
import sys
import time
from typing import Callable, Optional
from urllib.parse import urlparse

import requests

USER_AGENT = "Readout/1.0 (personal literature reader; https://github.com/)"


class HttpError(RuntimeError):
    pass


# A transport takes (method, url, params) and returns (status_code, text).
Transport = Callable[[str, str, dict], "tuple[int, str]"]


def _requests_transport(method: str, url: str, params: dict) -> "tuple[int, str]":
    headers = {"User-Agent": USER_AGENT}
    if method == "POST":
        r = requests.post(url, data=params, headers=headers, timeout=60)
    else:
        r = requests.get(url, params=params, headers=headers, timeout=60)
    return r.status_code, r.text


class Http:
    """Rate-limited client. `min_interval` is per host, in seconds."""

    def __init__(self, transport: Optional[Transport] = None, intervals: Optional[dict] = None,
                 retries: int = 5, sleep: Callable[[float], None] = time.sleep):
        self.transport = transport or _requests_transport
        self.intervals = intervals or {}
        self.retries = retries
        self.sleep = sleep
        self._last: dict[str, float] = {}
        self.calls = 0

    def _wait(self, host: str) -> None:
        gap = self.intervals.get(host, 0.0)
        if gap <= 0:
            return
        last = self._last.get(host)
        now = time.monotonic()
        if last is not None and now - last < gap:
            self.sleep(gap - (now - last))
        self._last[host] = time.monotonic()

    def request(self, method: str, url: str, params: dict, expect_json: bool = False):
        host = urlparse(url).netloc
        delay = 2.0
        last_err = ""
        for attempt in range(1, self.retries + 1):
            self._wait(host)
            self.calls += 1
            try:
                status, text = self.transport(method, url, params)
            except Exception as exc:  # network hiccup
                status, text, last_err = 0, "", f"{type(exc).__name__}: {exc}"
            if status == 200:
                if not expect_json:
                    return text
                try:
                    data = json.loads(text)
                except ValueError:
                    last_err = "invalid JSON"
                else:
                    # NCBI sometimes answers 200 with {"error": "API rate limit exceeded"}
                    if isinstance(data, dict) and "error" in data and len(data) <= 2:
                        last_err = str(data.get("error"))
                    else:
                        return data
            elif status in (400, 404):
                raise HttpError(f"{status} from {host}: {text[:300]}")
            else:
                last_err = last_err or f"HTTP {status}"
            if attempt < self.retries:
                log(f"  retry {attempt}/{self.retries - 1} for {host} ({last_err}); waiting {delay:.0f}s")
                self.sleep(delay + random.random())
                delay *= 2
        raise HttpError(f"giving up on {host}: {last_err}")

    def get_json(self, url: str, params: dict):
        return self.request("GET", url, params, expect_json=True)

    def post_json(self, url: str, params: dict):
        return self.request("POST", url, params, expect_json=True)

    def post_text(self, url: str, params: dict) -> str:
        return self.request("POST", url, params, expect_json=False)


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def default_http() -> Http:
    key = os.environ.get("NCBI_API_KEY", "").strip()
    return Http(intervals={
        "eutils.ncbi.nlm.nih.gov": 0.11 if key else 0.35,   # NCBI: 10/s with key, 3/s without
        "icite.od.nih.gov": 0.2,
        "clinicaltrials.gov": 0.3,
    })
