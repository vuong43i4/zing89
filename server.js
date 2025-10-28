// Proxy stream cho ESP32: /p?u=<url_mp3_cdn_da_encode>
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

// /p: kéo từ CDN Zing và pass-through header Range/Content-Range
app.get("/p", async (req, res) => {
  try {
    const u = req.query.u;
    if (!u) return res.status(400).send("missing ?u");

    // Node 20/22 có global fetch sẵn
    const r = await fetch(u, {
      headers: {
        "User-Agent": "ESP32-Music-Player/1.0",
        "Range": req.headers.range || "bytes=0-"
      }
    });

    res.status(r.status);
    res.set("Content-Type", r.headers.get("content-type") || "audio/mpeg");
    if (r.headers.get("accept-ranges")) res.set("Accept-Ranges", r.headers.get("accept-ranges"));
    if (r.headers.get("content-range")) res.set("Content-Range", r.headers.get("content-range"));
    if (r.headers.get("content-length")) res.set("Content-Length", r.headers.get("content-length"));

    r.body.pipe(res);
  } catch (e) {
    res.status(500).send("proxy_error");
  }
});

app.get("/", (_, res) => res.send("OK"));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Node /p proxy listening on " + port));
