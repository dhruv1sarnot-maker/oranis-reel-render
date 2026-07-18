// scripts/render-reel.mjs — $0 SCENARIO reel renderer v2 (GitHub Actions, ffmpeg only).
// Converting structure (founder 2026-07-17: "a reel usually has a real life scenario or ppl"):
//   real-people scenario clips (CLIP_URLS, stock) with the HOOK overlaid on beat 1
//   -> app payoff (1 screenshot, ken-burns) -> CTA end-card -> music.
// Fallback: no CLIP_URLS -> v1 screenshot-slideshow mode (never renders nothing).
import { execSync } from 'node:child_process'
import fs from 'node:fs'
const E = process.env
const tmp = '/tmp/reel'; fs.mkdirSync(tmp, { recursive: true })
const sh = (c) => execSync(c, { stdio: 'inherit' })
async function dl(url, p) { const r = await fetch(url); if (!r.ok) throw new Error('dl '+r.status); fs.writeFileSync(p, Buffer.from(await r.arrayBuffer())) }
const J = (s) => { try { return JSON.parse(s || '[]') } catch { return [] } }
const clips = J(E.CLIP_URLS).slice(0, 3)
const images = J(E.IMAGE_URLS).slice(0, 6)
const esc = (s, n) => String(s || '').replace(/['":\\%,]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)
const hook = esc(E.HOOK, 80)
const cta = esc(E.CTA, 60) || ('Download ' + esc(E.APP_SLUG, 30))
const V = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920'
const hookText = hook ? `,drawtext=text='${hook}':fontcolor=white:fontsize=58:box=1:boxcolor=black@0.55:boxborderw=20:x=(w-tw)/2:y=210` : ''
const segs = []

if (clips.length) {
  // SCENARIO MODE — real-life beats first (2.6s each, muted), hook on beat 1
  for (let i = 0; i < clips.length; i++) {
    const cp = `${tmp}/clip${i}.mp4`; try { await dl(clips[i], cp) } catch { continue }
    const seg = `${tmp}/cseg${i}.mp4`
    const overlay = i === 0 ? hookText : ''
    try {
      sh(`ffmpeg -y -i ${cp} -t 2.6 -an -vf "${V},fps=25${overlay},format=yuv420p" -c:v libx264 -preset veryfast ${seg}`)
      segs.push(seg)
    } catch {}
  }
  // APP PAYOFF — one screenshot, slow push-in (the product moment, not the whole video)
  if (images.length) {
    const ip = `${tmp}/payoff.png`
    try {
      await dl(images[0], ip)
      const seg = `${tmp}/payoff.mp4`
      sh(`ffmpeg -y -loop 1 -i ${ip} -t 2.6 -vf "${V},zoompan=z='min(zoom+0.0018,1.16)':d=65:s=1080x1920,fps=25,format=yuv420p" -c:v libx264 -preset veryfast ${seg}`)
      segs.push(seg)
    } catch {}
  }
  // CTA END-CARD — 1.6s, bold centered CTA
  try {
    const seg = `${tmp}/cta.mp4`
    sh(`ffmpeg -y -f lavfi -i color=c=0x111417:s=1080x1920:d=1.6 -vf "drawtext=text='${cta}':fontcolor=white:fontsize=72:box=1:boxcolor=0x2E7D5B@0.9:boxborderw=28:x=(w-tw)/2:y=(h-th)/2,fps=25,format=yuv420p" -c:v libx264 -preset veryfast ${seg}`)
    segs.push(seg)
  } catch {}
}

if (!segs.length) {
  // V1 FALLBACK — screenshot slideshow with hook overlay (previous behavior)
  for (let i = 0; i < images.length; i++) {
    const ip = `${tmp}/img${i}.png`; try { await dl(images[i], ip) } catch { continue }
    const seg = `${tmp}/seg${i}.mp4`
    try {
      sh(`ffmpeg -y -loop 1 -i ${ip} -t 3 -vf "${V},zoompan=z='min(zoom+0.0012,1.12)':d=75:s=1080x1920${i === 0 ? hookText : ''},fps=25,format=yuv420p" -c:v libx264 -preset veryfast ${seg}`)
      segs.push(seg)
    } catch {}
  }
}
if (!segs.length) { console.error('no segments'); process.exit(0) }

fs.writeFileSync(`${tmp}/list.txt`, segs.map((s) => `file '${s}'`).join('\n'))
sh(`ffmpeg -y -f concat -safe 0 -i ${tmp}/list.txt -c copy ${tmp}/base.mp4`)
let haveMusic = false
if (E.MUSIC_URL) { try { await dl(E.MUSIC_URL, `${tmp}/m.mp3`); haveMusic = fs.existsSync(`${tmp}/m.mp3`) } catch {} }
let cmd = `ffmpeg -y -i ${tmp}/base.mp4`
if (haveMusic) cmd += ` -stream_loop -1 -i ${tmp}/m.mp3 -map 0:v -map 1:a -c:v copy -c:a aac -shortest`
else cmd += ` -c copy`
cmd += ` ${tmp}/out.mp4`
sh(cmd)

const key = `reels/${E.APP_SLUG}/${E.QUEUE_ITEM_ID}.mp4`
const up = await fetch(`${E.SUPABASE_URL}/storage/v1/object/generated-apps/${key}`, {
  method: 'POST', headers: { apikey: E.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${E.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'video/mp4', 'x-upsert': 'true' },
  body: fs.readFileSync(`${tmp}/out.mp4`),
})
if (!up.ok) { console.error('upload failed', up.status, await up.text().catch(() => '')); process.exit(1) }
const videoUrl = `${E.SUPABASE_URL}/storage/v1/object/public/generated-apps/${key}`
const wb = await fetch(`${E.ORANIS_BASE_URL}/api/social/reel-rendered`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': E.INTERNAL_API_KEY || '' },
  body: JSON.stringify({ queueItemId: E.QUEUE_ITEM_ID, videoUrl, provider: 'ffmpeg-gha', mode: clips.length ? 'scenario' : 'slideshow' }),
})
console.log('rendered', clips.length ? 'SCENARIO' : 'slideshow', videoUrl, 'writeback', wb.status)
