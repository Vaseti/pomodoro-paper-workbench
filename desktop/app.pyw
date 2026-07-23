import ctypes
import logging
from pathlib import Path

from runtime import StaticServer, require_web_app, resolve_project_root


APP_ROOT = Path(r'D:\DevTools\PomodoroLauncher')
STORAGE_DIR = Path(r'D:\DevTools\PomodoroLauncher') / 'data'
LOG_DIR = APP_ROOT / 'logs'


def show_error(message):
    ctypes.windll.user32.MessageBoxW(0, str(message), '番茄钟启动失败', 0x10)


def configure_logging():
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        filename=LOG_DIR / 'desktop.log',
        level=logging.INFO,
        format='%(asctime)s %(levelname)s %(message)s',
        encoding='utf-8',
    )


def main():
    server = None
    try:
        configure_logging()
        STORAGE_DIR.mkdir(parents=True, exist_ok=True)
        server = StaticServer(resolve_project_root(__file__), '127.0.0.1', 4174)
        require_web_app(server.root)
        import webview

        try:
            server.start()
        except OSError as error:
            logging.exception('Desktop server bind/start failure')
            show_error(f'无法启动本地服务。端口 4174 可能已被占用。\n\n{error}')
            return
        webview.create_window(
            '番茄工作台',
            server.url,
            width=1280,
            height=900,
            min_size=(900, 650),
            resizable=True,
        )
        webview.start(private_mode=False, storage_path=str(STORAGE_DIR))
    except OSError as error:
        logging.exception('Desktop application startup OSError')
        show_error(f'无法启动桌面应用。\n\n{error}')
    except Exception as error:
        logging.exception('Desktop application startup failure')
        show_error(error)
    finally:
        if server is not None:
            server.stop()


if __name__ == '__main__':
    main()
