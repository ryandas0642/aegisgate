# HTTP and proxy contract

This is a constrained HTTP reverse proxy, not a complete implementation of every HTTP feature.

| Boundary | Supported behavior |
| --- | --- |
| Transport | IPv4 TCP; cleartext HTTP/1.1 |
| Methods | GET, HEAD, POST; GET/HEAD request bodies rejected |
| Targets | Origin-form paths starting with `/`, at most 2,048 bytes; configured upstreams only |
| Request body | Buffered, maximum 65,536 bytes; POST requires Content-Length |
| Headers | Maximum 16,384 bytes; exactly one Host; duplicate Content-Length rejected |
| Response body | Buffered, maximum 1,048,576 bytes; Content-Length required unless semantics imply no body |
| Connections | One request per connection; connection closed after the response; 64 active client connections by default |
| Framing exclusions | Chunked transfer encoding, upgrades, CONNECT, interim responses, Expect/100-continue, pipelining and HTTP/2 are unsupported |
| TLS | No proxy TLS termination or upstream TLS in this MVP |
| Deadlines | Configured request read/write limits and a fixed total upstream deadline, including resolution/connect/write/read |

The parser rejects ambiguous or unsupported request framing. Unsupported methods return 405, unsupported HTTP versions 505, oversized request bodies 413, oversized headers 431, and unsupported expectations 417 when a response can be sent safely. A connection already closed by a read deadline may end without an HTTP error response.

No healthy backend returns 503. Upstream refusal/resolution/write/protocol failures return 502; an upstream deadline returns 504. A slow operating-system connection refusal can therefore produce 504. Oversized or unsupported upstream responses are rejected with 502.

The proxy strips hop-by-hop headers, including fields named by Connection. It removes client-provided Forwarded and common X-Forwarded-* headers, sets Host to the configured upstream, and adds its own request identifier. Responses include X-Aegis-Backend for the synthetic routing demonstration. Request bodies and credentials may be forwarded as application data but are never intentionally included in telemetry or agent context.

The TCP peer address is the client identity. An additional proxy in front would collapse clients to that proxy's peer address. Trusted-proxy handling is a future capability; setting X-Forwarded-For does not enable it.

On POSIX SIGINT/SIGTERM the proxy closes listeners, waits for in-flight work up to ten seconds, then exits. The Windows demo launcher terminates its owned process trees and does not promise the POSIX drain behavior. Automated tests distinguish these paths.

Configuration is validated at startup: listener addresses/ports, backend IDs/hosts/ports, thresholds, limits, and CIDRs. Unknown root keys are rejected. Configuration uses standard JSON parsing; do not rely on duplicate-key rejection. Route membership is a fixed configured list; allocating or counting backend objects is not process provisioning or autoscaling.
