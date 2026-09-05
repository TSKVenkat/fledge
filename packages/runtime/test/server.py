# Static server for the spikes.
#
# Two things here are load-bearing and were both bugs first:
#   - ThreadingHTTPServer, not TCPServer. A module worker chains imports
#     (pyodide.mjs -> pyodide.asm.mjs -> .wasm) while the page is still being
#     served; a single-threaded server deadlocks against HTTP keep-alive.
#   - .mjs and .wasm MIME types. Python maps neither, so they arrive as
#     application/octet-stream and the browser refuses the module script.
#
# It deliberately sets NO COOP/COEP: spike 1 tests the un-isolated case.
import http.server, sys, mimetypes

mimetypes.add_type('text/javascript', '.mjs')
mimetypes.add_type('application/wasm', '.wasm')

class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.mjs': 'text/javascript', '.wasm': 'application/wasm'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a): pass

http.server.ThreadingHTTPServer.allow_reuse_address = True
srv = http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H)
srv.daemon_threads = True
srv.serve_forever()
