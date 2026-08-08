/* Turbo Critters — shared record board.
 *
 * Deploy alongside index.html on Vercel. The game auto-detects this endpoint
 * and switches to the shared board with no configuration in the HTML.
 *
 * Needs two environment variables in your Vercel project. If you created the
 * store through Vercel's Upstash integration these already exist:
 *   KV_REST_API_URL     (or UPSTASH_REDIS_REST_URL)
 *   KV_REST_API_TOKEN   (or UPSTASH_REDIS_REST_TOKEN)
 *
 * The token is read here on the server and never reaches the browser, which
 * is the whole point of routing through this file instead of calling Upstash
 * from the page.
 *
 *   GET  /api/records?ping=1        -> {ok:true}
 *   GET  /api/records?track=<id>    -> {board:[...], ghost:{...}|null}
 *   GET  /api/records?boards=1      -> {boards:{<id>:[...]}}   (no ghosts)
 *   POST /api/records               -> {track, entry:{ini,ms,ch}, ghost?}
 */

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const BOARD_MAX = 10;
const MAX_GHOST_PTS = 4000;
const TRACKS = ["sunnybay", "candycanyon", "neondowntown", "starfallrim", "sunkensands"];
const key = (t) => `tc:rec:${t}`;

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error(`upstash ${r.status}`);
  const j = await r.json();
  return j.result;
}

async function readRec(track) {
  const v = await redis(["GET", key(track)]);
  if (!v) return { board: [], ghost: null };
  try {
    const d = typeof v === "string" ? JSON.parse(v) : v;
    return { board: Array.isArray(d.board) ? d.board : [], ghost: d.ghost || null };
  } catch {
    return { board: [], ghost: null };
  }
}

/* Everything a browser sends is untrusted, so validate rather than store as-is. */
function cleanEntry(e) {
  if (!e || typeof e !== "object") return null;
  const ini = String(e.ini || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 3)
    .padEnd(3, "A");
  const ms = Math.round(Number(e.ms));
  if (!Number.isFinite(ms) || ms < 4000 || ms > 10 * 60 * 1000) return null; // implausible lap
  const ch = String(e.ch || "mango").replace(/[^a-z]/g, "").slice(0, 12);
  return { ini, ms, ch, at: Date.now() };
}

function cleanGhost(g, entry) {
  if (!g || !Array.isArray(g.pts) || !g.pts.length) return null;
  if (g.pts.length > MAX_GHOST_PTS) return null;
  const pts = [];
  for (const p of g.pts) {
    if (!Array.isArray(p) || p.length < 6) return null;
    const n = p.slice(0, 6).map(Number);
    if (n.some((v) => !Number.isFinite(v))) return null;
    pts.push([Math.round(n[0]), +n[1].toFixed(1), +n[2].toFixed(1), +n[3].toFixed(1), +n[4].toFixed(3), +n[5].toFixed(4)]);
  }
  return { ms: entry.ms, ini: entry.ini, ch: entry.ch, pts };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!URL_ || !TOKEN) {
    return res.status(503).json({ ok: false, error: "KV not configured" });
  }

  try {
    if (req.method === "GET") {
      if (req.query.ping) return res.status(200).json({ ok: true });

      if (req.query.boards) {
        const out = {};
        await Promise.all(
          TRACKS.map(async (t) => {
            const r = await readRec(t);
            out[t] = r.board;
          })
        );
        return res.status(200).json({ ok: true, boards: out });
      }

      const track = String(req.query.track || "");
      if (!TRACKS.includes(track)) return res.status(400).json({ ok: false, error: "bad track" });
      return res.status(200).json(await readRec(track));
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const track = String(body.track || "");
      if (!TRACKS.includes(track)) return res.status(400).json({ ok: false, error: "bad track" });

      const entry = cleanEntry(body.entry);
      if (!entry) return res.status(400).json({ ok: false, error: "bad entry" });

      // Merge server-side: two people finishing at once can't clobber each other.
      const cur = await readRec(track);
      const board = cur.board.concat([entry]).sort((a, b) => a.ms - b.ms).slice(0, BOARD_MAX);

      let ghost = cur.ghost;
      const isNewBest = board[0].ms === entry.ms && board[0].ini === entry.ini;
      if (isNewBest) {
        const g = cleanGhost(body.ghost, entry);
        if (g) ghost = g;
      }

      const merged = { board, ghost };
      await redis(["SET", key(track), JSON.stringify(merged)]);
      return res.status(200).json(merged);
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method not allowed" });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String((err && err.message) || err) });
  }
}
