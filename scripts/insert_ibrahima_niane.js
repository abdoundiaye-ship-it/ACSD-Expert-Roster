#!/usr/bin/env node
/**
 * One-off insert of Ibrahima Niane into the ACSD Expert Roster, using the
 * service-role Supabase client (bypasses RLS), since the Management API
 * personal access token used by the older .ps1 seed scripts has expired.
 */
'use strict'

require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !supabaseKey) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env')
  process.exit(1)
}
const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

async function fetchLookup(table, nameCol) {
  const { data, error } = await sb.from(table).select(`id, ${nameCol}`)
  if (error) throw new Error(`Failed to fetch ${table}: ${error.message}`)
  return Object.fromEntries(data.map(r => [r[nameCol], r.id]))
}
function resolveId(map, name, context) {
  const id = map[name]
  if (!id) throw new Error(`Unknown ${context}: "${name}"`)
  return id
}

const expert = {
  full_name: 'Ibrahima Niane',
  first_name: 'Ibrahima',
  last_name: 'Niane',
  title: 'Project Officer, Agriculture, Rural Development and Biodiversity Projects',
  affiliation_type: 'partner',
  partner_org: 'Agence Française de Développement (AFD)',
  seniority_tier: 'principal_expert',
  years_experience: 25,
  email: 'nianei1967@gmail.com',
  phone: '+221 77 635 26 98',
  bio_summary: "Ibrahima Niane is a Senegalese agricultural engineer specializing in rural engineering, with over 25 years of experience in irrigation, integrated water resources management, and agricultural and rural project development across West Africa. He currently serves as Project Officer for Agriculture, Rural Development and Biodiversity Projects at the Agence Française de Développement (AFD) in Dakar, leading AFD-financed irrigation projects in Senegal (€119 million) and The Gambia (€7 million). He previously coordinated the $170 million Millennium Challenge Account (MCA-SN) Irrigation and Water Resources Management project at SAED, led the Rice Partnership Promotion Project in the Delta (3PRD) developing 2,500 hectares of irrigated land, and held senior irrigation and drainage infrastructure management roles at SAED over more than two decades. He holds a Master's in Rural Engineering from the University of Arizona and has taught management of irrigated areas and hydro-agricultural development at ENSA-Thies and Gaston Berger University.",
  sectors: {
    primary: 'Food security',
    secondary: ['WASH', 'Climate adaptation and resilience programming', 'Economic recovery and livelihoods'],
  },
  languages: [
    { name: 'French', proficiency: 'fluent' },
    { name: 'English', proficiency: 'professional' },
    { name: 'Wolof', proficiency: 'native' },
  ],
  geographies: ['Senegal', 'Gambia'],
  education_certifications: [
    { type: 'education', title: "Master's in National Security", institution: 'Center for Advanced Studies in Defense and Security (CHEDS), Dakar', year: 2021 },
    { type: 'education', title: "Master's in Rural Engineering", institution: 'University of Arizona, Tucson, USA', year: 2010 },
    { type: 'education', title: 'Postgraduate Diploma in Applied Computer Science for Water Sciences', institution: "Ecole Inter Etats de l'Equipement Rural (EIER), Ouagadougou, Burkina Faso", year: 2001 },
    { type: 'education', title: 'Diploma in Agricultural Engineering specializing in rural engineering', institution: "Ecole Nationale Superieure d'Agriculture (ENSA), Thies, Senegal", year: 1994 },
  ],
}

async function main() {
  const { data: existing, error: existingErr } = await sb
    .from('experts')
    .select('id')
    .eq('email', expert.email)
  if (existingErr) throw new Error(`Duplicate check failed: ${existingErr.message}`)
  if (existing.length) {
    console.error(`ABORT: an expert with email ${expert.email} already exists (id=${existing[0].id}).`)
    process.exit(1)
  }

  console.log('Loading lookup tables...')
  const [sectorMap, langMap, geoMap] = await Promise.all([
    fetchLookup('sectors', 'name'),
    fetchLookup('languages', 'name'),
    fetchLookup('geographies', 'country_name'),
  ])

  console.log('Inserting expert row...')
  const { data: row, error: expertErr } = await sb
    .from('experts')
    .insert({
      full_name: expert.full_name,
      first_name: expert.first_name,
      last_name: expert.last_name,
      title: expert.title,
      affiliation_type: expert.affiliation_type,
      partner_org: expert.partner_org,
      seniority_tier: expert.seniority_tier,
      years_experience: expert.years_experience,
      email: expert.email,
      phone: expert.phone,
      bio_summary: expert.bio_summary,
      is_active: true,
    })
    .select('id')
    .single()
  if (expertErr) throw new Error(`Insert expert failed: ${expertErr.message}`)
  const expertId = row.id
  console.log(`  -> expert id: ${expertId}`)

  const sectorRows = [
    { expert_id: expertId, sector_id: resolveId(sectorMap, expert.sectors.primary, 'sector'), priority: 'primary' },
    ...expert.sectors.secondary.map(name => ({ expert_id: expertId, sector_id: resolveId(sectorMap, name, 'sector'), priority: 'secondary' })),
  ]
  let { error } = await sb.from('expert_sectors').insert(sectorRows)
  if (error) throw new Error(`expert_sectors: ${error.message}`)
  console.log(`  -> inserted ${sectorRows.length} sector tags`)

  const langRows = expert.languages.map(l => ({ expert_id: expertId, language_id: resolveId(langMap, l.name, 'language'), proficiency: l.proficiency }))
  ;({ error } = await sb.from('expert_languages').insert(langRows))
  if (error) throw new Error(`expert_languages: ${error.message}`)
  console.log(`  -> inserted ${langRows.length} language tags`)

  const geoRows = expert.geographies.map(g => ({ expert_id: expertId, geography_id: resolveId(geoMap, g, 'geography') }))
  ;({ error } = await sb.from('expert_geographies').insert(geoRows))
  if (error) throw new Error(`expert_geographies: ${error.message}`)
  console.log(`  -> inserted ${geoRows.length} geography tags`)

  const eduRows = expert.education_certifications.map(e => ({ expert_id: expertId, type: e.type, title: e.title, institution: e.institution, year: e.year }))
  ;({ error } = await sb.from('education_certifications').insert(eduRows))
  if (error) throw new Error(`education_certifications: ${error.message}`)
  console.log(`  -> inserted ${eduRows.length} education rows`)

  console.log('\nDone. Ibrahima Niane added to the roster.')
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1) })
