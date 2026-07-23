from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import unquote, urlsplit


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def _reject_untrusted_request(self):
        expected_host = f'{self.server.server_address[0]}:{self.server.server_port}'
        if self.headers.get('Host') != expected_host:
            self.send_error(403, 'Forbidden Host header')
            return True

        try:
            request_path = unquote(urlsplit(self.path).path, errors='strict')
        except UnicodeError:
            self.send_error(404, 'Not Found')
            return True

        path_parts = request_path.removeprefix('/').split('/')
        has_unsafe_part = any(
            not part or part.startswith('.')
            for part in path_parts
        )
        allowed_path = request_path in ('/', '/index.html', '/styles.css') or (
            request_path.startswith(('/src/', '/assets/'))
            and not has_unsafe_part
        )
        if '\\' in request_path or '\x00' in request_path or not allowed_path:
            self.send_error(404, 'Not Found')
            return True

        return False

    def do_GET(self):
        if not self._reject_untrusted_request():
            super().do_GET()

    def do_HEAD(self):
        if not self._reject_untrusted_request():
            super().do_HEAD()


def resolve_project_root(script_file):
    return Path(script_file).resolve().parents[1]


def require_web_app(root):
    index = Path(root) / 'index.html'
    if not index.is_file():
        raise FileNotFoundError(f'Missing web application entry point: {index}')


class StaticServer:
    def __init__(self, root, host='127.0.0.1', port=4174):
        if host != '127.0.0.1':
            raise ValueError('Static server host must be 127.0.0.1')
        self.root, self.host, self.port = Path(root).resolve(), host, port
        self._httpd = self._thread = None

    @property
    def running(self):
        return self._thread is not None and self._thread.is_alive()

    @property
    def url(self):
        port = self._httpd.server_port if self._httpd else self.port
        return f'http://{self.host}:{port}/index.html'

    def start(self):
        require_web_app(self.root)
        handler = partial(QuietHandler, directory=str(self.root))
        self._httpd = ThreadingHTTPServer((self.host, self.port), handler)
        self._thread = Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()

    def stop(self):
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
        if self._thread is not None:
            self._thread.join(timeout=3)
        self._httpd = self._thread = None
