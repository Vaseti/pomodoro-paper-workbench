import os
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from desktop.runtime import StaticServer, require_web_app, resolve_project_root


class RuntimeTests(unittest.TestCase):
    def test_resolves_repository_root_from_desktop_script(self):
        script = Path('D:/Project/pomodoro-paper-workbench/desktop/app.pyw')
        self.assertEqual(
            resolve_project_root(script),
            Path('D:/Project/pomodoro-paper-workbench'),
        )

    def test_requires_index_html(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(FileNotFoundError, 'index.html'):
                require_web_app(Path(directory))

    def test_rejects_non_loopback_host(self):
        with self.assertRaisesRegex(ValueError, '127.0.0.1'):
            StaticServer(Path('.'), '0.0.0.0', 0)

    def test_serves_files_and_stops_cleanly(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'index.html').write_text('ready', encoding='utf-8')
            server = StaticServer(root, '127.0.0.1', 0)
            server.start()
            try:
                with urllib.request.urlopen(server.url, timeout=2) as response:
                    self.assertEqual(response.read(), b'ready')
                self.assertTrue(server.running)
            finally:
                server.stop()
            self.assertFalse(server.running)

    def test_serves_only_expected_application_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = {
                'index.html': 'index',
                'styles.css': 'styles',
                'src/app.js': 'app',
                'assets/icon.txt': 'asset',
                '.git/config': 'secret',
                'desktop/app.pyw': 'desktop',
                'docs/notes.txt': 'docs',
            }
            for relative_path, content in files.items():
                path = root / relative_path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding='utf-8')

            server = StaticServer(root, '127.0.0.1', 0)
            server.start()
            try:
                base_url = server.url.removesuffix('/index.html')
                for path, expected in [
                    ('/', b'index'),
                    ('/index.html', b'index'),
                    ('/styles.css', b'styles'),
                    ('/src/app.js', b'app'),
                    ('/assets/icon.txt', b'asset'),
                ]:
                    with self.subTest(path=path):
                        with urllib.request.urlopen(base_url + path, timeout=2) as response:
                            self.assertEqual(response.read(), expected)

                for path in ['/.git/config', '/desktop/app.pyw', '/docs/notes.txt']:
                    with self.subTest(path=path):
                        with self.assertRaises(urllib.error.HTTPError) as error:
                            urllib.request.urlopen(base_url + path, timeout=2)
                        self.assertIn(error.exception.code, (403, 404))
            finally:
                server.stop()

    def test_rejects_requests_with_a_hostile_host_header(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'index.html').write_text('ready', encoding='utf-8')
            server = StaticServer(root, '127.0.0.1', 0)
            server.start()
            try:
                request = urllib.request.Request(
                    server.url,
                    headers={'Host': 'attacker.invalid'},
                )
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(request, timeout=2)
                self.assertEqual(error.exception.code, 403)
            finally:
                server.stop()


class EntrypointContractTests(unittest.TestCase):
    def test_entrypoint_declares_durable_storage_and_finally_cleanup(self):
        source = (Path(__file__).parent / 'app.pyw').read_text(encoding='utf-8')
        self.assertIn("PomodoroLauncher') / 'data", source)
        self.assertIn('private_mode=False', source)
        self.assertIn('storage_path=str(STORAGE_DIR)', source)
        self.assertRegex(source, r'def main\(\):\s+server = None\s+try:')
        self.assertRegex(source, r'finally:\s+if server is not None:\s+server\.stop\(\)')

    def test_entrypoint_limits_port_message_to_server_start(self):
        source = (Path(__file__).parent / 'app.pyw').read_text(encoding='utf-8')
        self.assertRegex(
            source,
            r'try:\s+server\.start\(\)\s+except OSError as error:[\s\S]*?'
            r"logging\.exception\('Desktop server bind/start failure'\)",
        )
        self.assertIn("logging.exception('Desktop application startup OSError')", source)


class InstallerTests(unittest.TestCase):
    def test_shortcut_name_is_winps_safe_and_installer_is_ascii(self):
        utility = (Path(__file__).parent / 'install-utils.ps1').resolve()
        quoted_utility = str(utility).replace("'", "''")
        command = (
            f". '{quoted_utility}'; "
            '$name = Get-PomodoroShortcutName; '
            '$codes = @($name.ToCharArray() | ForEach-Object { [int]$_ }); '
            "[Console]::Out.Write(($codes -join ','))"
        )
        powershell = Path(os.environ.get('SystemRoot', r'C:\Windows')) / (
            'System32/WindowsPowerShell/v1.0/powershell.exe'
        )
        result = subprocess.run(
            [
                str(powershell),
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-Command',
                command,
            ],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout, '30058,33540,38047,46,108,110,107')

        installer = (Path(__file__).parent / 'install.ps1').read_text(
            encoding='utf-8'
        )
        self.assertTrue(installer.isascii())
        self.assertIn(
            '$shortcutPath = Join-Path $desktop (Get-PomodoroShortcutName)',
            installer,
        )
        self.assertIn("$iconPath = Join-Path $repoRoot 'assets\\pomodoro-icon.ico'", installer)
        self.assertIn('$shortcut.IconLocation = "$iconPath,0"', installer)

    def test_prefix_probe_reports_marked_current_prefix(self):
        probe = (Path(__file__).parent / 'print-env-prefix.py').resolve()
        result = subprocess.run(
            [sys.executable, str(probe)],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(
            result.stdout.strip(),
            f'__POMODORO_ENV_PREFIX__={sys.prefix}',
        )

    def test_installer_uses_prefix_probe_without_inline_python(self):
        source = (Path(__file__).parent / 'install.ps1').read_text(
            encoding='utf-8'
        )
        self.assertNotIn('python -c', source)
        self.assertIn(
            "$prefixProbe = Join-Path $PSScriptRoot 'print-env-prefix.py'",
            source,
        )
        self.assertIn(
            '& $CondaExe run -n $EnvironmentName python $prefixProbe',
            source,
        )

    def test_readme_uses_prefix_probe_without_inline_python(self):
        source = (Path(__file__).parent / 'README.md').read_text(
            encoding='utf-8'
        )
        self.assertNotIn('python -c', source)
        self.assertIn('print-env-prefix.py', source)

    def test_extracts_marked_conda_prefix_before_trailing_warning(self):
        utility = (Path(__file__).parent / 'install-utils.ps1').resolve()
        quoted_utility = str(utility).replace("'", "''")
        command = (
            f". '{quoted_utility}'; "
            "$output = @('__POMODORO_ENV_PREFIX__=D:\\envs\\pomodoro-app', "
            "'warning: trailing conda warning'); "
            "$actual = Get-CondaPrefixFromOutput -OutputLines $output; "
            "if ($actual -ne 'D:\\envs\\pomodoro-app') { "
            "throw \"Unexpected prefix: $actual\" }"
        )
        powershell = Path(os.environ.get('SystemRoot', r'C:\Windows')) / (
            'System32/WindowsPowerShell/v1.0/powershell.exe'
        )
        result = subprocess.run(
            [
                str(powershell),
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-Command',
                command,
            ],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
