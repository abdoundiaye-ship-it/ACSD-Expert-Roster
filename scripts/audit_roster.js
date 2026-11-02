#!/usr/bin/env node
'use strict'
// One-off roster audit: structured-field completeness + CV file presence in storage.
// Writes JSON + gap lists to the path given as argv[2]. Run from repo root.
require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const OUT = process.argv[2]
if (!OUT) { console.error('usage: node scripts/audit_roster.js <output-dir>'); process.exit(1) }
fs.mkdirSync(OUT, { recursive: true })

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

async function tallyJunction(table) {
  const map = {}
  let from = 0, pageSize = 1000
  while (true) {
    const { data, error } = await sb.from(table).select('expert_id').range(from, from + pageSize - 1)
    if (error) { console.error(`WARN ${table}: ${error.message}`); break }
    for (const row of data) map[row.expert_id] = (map[row.expert_id] || 0) + 1
    if (data.length < pageSize) break
    from += pageSize
  }
  return map
}

async function main() {
  const { data: experts, error } = await sb.from('experts')
    .select('id, full_name, affiliation_type, partner_org, seniority_tier, years_experience, is_active, bio_summary, cv_storage_path, email, notes, created_at')
    .order('full_name')
  if (error) throw new Error('experts: ' + error.message)

  const tables = ['expert_sectors','expert_languages','expert_geographies','expert_donor_experience','expert_activity_experience','expert_role_fit','education_certifications']
  const counts = {}
  for (const t of tables) counts[t] = await tallyJunction(t)

  // Storage: list expert-cvs top-level folders, then check each for a pdf
  const storageFolders = new Set()
  let offset = 0
  while (true) {
    const { data, error: e } = await sb.storage.from('expert-cvs').list('', { limit: 100, offset })
    if (e) { console.error('storage list error: ' + e.message); break }
    if (!data || data.length === 0) break
    for (const item of data) if (item.id === null) storageFolders.add(item.name)
    if (data.length < 100) break
    offset += 100
  }
  const cvPresent = {}
  for (const eid of storageFolders) {
    const { data } = await sb.storage.from('expert-cvs').list(eid, { limit: 100 })
    cvPresent[eid] = (data || []).some(f => f.name && f.name.toLowerCase().endsWith('.pdf'))
  }

  const report = experts.map(e => ({
    id: e.id, full_name: e.full_name, affiliation_type: e.affiliation_type,
    seniority_tier: e.seniority_tier, years_experience: e.years_experience, is_active: e.is_active,
    has_bio: !!(e.bio_summary && e.bio_summary.trim()),
    cv_storage_path: e.cv_storage_path,
    cv_file_in_storage: e.cv_storage_path ? !!cvPresent[e.cv_storage_path.split('/')[0]] : false,
    n_sectors: counts.expert_sectors[e.id] || 0,
    n_languages: counts.expert_languages[e.id] || 0,
    n_geographies: counts.expert_geographies[e.id] || 0,
    n_donors: counts.expert_donor_experience[e.id] || 0,
    n_activities: counts.expert_activity_experience[e.id] || 0,
    n_role_fit: counts.expert_role_fit[e.id] || 0,
    n_education: counts.education_certifications[e.id] || 0,
  }))
  fs.writeFileSync(path.join(OUT, 'expert_audit.json'), JSON.stringify(report, null, 2))

  const f = (pred) => report.filter(pred).length
  const L = []
  L.push('=== ROSTER AUDIT ===')
  L.push(`Total: ${report.length} | partner: ${f(r=>r.affiliation_type==='partner')} | internal: ${f(r=>r.affiliation_type==='internal')} | active: ${f(r=>r.is_active)}`)
  L.push('')
  L.push('Experts WITH >=1 row in each dimension:')
  L.push(`  bio_summary:  ${f(r=>r.has_bio)}`)
  L.push(`  sectors:      ${f(r=>r.n_sectors>0)}`)
  L.push(`  languages:    ${f(r=>r.n_languages>0)}`)
  L.push(`  geographies:  ${f(r=>r.n_geographies>0)}`)
  L.push(`  donors:       ${f(r=>r.n_donors>0)}`)
  L.push(`  activities:   ${f(r=>r.n_activities>0)}`)
  L.push(`  role_fit:     ${f(r=>r.n_role_fit>0)}`)
  L.push(`  education:    ${f(r=>r.n_education>0)}`)
  L.push('')
  L.push('CV files:')
  L.push(`  cv_storage_path set:        ${f(r=>!!r.cv_storage_path)}`)
  L.push(`  CV pdf actually in storage: ${f(r=>r.cv_file_in_storage)}`)
  L.push(`  path set but file MISSING:  ${f(r=>r.cv_storage_path && !r.cv_file_in_storage)}`)
  L.push(`  no path at all:             ${f(r=>!r.cv_storage_path)}`)
  L.push('')
  L.push('Matching-critical gaps:')
  L.push(`  NO sectors:    ${f(r=>r.n_sectors===0)}`)
  L.push(`  NO languages:  ${f(r=>r.n_languages===0)}`)
  L.push(`  NO geographies:${f(r=>r.n_geographies===0)}`)
  L.push(`  NO activities: ${f(r=>r.n_activities===0)}`)
  L.push(`  NO role_fit:   ${f(r=>r.n_role_fit===0)}`)
  L.push(`  storage folders in bucket: ${storageFolders.size}`)
  const out = L.join('\n')
  console.log(out)
  fs.writeFileSync(path.join(OUT, 'summary.txt'), out)

  fs.writeFileSync(path.join(OUT, 'gaps_no_sectors.txt'), report.filter(r=>r.n_sectors===0).map(r=>`${r.full_name}\t${r.affiliation_type}\t${r.id}`).join('\n'))
  fs.writeFileSync(path.join(OUT, 'gaps_no_cv_file.txt'), report.filter(r=>!r.cv_file_in_storage).map(r=>`${r.full_name}\t${r.affiliation_type}\t${r.id}`).join('\n'))
  console.log('\nWrote expert_audit.json + summary + gap lists to', OUT)
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
