/* Robust Zing adapter: thử nhiều lib & nhiều tên hàm */
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

function safeRequire(name) {
  try { return require(name); } catch { return null; }
}

// Thử nạp các thư viện community khác nhau
const libNext  = safeRequire("zingmp3-api-next");  // thường: { zing: {...} } hoặc object khác
const libFull  = safeRequire("zingmp3-api-full");  // thường: ZingMp3.xxx
const libPlain = safeRequire("zingmp3-api");       // thường: zingmp3.xxx

// Chuẩn hoá API: trả về 2 hàm async: search(q) & getSong(id)
function makeZingAPI() {
  // Các candidate hàm từ từng lib (tên có thể khác nhau theo repo)
  const cand = [];

  // --- zingmp3-api-next ---
  if (libNext) {
    const z = libNext.zing || libNext.default || libNext;
    cand.push({
      src: "zingmp3-api-next",
      search: z?.search,
      getSong: z?.getSong || z?.getStreaming || z?.getSongStreaming
    });
  }

  // --- zingmp3-api-full ---
  if (libFull) {
    const Z = libFull.ZingMp3 || libFull.default || libFull;
    cand.push({
      src: "zingmp3-api-full",
      search: Z?.search,
      getSong: Z?.getStreaming || Z?.getSongStreaming || Z?.getSong
    });
  }

  // --- zingmp3-api (whoant) ---
  if (libPlain) {
    const zp = libPlain.zingmp3 || libPlain.default || libPlain;
    cand.push({
      src: "zingmp3-api",
      search: zp?.search,
      getSong: zp?.getSong || zp?.getStreaming || zp?.getSongStreaming
    });
  }

  // Chọn candidate đầu tiên có đủ 2 hàm
  const picked = cand.find(c => typeof c.search === "function" && typeof c.getSong === "function");
  if (!picked) throw new Error("No usable Zing API lib found");

  // Bao bọc kết quả về chung 1 dạng
  async function search(q) {
    const raw = await picked.search(q);
    // Chuẩn hoá lấy bài đầu trong data.songs
    const songs = raw?.data?.songs || raw?.songs || raw?.data || [];
    const first = Array.isArray(songs) ? songs[0] : songs?.songs?.[0];
    return { lib: picked.src, raw, first };
  }

  async function getSong(encodeId) {
    const raw = await picked.getSong(encodeId);
    // Các lib có thể trả: {data:{'128':url,'320':url}} hoặc {data:{streaming:{'128':url}}}
    const data = raw?.data || {};
    const url128 = data["128"] || data?.streaming?.["128"];
    const url320 = data["320"] || data?.streaming?.["320"];
    return { lib: picked.src, raw, url128, url320 };
  }

  return { search, getSong, src: picked.src };
}

const zing = makeZingAPI();

const app = express();
app.use(cors());

// Debug: xem lib nào đang dùng & hàm nào có sẵn
app.get("/debug/libs", (req, res) => {
  res.json({
    using: zing.src,
    have: {
      next: !!libNext,
      full: !!libFull,
      plain: !!libPlain
    }
  });
});

// /api/zing?song=...&artist=...&quality=128|320
app.get("/api/zing", async (req, res) => {
  try {
    const song = (req.query.song || "").toString().trim();
    const artist = (req.query.artist || "").toString().trim();
    const quality = (req.query.quality || "128") === "320" ? "320" : "128";
    if (!song) return res.status(400).json({ error: "missing ?song" });

    const q = artist ? `${song} ${artist}` : song;

    const { first } = await zing.search(q);
    if (!first?.encodeId) return res.status(404).json({ error: "not_found" });

    const { url128, url320 } = await zing.getSong(first.encodeId);
    const pick = quality === "320" ? (url320 || url128) : (url128 || url320);
    if (!pick) return res.status(502).json({ error: "no_stream" });

    // ESP32 đang ghép base_url + audio_url → trả đường dẫn tương đối /p?u=...
    return res.json({
      artist: first.artistsNames || artist,
      title: first.title || song,
      audio_url: "/p?u=" + encodeURIComponent(pick),
      lyric_url: "",
      quality: pick === url320 ? "320" : "128"
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "server_error" });
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
