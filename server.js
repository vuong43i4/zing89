// server.js
const express = require("express");
const cors = require("cors");

// nạp gói và “bắt mọi kiểu export”
const zlib = require("zingmp3-api-next");     // v1.0.4
const zingRaw = zlib?.zing || zlib?.default || zlib;

// chọn đúng hàm (tên có thể khác nhau theo build)
const searchFn  = typeof zingRaw?.search === "function" ? zingRaw.search : null;
const getSongFn = (["getSong","getStreaming","getSongStreaming"]
  .map(k => typeof zingRaw?.[k] === "function" ? zingRaw[k] : null)
  .find(Boolean));

if (!searchFn || !getSongFn) {
  console.error("❌ Không tìm thấy hàm search/getSong trong zingmp3-api-next@1.0.4");
  process.exit(1);
}

const app = express();
app.use(cors());

// GET /api/zing?song=&artist=&quality=128|320
app.get("/api/zing", async (req, res) => {
  try {
    const song = (req.query.song || "").toString().trim();
    const artist = (req.query.artist || "").toString().trim();
    const quality = (req.query.quality || "128") === "320" ? "320" : "128";
    if (!song) return res.status(400).json({ error: "missing ?song" });

    const q = artist ? `${song} ${artist}` : song;

    // 1) tìm bài
    const s = await searchFn(q);
    const first = s?.data?.songs?.[0];
    if (!first?.encodeId) return res.status(404).json({ error: "not_found" });

    // 2) lấy link phát
    const st = await getSongFn(first.encodeId);
    const u128 = st?.data?.["128"] || st?.data?.streaming?.["128"];
    const u320 = st?.data?.["320"] || st?.data?.streaming?.["320"];
    const pick = (quality === "320" ? (u320 || u128) : (u128 || u320));
    if (!pick) return res.status(502).json({ error: "no_stream" });

    // Trả schema mà ESP32 đang parse: audio_url là đường dẫn tương đối /p?u=...
    return res.json({
      artist: first.artistsNames || artist,
      title: first.title || song,
      audio_url: "/p?u=" + encodeURIComponent(pick),
      lyric_url: "",
      quality: pick === u320 ? "320" : "128"
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || "server_error" });
  }
});

// Proxy stream: /p?u=<remote_mp3_url>
// Node 22 có global fetch → dùng trực tiếp
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

// Debug xem hàm đã bắt được chưa
app.get("/debug/libs", (req, res) => {
  res.json({
    lib: "zingmp3-api-next@1.0.4",
    has: {
      search: !!searchFn,
      getSong: !!getSongFn
    }
  });
});

app.get("/", (_, res) => res.send("OK"));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Node bridge listening on " + port));
