#!/usr/bin/env node
/**
 * seed_experts.js
 * Reads all staging JSON files from data/staging/ and inserts expert records
 * into Supabase, including all many-to-many tagging tables.
 *
 * Prerequisites:
 *   npm install
 *   Copy .env.example to .env and fill in your Supabase credentials.
 *
 * Usage:
 *   npm run seed            # skips if experts table already has rows
 *   npm run seed:force      # re-seeds regardless (deletes existing experts first)
 *
 * The script uses the SERVICE ROLE KEY so it bypasses RLS. Never expose this
 * key in frontend code or commit it to git.
 */

'use strict'

require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const STAGING_DIR = path.join(__dirname, '..', 'data', 'staging')
const FORCE = process.argv.includes('--force')

// ── Supabase client (service role) ──────────────────────────────────────────

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env')
  process.exit(1)
}

const sb = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
})

// ── Helpers ──────────────────────────────────────────────────────────────────

function abort(msg, detail) {
  console.error('\nFATAL:', msg)
  if (detail) console.error(detail)
  process.exit(1)
}

async function fetchLookup(table, nameCol) {
  const { data, error } = await sb.from(table).select(`id, ${nameCol}`)
  if (error) abort(`Failed to fetch ${table}`, error)
  return Object.fromEntries(data.map(r => [r[nameCol], r.id]))
}

function resolveId(map, name, context) {
  const id = map[name]
  if (!id) throw new Error(`Unknown ${context}: "${name}" — check staging data or seed table`)
  return id
}

// ── Expert seeding ───────────────────────────────────────────────────────────

async function seedExpert(expert, maps) {
  const { sectorMap, langMap, geoMap, donorMap, activityMap, roleMap } = maps

  // 1. Core expert row
  const { data: row, error: expertErr } = await sb
    .from('experts')
    .insert({
      full_name: expert.full_name,
      title: expert.title ?? null,
      affiliation_type: expert.affiliation_type,
      partner_org: expert.partner_org ?? null,
      seniority_tier: expert.seniority_tier ?? null,
      years_experience: expert.years_experience ?? null,
      availability_status: expert.availability_status ?? 'unknown',
      bio_summary: expert.bio_summary ?? null,
    })
    .select('id')
    .single()

  if (expertErr) throw new Error(`Insert expert failed: ${expertErr.message}`)
  const expertId = row.id

  // 2. Sectors
  const sectorRows = []
  if (expert.sectors?.primary) {
    sectorRows.push({
      expert_id: expertId,
      sector_id: resolveId(sectorMap, expert.sectors.primary, 'sector'),
      priority: 'primary',
    })
  }
  for (const name of (expert.sectors?.secondary ?? [])) {
    sectorRows.push({
      expert_id: expertId,
      sector_id: resolveId(sectorMap, name, 'sector'),
      priority: 'secondary',
    })
  }
  if (sectorRows.length) {
    const { error } = await sb.from('expert_sectors').insert(sectorRows)
    if (error) throw new Error(`expert_sectors: ${error.message}`)
  }

  // 3. Languages
  const langRows = (expert.languages ?? []).map(l => ({
    expert_id: expertId,
    language_id: resolveId(langMap, l.name, 'language'),
    proficiency: l.proficiency ?? null,
  }))
  if (langRows.length) {
    const { error } = await sb.from('expert_languages').insert(langRows)
    if (error) throw new Error(`expert_languages: ${error.message}`)
  }

  // 4. Geographies
  const geoRows = (expert.geographies ?? []).map(country => ({
    expert_id: expertId,
    geography_id: resolveId(geoMap, country, 'geography'),
  }))
  if (geoRows.length) {
    const { error } = await sb.from('expert_geographies').insert(geoRows)
    if (error) throw new Error(`expert_geographies: ${error.message}`)
  }

  // 5. Donor experience
  const donorRows = (expert.donor_experience ?? []).map(d => ({
    expert_id: expertId,
    donor_id: resolveId(donorMap, d.donor, 'donor'),
    notes: d.notes ?? null,
  }))
  if (donorRows.length) {
    const { error } = await sb.from('expert_donor_experience').insert(donorRows)
    if (error) throw new Error(`expert_donor_experience: ${error.message}`)
  }

  // 6. Education & certifications
  const eduRows = (expert.education_certifications ?? []).map(e => ({
    expert_id: expertId,
    type: e.type,
    title: e.title,
    institution: e.institution ?? null,
    year: e.year ?? null,
  }))
  if (eduRows.length) {
    const { error } = await sb.from('education_certifications').insert(eduRows)
    if (error) throw new Error(`education_certifications: ${error.message}`)
  }

  // 7. Activity experience
  const actRows = (expert.activity_experience ?? []).map(name => ({
    expert_id: expertId,
    activity_type_id: resolveId(activityMap, name, 'activity type'),
  }))
  if (actRows.length) {
    const { error } = await sb.from('expert_activity_experience').insert(actRows)
    if (error) throw new Error(`expert_activity_experience: ${error.message}`)
  }

  // 8. Role fit
  const roleRows = (expert.role_fit ?? []).map(name => ({
    expert_id: expertId,
    work_order_role_id: resolveId(roleMap, name, 'work order role'),
  }))
  if (roleRows.length) {
    const { error } = await sb.from('expert_role_fit').insert(roleRows)
    if (error) throw new Error(`expert_role_fit: ${error.message}`)
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Guard: skip if already seeded
  const { count, error: countErr } = await sb
    .from('experts')
    .select('id', { count: 'exact', head: true })
  if (countErr) abort('Could not check experts table', countErr)

  if (count > 0 && !FORCE) {
    console.log(`Experts table already contains ${count} records.`)
    console.log('Use "npm run seed:force" to delete existing records and re-seed.')
    process.exit(0)
  }

  if (count > 0 && FORCE) {
    console.log(`--force: deleting ${count} existing expert records...`)
    const { error } = await sb.from('experts').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    if (error) abort('Failed to delete existing experts', error)
    console.log('Existing records deleted.\n')
  }

  // Fetch lookup tables
  console.log('Loading lookup tables...')
  const [sectorMap, langMap, geoMap, donorMap, activityMap, roleMap] = await Promise.all([
    fetchLookup('sectors', 'name'),
    fetchLookup('languages', 'name'),
    fetchLookup('geographies', 'country_name'),
    fetchLookup('donors', 'name'),
    fetchLookup('activity_types', 'name'),
    fetchLookup('work_order_roles', 'name'),
  ])
  const maps = { sectorMap, langMap, geoMap, donorMap, activityMap, roleMap }

  // Load and process staging files (alphabetical order: core first, then partner)
  const files = fs.readdirSync(STAGING_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()

  let inserted = 0
  const errors = []

  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(STAGING_DIR, file), 'utf-8'))
    console.log(`\n── ${raw.batch}`)

    for (const expert of raw.experts) {
      try {
        await seedExpert(expert, maps)
        console.log(`  ✓  ${expert.full_name}`)
        inserted++
      } catch (err) {
        console.error(`  ✗  ${expert.full_name}: ${err.message}`)
        errors.push({ name: expert.full_name, file, error: err.message })
      }
    }
  }

  console.log('\n' + '─'.repeat(50))
  console.log(`Seeded: ${inserted} expert${inserted !== 1 ? 's' : ''}`)

  if (errors.length) {
    console.warn(`\nErrors (${errors.length}):`)
    errors.forEach(e => console.warn(`  ${e.file} / ${e.name}: ${e.error}`))
    process.exit(1)
  } else {
    console.log('Done. ✓')
  }
}

main().catch(err => { console.error('Unexpected error:', err); process.exit(1) })
