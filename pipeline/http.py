"""Small HTTP helper: polite rate limiting, retries, and a swappable transport
so the whole pipeline can be tested offline."""
from __future__ import annotations

import ipaddress
import json
import os
import random
import socket
import sys
import time
from typing import Callable, Optional
from urllib.parse import urljoin, urlparse

import requests

USER_AGENT = "Mozilla/5.0 (compatible; Readout/1.0; personal literature reader; +https://github.com/DanielLGray/readout)"
HOST_AGENTS: dict = {}          # a different User-Agent for a host that asks for one (BLS wants a contact email)
HOST_HEADERS: dict = {}         # extra headers for one host (TMDB's read token goes in Authorization)
ACCEPT = "application/json, application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8"


class HttpError(RuntimeError):
    pass


# A transport takes (method, url, params) and returns (status_code, text).
Transport = Callable[[str, str, dict], "tuple[int, str]"]


MAX_BYTES = 30 * 1024 * 1024        # no feed or API answer is anywhere near this; a bigger one is refused
MAX_REDIRECTS = 5


def public_host(host: str) -> bool:
    """True when every address the name resolves to is on the public internet, so a redirect can't
    point the job at the runner itself or its cloud's internal services (169.254.169.254 and the like)."""
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False
    for info in infos:
        ip = ipaddress.ip_address(str(info[4][0]).split("%")[0])
        if not ip.is_global or ip.is_multicast:
            return False
    return bool(infos)


def _requests_transport(method: str, url: str, params: dict) -> "tuple[int, str]":
    return _send(method, url, params, raw=False)


def _requests_bytes(method: str, url: str, params: dict) -> "tuple[int, bytes]":
    """The same, for images: the body as bytes."""
    return _send(method, url, params, raw=True)


def headers_for(url: str, raw: bool = False) -> dict:
    """Headers for one request. A host's own headers (an API token) go only to that host, and
    only over https: worked out again for every redirect, so a token never follows one elsewhere."""
    u = urlparse(url)
    host = u.hostname or ""
    own = HOST_HEADERS.get(host, {}) if u.scheme == "https" else {}
    return {"User-Agent": HOST_AGENTS.get(host, USER_AGENT), "Accept": "image/*, */*;q=0.5" if raw else ACCEPT, **own}


def _send(method: str, url: str, params: dict, raw: bool):
    fail = (lambda msg: (400, msg.encode())) if raw else (lambda msg: (400, msg))
    with requests.Session() as s:
        for _ in range(MAX_REDIRECTS + 1):
            r = s.request(method, url, headers=headers_for(url, raw), timeout=60, allow_redirects=False, stream=True,
                          data=params if method == "POST" else None, params=params if method == "GET" else None)
            if r.is_redirect:
                nxt = urljoin(url, r.headers.get("location", ""))
                r.close()
                u = urlparse(nxt)
                if u.scheme not in ("http", "https") or not u.hostname or not public_host(u.hostname):
                    return fail(f"refused a redirect to {u.scheme}://{u.hostname or ''}")
                if r.status_code in (301, 302, 303):
                    method = "GET"
                url, params = nxt, {}
                continue
            body = bytearray()
            for chunk in r.iter_content(64 * 1024):
                body += chunk
                if len(body) > MAX_BYTES:
                    r.close()
                    return fail(f"response over {MAX_BYTES // 2**20} MB refused")
            if raw:
                return r.status_code, bytes(body)
            r._content = bytes(body)          # let requests decode it as usual
            r._content_consumed = True
            return r.status_code, r.text
    return fail("too many redirects")


class Http:
    """Rate-limited client. `min_interval` is per host, in seconds."""

    def __init__(self, transport: Optional[Transport] = None, intervals: Optional[dict] = None,
                 retries: int = 5, sleep: Callable[[float], None] = time.sleep,
                 bytes_transport: Optional[Callable] = None):
        self.transport = transport or _requests_transport
        # images; a test transport without one gets no images (as if every download failed)
        self.bytes_transport = bytes_transport or (_requests_bytes if transport is None else
                                                   (lambda m, u, p: (404, b"no image transport")))
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

    def request(self, method: str, url: str, params: dict, expect_json: bool = False, raw: bool = False):
        host = urlparse(url).netloc
        delay = 2.0
        last_err = ""
        for attempt in range(1, self.retries + 1):
            self._wait(host)
            self.calls += 1
            try:
                status, text = (self.bytes_transport if raw else self.transport)(method, url, params)
            except Exception as exc:  # network hiccup
                status, text, last_err = 0, "", f"{type(exc).__name__}: {exc}"
            if status == 200:
                if raw or not expect_json:
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
                raise HttpError(f"{status} from {host}: {text[:300]!s}")
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

    def get_text(self, url: str, params: dict) -> str:
        return self.request("GET", url, params, expect_json=False)

    def get_bytes(self, url: str, params: Optional[dict] = None) -> bytes:
        return self.request("GET", url, params or {}, raw=True)


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def default_http() -> Http:
    key = os.environ.get("NCBI_API_KEY", "").strip()
    return Http(intervals={
        "eutils.ncbi.nlm.nih.gov": 0.11 if key else 0.35,   # NCBI: 10/s with key, 3/s without
        "icite.od.nih.gov": 0.2,
        "clinicaltrials.gov": 0.3,
        "pmc-oa-opendata.s3.amazonaws.com": 0.1,
        "pmc.ncbi.nlm.nih.gov": 0.35,
    })
