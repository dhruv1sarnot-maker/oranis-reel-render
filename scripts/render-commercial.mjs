// scripts/render-commercial.mjs — COMMERCIAL-style reel (2026-07-18): NO talking face. Action beats + the app
// MAGIC (money-shot) as the hero, a VOICEOVER as the master audio, a music bed ducked under, and word-by-word
// captions synced to the VO's real word timestamps. Founder: people dislike AI talking-heads; commercial +
// product-magic converts + dodges the uncanny valley. ffmpeg-only on GitHub Actions ($0 render).
import { execSync } from 'node:child_process'
import fs from 'node:fs'
const E = process.env, tmp = '/tmp/comm'; fs.mkdirSync(tmp, { recursive: true })
const sh = (c) => execSync(c, { stdio: 'inherit' })
async function dl(u, p) { const r = await fetch(u); if (!r.ok) throw new Error('dl ' + r.status); fs.writeFileSync(p, Buffer.from(await r.arrayBuffer())) }
const J = (s) => { try { return JSON.parse(s || '[]') } catch { return [] } }
const clips = J(E.CLIP_URLS), words = J(E.WORDS)
const V = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920'
const ENC = '-c:v libx264 -preset veryfast -pix_fmt yuv420p -r 25 -an'
const dur = (f) => { try { return parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 ${f}`).toString().trim()) || 4 } catch { return 4 } }

// 1) VOICEOVER = the master audio; the whole video runs its length.
await dl(E.VOICEOVER_URL, `${tmp}/vo.mp3`)
const total = dur(`${tmp}/vo.mp3`)

// 2) build the VISUAL timeline to fill `total`: action clips -> money-shot hero -> CTA card.
const segs = []
let t = 0
for (let i = 0; i < clips.length; i++) {
  const cp = `${tmp}/clip${i}.mp4`; try { await dl(clips[i], cp) } catch { continue }
  const seg = `${tmp}/seg${i}.mp4`, len = Math.min(dur(cp), 4.0)
  sh(`ffmpeg -y -i ${cp} -t ${len} -vf "${V},fps=25,format=yuv420p" ${ENC} ${seg}`)
  segs.push({ seg, len }); t += len
}
// money-shot hero (the app magic) — hold ~3s with a punch-in, phone-screen framing on dark ground
if (E.MONEY_SHOT_URL) {
  try { await dl(E.MONEY_SHOT_URL, `${tmp}/money.png`)
    const seg = `${tmp}/money.mp4`
    sh(`ffmpeg -y -loop 1 -i ${tmp}/money.png -t 3.0 -vf "scale=1000:1580:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x0d0f12,zoompan=z='min(zoom+0.0016,1.10)':d=75:s=1080x1920,fps=25,format=yuv420p" ${ENC} ${seg}`)
    segs.push({ seg, len: 3.0 }); t += 3.0
  } catch {}
}
// CTA card to fill the remainder (>=2s)
const ctaLen = Math.max(2.5, total - t)
// wrap the CTA so it never overflows the end card (<=16 chars/line)
{ const cw = String(E.CTA || 'Download').toUpperCase().split(/\s+/); const lines=['']; for(const w of cw){ if((lines[lines.length-1]+' '+w).trim().length<=16) lines[lines.length-1]=(lines[lines.length-1]+' '+w).trim(); else lines.push(w) } fs.writeFileSync(`${tmp}/cta.txt`, lines.filter(Boolean).join('\n')) }
sh(`ffmpeg -y -f lavfi -i color=c=0x111417:s=1080x1920:d=${ctaLen} -vf "drawtext=textfile=${tmp}/cta.txt:fontcolor=white:fontsize=64:line_spacing=16:borderw=6:bordercolor=black:box=1:boxcolor=0x2E7D5B@0.9:boxborderw=28:x=(w-tw)/2:y=(h-th)/2,fps=25,format=yuv420p" ${ENC} ${tmp}/cta.mp4`)
segs.push({ seg: `${tmp}/cta.mp4`, len: ctaLen })

// 3) concat the visual track
fs.writeFileSync(`${tmp}/list.txt`, segs.map((s) => `file '${s.seg}'`).join('\n'))
sh(`ffmpeg -y -f concat -safe 0 -i ${tmp}/list.txt -c copy ${tmp}/vid.mp4`)

// 4) WORD-BY-WORD captions synced to the VO's real timestamps (1-3 words grouped), bold white + black outline.
let capF = ''
if (words.length) {
  const groups = []
  // CLEAN captions (founder: "the texts is the problem"): strip ALL punctuation, drop the brand name, group
  // into short phrases that always FIT the frame (no edge cutoff), never show a period or "CurioSnap".
  const brand = String(E.APP_SLUG || '').toLowerCase()
  const clean = (w) => (w || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim()
  for (let i = 0; i < words.length;) {
    let text = clean(words[i].word), j = i + 1
    // grow the group up to ~14 chars so pairs like "SNAP ANYTHING" stay together, longer words go solo
    while (j < words.length && (text + ' ' + clean(words[j].word)).length <= 14) { text = (text + ' ' + clean(words[j].word)).trim(); j++ }
    const a = words[i].start, b = words[j - 1].end
    // drop empty groups + the brand word (never show the app name as a caption)
    if (text && text.toLowerCase() !== brand) groups.push({ text, a, b })
    i = j
  }
  // fontsize 58 keeps <=14-char lines well inside 1080px; lower third, bold white + thick outline.
  capF = ',' + groups.map((g, i) => { const f = `${tmp}/w${i}.txt`; fs.writeFileSync(f, g.text); return `drawtext=textfile=${f}:fontcolor=white:fontsize=58:borderw=7:bordercolor=black:x=(w-tw)/2:y=h*0.76:enable='between(t,${g.a.toFixed(2)},${g.b.toFixed(2)})'` }).join(',')
}

// 5) audio: VO master + music bed ducked under (loop the short clip), captions burned, output.
let haveMusic = false
if (E.MUSIC_URL) { try { await dl(E.MUSIC_URL, `${tmp}/m.mp3`); haveMusic = fs.existsSync(`${tmp}/m.mp3`) } catch {} }
if (haveMusic) {
  sh(`ffmpeg -y -i ${tmp}/vid.mp4 -i ${tmp}/vo.mp3 -stream_loop -1 -i ${tmp}/m.mp3 -filter_complex "[0:v]${V.replace('scale','scale')}${capF},format=yuv420p[v];[2:a]volume=0.14[bg];[1:a][bg]amix=inputs=2:duration=first[a]" -map "[v]" -map "[a]" -c:v libx264 -preset veryfast -c:a aac -t ${total} ${tmp}/out.mp4`)
} else {
  sh(`ffmpeg -y -i ${tmp}/vid.mp4 -i ${tmp}/vo.mp3 -filter_complex "[0:v]format=yuv420p${capF}[v]" -map "[v]" -map 1:a -c:v libx264 -preset veryfast -c:a aac -t ${total} ${tmp}/out.mp4`)
}

// upload + writeback (same contract as the reel renderer)
const key = `reels/${E.APP_SLUG}/${E.QUEUE_ITEM_ID}.mp4`
const up = await fetch(`${E.SUPABASE_URL}/storage/v1/object/generated-apps/${key}`, { method: 'POST', headers: { apikey: E.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${E.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'video/mp4', 'x-upsert': 'true' }, body: fs.readFileSync(`${tmp}/out.mp4`) })
if (!up.ok) { console.error('upload failed', up.status); process.exit(1) }
const videoUrl = `${E.SUPABASE_URL}/storage/v1/object/public/generated-apps/${key}`
await fetch(`${E.ORANIS_BASE_URL}/api/social/reel-rendered`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': E.INTERNAL_API_KEY || '' }, body: JSON.stringify({ queueItemId: E.QUEUE_ITEM_ID, videoUrl, provider: 'commercial-gha', mode: 'commercial' }) }).catch(() => {})
console.log('rendered COMMERCIAL', videoUrl)
