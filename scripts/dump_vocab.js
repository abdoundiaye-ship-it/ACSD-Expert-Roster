#!/usr/bin/env node
'use strict'
require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs'); const path = require('path')
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true })
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
async function main(){
  const out = {}
  for (const [t, cols] of [['activity_types','id, name'],['work_order_roles','id, name, indicative_days'],['sectors','id, name, sort_order'],['donors','id, name, category_id'],['languages','id, name'],['geographies','id, country_name'],['seniority_tiers','code, sort_order, years_hint']]) {
    const { data, error } = await sb.from(t).select(cols)
    if (error) { console.error(t, error.message); continue }
    out[t] = data
    console.log(`\n=== ${t} (${data.length}) ===`)
    console.log(data.map(r => JSON.stringify(r)).join('\n'))
  }
  fs.writeFileSync(path.join(OUT,'vocab.json'), JSON.stringify(out, null, 2))
}
main().catch(e=>{console.error('FAILED',e.message);process.exit(1)})
