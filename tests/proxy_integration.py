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

    def handle_error(self, request, client_address):
        import sys
        if not isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError)):
            super().handle_error(request, client_address)


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
    def test_management_auth_and_versioned_action_scope(self):
        with proxy() as (c, state, *_):
            self.assertEqual(request(c["adminPort"], path="/v1/state")[0], 401)
            self.assertEqual(request(c["adminPort"], path="/v1/state", headers={"Authorization": "Bearer wrong"})[0], 401)
            snapshot = state()
            action = {"actionId": "00000000-0000-4000-8000-000000000001", "proposalHash": "a" * 64, "source": "127.0.0.2", "ttlSeconds": 60, "expectedEpoch": snapshot["epoch"], "expectedRevision": snapshot["revision"]}
            apply = lambda value: request(c["adminPort"], "POST", "/v1/actions/deny", json.dumps(value), {"Authorization": "Bearer " + TOKEN})
            self.assertEqual(apply({**action, "source": "127.0.0.1"})[0], 409)
            self.assertEqual(apply({**action, "ttlSeconds": 601})[0], 409)
            self.assertEqual(apply(action)[0], 200)
            self.assertEqual(apply(action)[0], 200)
            self.assertEqual(len(state()["rules"]), 1)
            self.assertEqual(apply({**action, "source": "127.0.0.3"})[0], 409)
            self.assertEqual(apply({**action, "actionId": "00000000-0000-4000-8000-000000000002"})[0], 409)
            self.assertEqual(request(c["port"], source="127.0.0.2")[0], 403)
            self.assertEqual(request(c["port"])[0], 200)

    def test_request_boundaries_and_malformed_framing(self):
        with proxy() as (c, *_):
            self.assertEqual(request(c["port"], "PUT")[0], 405)
            self.assertEqual(request(c["port"], "POST", body="x" * 65537)[0], 413)
            self.assertEqual(request(c["port"], headers={"X-Large": "x" * 17000})[0], 431)
            for packet in [b"GET / HTTP/1.0\r\nHost: local\r\n\r\n", b"GET / HTTP/1.1\r\n\r\n", b"POST / HTTP/1.1\r\nHost: local\r\nContent-Length: 1\r\nTransfer-Encoding: chunked\r\n\r\n", b"GET / HTTP/1.1\r\nHost: a\r\nHost: b\r\n\r\n", b"garbage\r\n\r\n"]:
                with socket.create_connection(("127.0.0.1", c["port"]), timeout=2) as s:
                    s.sendall(packet)
                    result = s.recv(4096)
                    self.assertTrue(result.startswith((b"HTTP/1.1 400", b"HTTP/1.1 505")), result)

    def test_cidr_deny_allow_precedence_and_client_rate_limit(self):
        with proxy(allow=["127.0.0.0/8"], deny=["127.0.0.2/32"]) as (c, state, *_):
            self.assertEqual(request(c["port"], source="127.0.0.2")[0], 403)
            self.assertEqual(request(c["port"])[0], 200)
        with proxy(ratePerSecond=1, burst=2, violationThreshold=2) as (c, state, *_):
            statuses = [request(c["port"], source="127.0.0.2", headers={"X-Forwarded-For": f"198.51.100.{n}"})[0] for n in range(4)]
            self.assertEqual(statuses, [200, 200, 429, 429])
            self.assertEqual(request(c["port"])[0], 200)
            self.assertTrue(any(e["type"] == "detection.security" and e["source"] == "127.0.0.2" for e in state()["events"]))

    def test_health_failure_removal_recovery_and_no_backends(self):
        with proxy() as (c, state, a, b):
            port = a.server_port
            a.shutdown(); a.server_close()
            eventually(state, lambda s: not s["backends"][0]["healthy"])
            self.assertEqual([json.loads(request(c["port"])[2])["backend"] for _ in range(3)], ["b"] * 3)
            recovered = backend("a", port)
            try:
                eventually(state, lambda s: s["backends"][0]["healthy"])
                self.assertEqual({json.loads(request(c["port"])[2])["backend"] for _ in range(4)}, {"a", "b"})
            finally:
                recovered.shutdown(); recovered.server_close()
            b.shutdown(); b.server_close()
            eventually(state, lambda s: not any(x["healthy"] for x in s["backends"]))
            self.assertEqual(request(c["port"])[0], 503)

    def test_upstream_timeout_and_connection_failure(self):
        with proxy(healthIntervalMs=1000, recoveryThreshold=1, failureThreshold=10) as (c, state, a, b):
            self.assertEqual(request(c["port"], path="/slow")[0], 504)
            a.shutdown(); a.server_close()
            codes = [request(c["port"])[0] for _ in range(2)]
            self.assertTrue(any(code in (502, 504) for code in codes), codes)
            self.assertIn(200, codes)

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
