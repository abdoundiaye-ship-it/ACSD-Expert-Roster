#!/usr/bin/env node
'use strict'
require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
async function main(){
  for (const t of ['expert_role_fit','expert_activity_experience','expert_donor_experience','expert_sectors']) {
    const { data, error } = await sb.from(t).select('*').limit(1)
    if (error) { console.log(t, 'ERROR', error.message); continue }
    console.log(t, '->', data && data.length ? Object.keys(data[0]).join(', ') : '(empty, columns unknown)')
  }
}
main().catch(e=>{console.error(e.message);process.exit(1)})
