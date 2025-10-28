const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch"); // v3 là ESM, nhưng vẫn require được qua cjs-interop trên Node 20+
const { zing } = require("zingmp3-api-next");

const app = express();
app.use(cors());

// /api/zing?song=...&artist=...&quality=128|320
app.get("/api/zing", async (req, res) => {
  try {
    const song = (req.query.song || "").toString().trim();
    const artist = (req.query.artist || "").toString().trim();
    const quality = (req.query.quality || "128") === "320" ? "320" : "128";
    if (!song) return res.status(400).json({ error: "missing ?song" });

    const q = artist ? `${song} ${artist}` : song;

    const s = await zing.search(q);
    const first = s?.data?.songs?.[0];
    if (!first?.encodeId) return res.status(404).json({ error: "not_found" });

    const st = await zing.getSong(first.encodeId);
    const url = st?.data?.[quality];
    if (!url) return res.status(502).json({ error: "no_stream" });

    // ESP32 sẽ ghép base_url + audio_url, nên trả đường dẫn tương đối /p?u=...
    return res.json({
      artist: first.artistsNames || artist,
      title: first.title || song,
      audio_url: "/p?u=" + encodeURIComponent(url),
      lyric_url: "",
      quality
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "server_error" });
  }
});

// Proxy stream /p?u=<remote_mp3_url>
app.get("/p", async (req, res) => {
  try {
    const u = req.query.u;
    if (!u) return res.status(400).send("missing ?u");

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
app.listen(port, () => console.log("Node bridge listening on " + port));
