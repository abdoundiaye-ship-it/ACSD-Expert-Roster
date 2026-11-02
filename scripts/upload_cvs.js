#!/usr/bin/env node
'use strict'
// Upload mapped CV PDFs to expert-cvs/<id>/cv.pdf and set experts.cv_storage_path.
// Additive: only touches records whose cv_storage_path is currently null OR whose file is missing.
// Reads plan from argv[2] (upload_plan.json). Folder base from argv[3].
require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs'); const path = require('path')
const PLAN = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const BASE = process.argv[3]
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

async function main() {
  const plan = PLAN.needUpload
  console.log(`Uploading ${plan.length} CVs...`)
  let ok = 0, fail = 0
  const failures = []
  for (const u of plan) {
    const abs = path.join(BASE, u.file)
    if (!fs.existsSync(abs)) { console.log('  MISSING LOCAL:', u.name, '->', u.file); failures.push([u.name,'local file not found: '+u.file]); fail++; continue }
    const bytes = fs.readFileSync(abs)
    const dest = `${u.expert_id}/cv.pdf`
    const { error: upErr } = await sb.storage.from('expert-cvs').upload(dest, bytes, { contentType: 'application/pdf', upsert: true })
    if (upErr) { console.log('  UPLOAD FAIL:', u.name, upErr.message); failures.push([u.name, upErr.message]); fail++; continue }
    const { error: dbErr } = await sb.from('experts').update({ cv_storage_path: dest }).eq('id', u.expert_id)
    if (dbErr) { console.log('  DB PATH FAIL:', u.name, dbErr.message); failures.push([u.name, dbErr.message]); fail++; continue }
    ok++
    if (ok % 10 === 0) console.log(`  ...${ok} done`)
  }
  console.log(`\nDONE. uploaded=${ok} failed=${fail}`)
  if (failures.length) { console.log('Failures:'); failures.forEach(f=>console.log('  -', f[0], ':', f[1])) }
}
main().catch(e=>{console.error('FAILED',e.message);process.exit(1)})
