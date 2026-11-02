#!/usr/bin/env node
'use strict'
// Verification harness: replicates compute-matches scoring (the deterministic part, no LLM)
// against a real opportunity, to confirm the backfill changed rankings sensibly.
// Lists opportunities if no id given; scores all active experts if an opportunity id is passed.
require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const LANG_W = { native:1.0, fluent:1.0, professional:0.8, working:0.5 }
const round2 = n => Math.round(n*100)/100

async function main() {
  const oppId = process.argv[2]
  if (!oppId) {
    const { data } = await sb.from('opportunities').select('id, title, opportunity_type, status').order('created_at',{ascending:false}).limit(30)
    console.log('Opportunities (pass an id as argv to score it):')
    for (const o of data) {
      const { count: ns } = await sb.from('opportunity_sectors').select('*',{count:'exact',head:true}).eq('opportunity_id',o.id)
      const { count: npos } = await sb.from('opportunity_positions').select('*',{count:'exact',head:true}).eq('opportunity_id',o.id)
      console.log(`  ${o.id}  [${o.status}] sectors=${ns} positions=${npos}  ${o.title.slice(0,70)}`)
    }
    return
  }
  const { data: opp } = await sb.from('opportunities').select(`id,title,donor_id,
    opportunity_sectors(sector_id,importance),opportunity_languages(language_id),
    opportunity_geographies(geography_id),opportunity_activity_types(activity_type_id)`).eq('id',oppId).single()
  const { data: donorRows } = await sb.from('donors').select('id,category_id')
  const donorCat = Object.fromEntries(donorRows.map(d=>[d.id,d.category_id]))
  const oppDonorCat = opp.donor_id ? donorCat[opp.donor_id] : null
  const oppSectors = opp.opportunity_sectors||[]
  const oppLang = (opp.opportunity_languages||[]).map(r=>r.language_id)
  const oppGeo = (opp.opportunity_geographies||[]).map(r=>r.geography_id)
  const oppAct = (opp.opportunity_activity_types||[]).map(r=>r.activity_type_id)

  const { data: experts } = await sb.from('experts').select(`id,full_name,seniority_tier,years_experience,
    expert_sectors(sector_id,priority),expert_languages(language_id,proficiency),
    expert_geographies(geography_id),expert_donor_experience(donor_id),
    expert_activity_experience(activity_type_id)`).eq('is_active',true)

  const scored = experts.map(e=>{
    const egeo=new Set((e.expert_geographies||[]).map(g=>g.geography_id))
    const eact=new Set((e.expert_activity_experience||[]).map(a=>a.activity_type_id))
    const edon=new Set((e.expert_donor_experience||[]).map(d=>d.donor_id))
    let sector=30
    if(oppSectors.length){let ws=0,ms=0;for(const os of oppSectors){const w=os.importance==='required'?3:1;ws+=w;const es=(e.expert_sectors||[]).find(s=>s.sector_id===os.sector_id);const m=es?(es.priority==='primary'?1:0.6):0;ms+=w*m}sector=ws?ms/ws*30:30}
    let geo=15; if(oppGeo.length){geo=oppGeo.filter(g=>egeo.has(g)).length/oppGeo.length*15}
    let lang=15; if(oppLang.length){const s=oppLang.reduce((a,lid)=>{const el=(e.expert_languages||[]).find(l=>l.language_id===lid);return a+(el?(LANG_W[el.proficiency]||0.5):0)},0);lang=s/oppLang.length*15}
    let donor=15; if(opp.donor_id){if(edon.has(opp.donor_id))donor=15;else{const sc=[...edon].some(d=>donorCat[d]===oppDonorCat);donor=sc?6:0}}
    let act=10; if(oppAct.length){act=oppAct.filter(a=>eact.has(a)).length/oppAct.length*10}
    const scale=100/85
    const total=(sector+geo+lang+donor+act)*scale
    return {name:e.full_name,tier:e.seniority_tier,score:round2(Math.min(100,total)),
      b:{sector:round2(sector*scale),geo:round2(geo*scale),lang:round2(lang*scale),donor:round2(donor*scale),act:round2(act*scale)}}
  })
  scored.sort((a,b)=>b.score-a.score)
  console.log(`\nOpportunity: ${opp.title}`)
  console.log(`Requirements: sectors=${oppSectors.length} langs=${oppLang.length} geos=${oppGeo.length} activities=${oppAct.length} donor=${opp.donor_id||'none'}`)
  console.log(`Scored ${scored.length} active experts. Top 15 (no-position, general fit):\n`)
  scored.slice(0,15).forEach((s,i)=>console.log(`${String(i+1).padStart(2)}. ${s.score.toFixed(1).padStart(5)}  ${s.name.slice(0,34).padEnd(34)} [${s.tier||'n/a'}]  sect${s.b.sector} geo${s.b.geo} lang${s.b.lang} don${s.b.donor} act${s.b.act}`))
  const withAct = scored.filter(s=>s.b.act>0).length
  console.log(`\nExperts now scoring >0 on the activity dimension: ${withAct}/${scored.length} (was near-zero before backfill)`)
}
main().catch(e=>{console.error('FAILED',e.message);process.exit(1)})
