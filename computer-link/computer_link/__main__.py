"""JSON-line local process interface, intentionally not an MCP transport."""
import argparse
import json
import sys
from . import diagnostics_registry


MAX_REQUEST_CHARS = 65536


def bounded_lines(stream):
    """Yield complete lines, or None for an oversized line after draining it.

    Each read is bounded, including discarded content. The limit includes the
    newline when present; never parse a truncated prefix as another request.
    """
    while True:
        line = stream.readline(MAX_REQUEST_CHARS + 1)
        if not line:
            return
        if len(line) <= MAX_REQUEST_CHARS:
            yield line
            continue
        while line and not line.endswith("\n"):
            line = stream.readline(MAX_REQUEST_CHARS + 1)
        yield None


def unique_members(pairs):
    """Reject ambiguous JSON objects before selecting a method or parameters."""
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate JSON member")
        value[key] = item
    return value


def respond(registry, request):
    if not isinstance(request, dict) or set(request) - {"id", "method", "params"}:
        return {"error": "invalid request"}
    identity = request.get("id")
    if not (identity is None or type(identity) in (str, int)):
        return {"error": "invalid id"}
    try:
        method = request.get("method")
        if not isinstance(method, str):
            raise ValueError("invalid method")
        if method == "capabilities.list":
            if request.get("params") not in (None, {}):
                raise ValueError("unexpected parameters")
            result = registry.describe()
        else:
            result = registry.call(method, request.get("params"))
        return {"id": identity, "result": result}
    except (ValueError, PermissionError) as error:
        return {"id": identity, "error": str(error)}
    except OSError:
        return {"id": identity, "error": "operating system unavailable"}
    except Exception:
        # A faulty optional adapter must not terminate unrelated capabilities.
        # Do not disclose arbitrary exception text or internal machine details.
        # BaseException (including KeyboardInterrupt/SystemExit) still propagates.
        return {"id": identity, "error": "capability failed"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", help="Optional user-selected directory for disk capacity only")
    args = parser.parse_args()
    try:
        registry = diagnostics_registry(args.workspace)
    except (ValueError, OSError):
        parser.error("workspace is unavailable or not a directory")
    # Fix the wire encoding independently of the host locale. Preserve invalid
    # bytes as sentinels until a complete bounded line can be rejected, rather
    # than losing later requests to TextIOWrapper read-ahead decoding errors.
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8", errors="surrogateescape")
    for line in bounded_lines(sys.stdin):
        if line is None:
            print(json.dumps({"error": "request too large"}), flush=True)
            continue
        try:
            if any("\udc80" <= char <= "\udcff" for char in line):
                raise ValueError("invalid UTF-8 input")
            request = json.loads(line, object_pairs_hook=unique_members)
            response = respond(registry, request)
        except (ValueError, RecursionError):
            response = {"error": "invalid JSON"}
        try:
            # Encode completely before emitting: a broken adapter must not leave
            # a partial line or terminate subsequent independent requests.
            encoded = json.dumps(response, ensure_ascii=True, allow_nan=False)
        except (TypeError, ValueError, RecursionError):
            encoded = json.dumps({"id": response.get("id"),
                                  "error": "invalid capability response"},
                                 ensure_ascii=True)
        print(encoded, flush=True)


if __name__ == "__main__":
    main()
