// scripts/render-reel.mjs — $0 reel renderer. Runs in GitHub Actions (ffmpeg only; no headless Chrome,
// no paid API). Inputs via env. Renders a 9:16 reel from app screenshots + hook overlay + optional music,
// uploads to Supabase Storage, writes video_url back to ORANIS. Bypasses Vercel's render limits entirely.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
const E = process.env
const tmp = '/tmp/reel'; fs.mkdirSync(tmp, { recursive: true })
async function dl(url, p) { const r = await fetch(url); if (!r.ok) throw new Error('dl '+r.status); fs.writeFileSync(p, Buffer.from(await r.arrayBuffer())) }
const images = (() => { try { return JSON.parse(E.IMAGE_URLS || '[]') } catch { return [] } })().slice(0, 6)
if (!images.length) { console.error('no images — skip'); process.exit(0) }
const segs = []
for (let i = 0; i < images.length; i++) {
  const ip = `${tmp}/img${i}.png`; try { await dl(images[i], ip) } catch { continue }
  const seg = `${tmp}/seg${i}.mp4`
  execSync(`ffmpeg -y -loop 1 -i ${ip} -t 3 -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.0012,1.12)':d=75:s=1080x1920,format=yuv420p" -r 25 ${seg}`, { stdio: 'ignore' })
  segs.push(seg)
}
if (!segs.length) { console.error('no segments'); process.exit(0) }
fs.writeFileSync(`${tmp}/list.txt`, segs.map((s) => `file '${s}'`).join('\n'))
execSync(`ffmpeg -y -f concat -safe 0 -i ${tmp}/list.txt -c copy ${tmp}/base.mp4`, { stdio: 'ignore' })
const hook = String(E.HOOK || '').replace(/['":\\]/g, ' ').slice(0, 80)
const drawtext = `drawtext=text='${hook}':fontcolor=white:fontsize=56:box=1:boxcolor=black@0.55:boxborderw=18:x=(w-tw)/2:y=150:line_spacing=10`
let cmd = `ffmpeg -y -i ${tmp}/base.mp4`
let haveMusic = false
if (E.MUSIC_URL) { try { await dl(E.MUSIC_URL, `${tmp}/m.mp3`); haveMusic = fs.existsSync(`${tmp}/m.mp3`) } catch {} }
if (haveMusic) cmd += ` -stream_loop -1 -i ${tmp}/m.mp3`
cmd += ` -vf "${drawtext}" -c:v libx264 -pix_fmt yuv420p`
if (haveMusic) cmd += ` -map 0:v -map 1:a -c:a aac -shortest`
cmd += ` ${tmp}/out.mp4`
execSync(cmd, { stdio: 'ignore' })
const key = `reels/${E.APP_SLUG}/${E.QUEUE_ITEM_ID}.mp4`
const up = await fetch(`${E.SUPABASE_URL}/storage/v1/object/generated-apps/${key}`, {
  method: 'POST', headers: { apikey: E.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${E.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'video/mp4', 'x-upsert': 'true' },
  body: fs.readFileSync(`${tmp}/out.mp4`),
})
if (!up.ok) { console.error('upload failed', up.status, await up.text().catch(() => '')); process.exit(1) }
const videoUrl = `${E.SUPABASE_URL}/storage/v1/object/public/generated-apps/${key}`
const wb = await fetch(`${E.ORANIS_BASE_URL}/api/social/reel-rendered`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': E.INTERNAL_API_KEY || '' },
  body: JSON.stringify({ queueItemId: E.QUEUE_ITEM_ID, videoUrl, provider: 'ffmpeg-gha' }),
})
console.log('rendered + wrote back', videoUrl, 'writeback', wb.status)
