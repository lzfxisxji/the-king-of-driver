# -*- coding: utf-8 -*-
"""本地无缓存静态服务器：用于加载 WebGL 贴图（file:// 会被浏览器安全策略拦截）。
启动后自动打开浏览器。Ctrl+C 结束。"""
import http.server
import socketserver
import os
import sys
import threading
import webbrowser

PORT = 8231
ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
    extensions_map['.js'] = 'text/javascript; charset=utf-8'
    extensions_map['.mjs'] = 'text/javascript; charset=utf-8'
    extensions_map['.css'] = 'text/css; charset=utf-8'
    extensions_map['.html'] = 'text/html; charset=utf-8'
    extensions_map['.json'] = 'application/json; charset=utf-8'
    extensions_map['.png'] = 'image/png'

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stdout.write("  %s\n" % (fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def pick_port(start):
    for p in range(start, start + 20):
        try:
            s = Server(("127.0.0.1", p), Handler)
            return s, p
        except OSError:
            continue
    raise SystemExit("找不到可用端口")


if __name__ == '__main__':
    srv, port = pick_port(PORT)
    url = "http://127.0.0.1:%d/index.html" % port
    print("=" * 52)
    print("  萌兽卡丁 · 本地服务已启动")
    print("  %s" % url)
    print("  关闭窗口即可停止（或按 Ctrl+C）")
    print("=" * 52)
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
