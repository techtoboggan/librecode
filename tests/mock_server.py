"""
Mock LibreCode API Server

Serves the same API responses that the real CLI backend provides,
allowing BDD tests to run without any real backend or providers.

Start: python3 tests/mock_server.py
Runs on: http://localhost:4096

Responses match the SDK types in packages/sdk/openapi.json.
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import threading


# Mock data matching the real API response shapes

MOCK_PROVIDERS = [
    {
        "id": "anthropic",
        "name": "Anthropic",
        "source": "env",
        "env": ["ANTHROPIC_API_KEY"],
        "options": {},
        "models": {},
    },
    {
        "id": "openai",
        "name": "OpenAI",
        "source": "env",
        "env": ["OPENAI_API_KEY"],
        "options": {},
        "models": {},
    },
    {
        "id": "google",
        "name": "Google",
        "source": "env",
        "env": ["GOOGLE_API_KEY"],
        "options": {},
        "models": {},
    },
    {
        "id": "litellm",
        "name": "LiteLLM",
        "source": "custom",
        "env": ["LITELLM_API_KEY"],
        "options": {},
        "models": {},
    },
    {
        "id": "openrouter",
        "name": "OpenRouter",
        "source": "env",
        "env": ["OPENROUTER_API_KEY"],
        "options": {},
        "models": {},
    },
    {
        "id": "github-copilot",
        "name": "GitHub Copilot",
        "source": "env",
        "env": [],
        "options": {},
        "models": {},
    },
]

MOCK_SESSION = {
    "id": "session_mock_1",
    "title": "Mock Session",
    "directory": "/tmp/librecode-test",
    "time": {"created": 1700000000000, "updated": 1700000000000},
}

MOCK_PROJECT = {
    "id": "project_mock_1",
    "directory": "/tmp/librecode-test",
    "worktree": "/tmp/librecode-test",
}


class MockHandler(BaseHTTPRequestHandler):
    """Handles API requests matching the LibreCode backend routes."""

    def do_GET(self):
        path = self.path.split("?")[0]

        routes = {
            "/api/provider": self._providers,
            "/api/provider/list": self._providers,
            "/api/session": self._sessions,
            "/api/session/list": self._sessions,
            "/api/project": self._project,
            "/api/config": self._config,
            "/health": self._health,
            "/": self._health,
        }

        handler = routes.get(path)
        if handler:
            handler()
        else:
            self._json({"error": f"Not found: {path}"}, 404)

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length else b""

        path = self.path.split("?")[0]

        if path == "/api/session/create":
            self._json(MOCK_SESSION)
        elif path == "/api/session/prompt":
            self._json({"info": {"id": "msg_1", "role": "assistant"}, "parts": []})
        else:
            self._json({"ok": True})

    def _providers(self):
        self._json(MOCK_PROVIDERS)

    def _sessions(self):
        self._json([MOCK_SESSION])

    def _project(self):
        self._json(MOCK_PROJECT)

    def _config(self):
        self._json({"provider": {}, "permission": {}})

    def _health(self):
        self._json({"status": "ok", "version": "0.0.1-test"})

    def _json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def log_message(self, format, *args):
        """Suppress request logging."""
        pass


def start_mock_server(port=4096):
    """Start the mock server in a background thread."""
    server = HTTPServer(("127.0.0.1", port), MockHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


if __name__ == "__main__":
    print(f"Mock LibreCode API server running on http://127.0.0.1:4096")
    server = HTTPServer(("127.0.0.1", 4096), MockHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
