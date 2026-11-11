"""Black-box tests against the real C++ executable and real HTTP backends."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import http.client
import json
import os
import socket
import subprocess
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
TOKEN = "synthetic-test-proxy-token-with-at-least-32-characters"


class Backend(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):
        pass

    def do_GET(self):
        if self.path == "/slow":
            time.sleep(0.8)
        data = json.dumps({"backend": self.server.label, "method": self.command,
                           "body": self.rfile.read(int(self.headers.get("Content-Length", "0"))).decode(),
                           "forwarded": self.headers.get("X-Forwarded-For")}).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        if self.command != "HEAD":
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass

    do_HEAD = do_GET
    do_POST = do_GET


def backend(label, port=0):
    server = Backend(("127.0.0.1", port), Handler)
    server.label = label
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def request(port, method="GET", path="/", body=None, headers=None, source="127.0.0.1"):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=2, source_address=(source, 0))
    try:
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        return response.status, dict(response.getheaders()), response.read()
    finally:
        connection.close()


def eventually(operation, predicate=lambda value: value, seconds=4):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        try:
            last = operation()
            if predicate(last):
                return last
        except (OSError, ValueError):
            pass
        time.sleep(0.04)
    raise AssertionError(f"Condition did not become true: {last!r}")


@contextmanager
def proxy(**overrides):
    a, b = backend("a"), backend("b")
    config = json.loads((ROOT / "configs/local.json").read_text())
    config.update({"port": free_port(), "adminPort": free_port(), "healthIntervalMs": 100,
                   "healthTimeoutMs": 100, "requestTimeoutMs": 300,
                   "ratePerSecond": 1000, "burst": 2000,
                   "backends": [{"id": "a", "host": "127.0.0.1", "port": a.server_port},
                                {"id": "b", "host": "127.0.0.1", "port": b.server_port}]})
    config.update(overrides)
    path = ROOT / "build" / f"test-config-{config['port']}.json"
    path.write_text(json.dumps(config))
    env = {**os.environ, "AEGIS_PROXY_TOKEN": TOKEN}
    if os.name == "nt":
        env["PATH"] = "C:\\msys64\\mingw64\\bin;" + env["PATH"]
    executable = ROOT / "build" / ("aegis-proxy.exe" if os.name == "nt" else "aegis-proxy")
    process = subprocess.Popen([str(executable), str(path)], cwd=ROOT, env=env,
                               stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    admin = lambda: json.loads(request(config["adminPort"], headers={"Authorization": "Bearer " + TOKEN})[2])
    state = lambda: json.loads(request(config["adminPort"], path="/v1/state", headers={"Authorization": "Bearer " + TOKEN})[2])
    try:
        eventually(state, lambda s: all(item["healthy"] for item in s["backends"]))
        yield config, state, a, b
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        process.stderr.close()
        for server in (a, b):
            server.shutdown()
            server.server_close()
        path.unlink(missing_ok=True)


class ProxyTests(unittest.TestCase):
    def test_forwarding_round_robin_post_head_and_header_trust(self):
        with proxy() as (c, state, *_):
            replies = [request(c["port"], headers={"X-Forwarded-For": "198.51.100.9"}) for _ in range(4)]
            self.assertEqual([r[0] for r in replies], [200] * 4)
            self.assertEqual([json.loads(r[2])["backend"] for r in replies], ["a", "b", "a", "b"])
            self.assertTrue(all(json.loads(r[2])["forwarded"] is None for r in replies))
            status, _, body = request(c["port"], "POST", body="synthetic payload")
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)["body"], "synthetic payload")
            self.assertEqual(request(c["port"], "HEAD")[2], b"")
            self.assertEqual(state()["metrics"]["forwarded"], 6)


if __name__ == "__main__":
    unittest.main(verbosity=2)
