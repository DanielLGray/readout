"""The real downloader against a local server: redirects stay on the public internet, size is capped."""
import http.server
import threading

import pytest

from pipeline import http as H


@pytest.fixture()
def server(monkeypatch):
    monkeypatch.setenv("NO_PROXY", "127.0.0.1,localhost")
    monkeypatch.setenv("no_proxy", "127.0.0.1,localhost")

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            routes = {"/to-metadata": "http://169.254.169.254/latest/meta-data/",
                      "/to-self": f"http://127.0.0.1:{self.server.server_port}/ok",
                      "/to-file": "file:///etc/passwd"}
            if self.path in routes:
                self.send_response(302); self.send_header("Location", routes[self.path]); self.end_headers(); return
            body = b"<rss>fine</rss>" if self.path == "/ok" else b"x" * 5000
            self.send_response(200); self.send_header("Content-Type", "application/xml")
            self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def test_redirects_and_size(server, monkeypatch):
    assert H._requests_transport("GET", f"{server}/ok", {}) == (200, "<rss>fine</rss>")
    for path in ("/to-metadata", "/to-self", "/to-file"):
        status, text = H._requests_transport("GET", f"{server}{path}", {})
        assert status == 400 and "refused a redirect" in text, path
    monkeypatch.setattr(H, "MAX_BYTES", 1000)
    status, text = H._requests_transport("GET", f"{server}/big", {})
    assert status == 400 and "refused" in text
    assert not H.public_host("localhost") and not H.public_host("10.0.0.5") and not H.public_host("169.254.169.254")
