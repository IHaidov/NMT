const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3000;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  let file = req.url === "/" ? "/index.html" : req.url;
  file = path.join(__dirname, file.replace(/\?.*$/, ""));

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Сервер запущено: http://localhost:${PORT}`);
  console.log("Відкрийте цю адресу в браузері для проходження тесту.");
});
