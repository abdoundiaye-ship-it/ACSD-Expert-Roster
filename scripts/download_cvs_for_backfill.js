#!/usr/bin/env node
'use strict'
// Download CVs from storage for experts that have a CV AND are missing >=1 matching dimension.
// Writes PDFs to <outdir>/<expert_id>.pdf and a manifest.json describing what each is missing.
require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs'); const path = require('path')
const AUDIT = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))   // expert_audit.json (post-upload)
const OUTDIR = process.argv[3]
fs.mkdirSync(OUTDIR, { recursive: true })
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

async function main() {
  const targets = AUDIT.filter(r => r.cv_file_in_storage && (r.n_activities === 0 || r.n_role_fit === 0 || r.n_donors === 0 || r.n_sectors === 0))
  console.log(`Target experts (have CV, missing >=1 dimension): ${targets.length}`)
  const manifest = []
  let ok = 0, fail = 0
  for (const t of targets) {
    const key = t.cv_storage_path // '<id>/cv.pdf'
    const { data, error } = await sb.storage.from('expert-cvs').download(key)
    if (error) { console.log('  DL FAIL', t.full_name, error.message); fail++; continue }
    const buf = Buffer.from(await data.arrayBuffer())
    const fn = `${t.id}.pdf`
    fs.writeFileSync(path.join(OUTDIR, fn), buf)
    manifest.push({
      expert_id: t.id, file: fn, full_name: t.full_name, seniority_tier: t.seniority_tier,
      years_experience: t.years_experience,
      missing: { sectors: t.n_sectors===0, donors: t.n_donors===0, activities: t.n_activities===0, role_fit: t.n_role_fit===0 },
    })
    ok++
    if (ok % 20 === 0) console.log(`  ...${ok} downloaded`)
  }
  fs.writeFileSync(path.join(OUTDIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`DONE. downloaded=${ok} failed=${fail}. manifest.json written with ${manifest.length} entries.`)
}
main().catch(e=>{console.error('FAILED',e.message);process.exit(1)})
