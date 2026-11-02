#!/usr/bin/env node
'use strict'
// Additively backfill expert matching dimensions from CV-extraction results.
// For each expert and each of {sectors, donors, activity_types, role_fit}, insert rows
// ONLY IF the expert currently has zero rows in that dimension (preserve existing data).
// argv[2] = results dir (batch*.json), argv[3] = vocab.json path.
require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs'); const path = require('path')
const RESULTS = process.argv[2]; const VOCAB = JSON.parse(fs.readFileSync(process.argv[3],'utf8'))
const DRY = process.argv.includes('--dry')
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const STAMP = 'auto-extracted from CV (roster audit 2026-11)'

const sectorId = Object.fromEntries(VOCAB.sectors.map(r=>[r.name, r.id]))
const donorId  = Object.fromEntries(VOCAB.donors.map(r=>[r.name, r.id]))
const actId    = Object.fromEntries(VOCAB.activity_types.map(r=>[r.name, r.id]))
const roleId   = Object.fromEntries(VOCAB.work_order_roles.map(r=>[r.name, r.id]))

function load() {
  const recs = []
  for (const f of fs.readdirSync(RESULTS).filter(f=>/^batch\d+\.json$/.test(f)).sort()) {
    const arr = JSON.parse(fs.readFileSync(path.join(RESULTS,f),'utf8'))
    for (const r of arr) recs.push(r)
  }
  return recs
}
async function count(table, expertId) {
  const { count, error } = await sb.from(table).select('*', { count:'exact', head:true }).eq('expert_id', expertId)
  if (error) throw new Error(`${table} count ${expertId}: ${error.message}`)
  return count || 0
}
const warn = []
function mapIds(names, map, ctx) {
  const ids = []
  for (const n of (names||[])) {
    const id = map[n]
    if (id == null) { warn.push(`unmapped ${ctx}: "${n}"`); continue }
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

async function main() {
  const recs = load()
  console.log(`Loaded ${recs.length} extraction records. DRY=${DRY}`)
  const stats = { sectors:0, donors:0, activities:0, role_fit:0, skippedSectors:0, skippedDonors:0, skippedAct:0, skippedRole:0, emptyPeople:0 }

  for (const r of recs) {
    const id = r.expert_id

    // sectors (only if 0 existing)
    if ((r.sectors||[]).length) {
      const have = await count('expert_sectors', id)
      if (have === 0) {
        const ids = mapIds(r.sectors, sectorId, 'sector')
        const rows = ids.map((sid,i)=>({ expert_id:id, sector_id:sid, priority: i===0?'primary':'secondary' }))
        if (rows.length && !DRY) { const {error}=await sb.from('expert_sectors').insert(rows); if(error) throw new Error(`sectors ${id}: ${error.message}`) }
        stats.sectors += rows.length
      } else stats.skippedSectors++
    }
    // donors
    if ((r.donors||[]).length) {
      const have = await count('expert_donor_experience', id)
      if (have === 0) {
        const ids = mapIds(r.donors, donorId, 'donor')
        const rows = ids.map(did=>({ expert_id:id, donor_id:did, notes: STAMP }))
        if (rows.length && !DRY) { const {error}=await sb.from('expert_donor_experience').insert(rows); if(error) throw new Error(`donors ${id}: ${error.message}`) }
        stats.donors += rows.length
      } else stats.skippedDonors++
    }
    // activities
    if ((r.activity_types||[]).length) {
      const have = await count('expert_activity_experience', id)
      if (have === 0) {
        const ids = mapIds(r.activity_types, actId, 'activity')
        const rows = ids.map(aid=>({ expert_id:id, activity_type_id:aid, evidence_notes: STAMP }))
        if (rows.length && !DRY) { const {error}=await sb.from('expert_activity_experience').insert(rows); if(error) throw new Error(`activities ${id}: ${error.message}`) }
        stats.activities += rows.length
      } else stats.skippedAct++
    }
    // role_fit
    if ((r.work_order_roles||[]).length) {
      const have = await count('expert_role_fit', id)
      if (have === 0) {
        const ids = mapIds(r.work_order_roles, roleId, 'role')
        const rows = ids.map(rid=>({ expert_id:id, work_order_role_id:rid, notes: STAMP }))
        if (rows.length && !DRY) { const {error}=await sb.from('expert_role_fit').insert(rows); if(error) throw new Error(`role_fit ${id}: ${error.message}`) }
        stats.role_fit += rows.length
      } else stats.skippedRole++
    }
    if (!(r.sectors||[]).length && !(r.donors||[]).length && !(r.activity_types||[]).length && !(r.work_order_roles||[]).length) stats.emptyPeople++
  }

  console.log('\n=== BACKFILL RESULT ===')
  console.log(JSON.stringify(stats, null, 2))
  if (warn.length) { console.log('\nWARNINGS (unmapped vocab):'); [...new Set(warn)].forEach(w=>console.log('  -',w)) }
}
main().catch(e=>{console.error('FAILED:',e.message);process.exit(1)})
