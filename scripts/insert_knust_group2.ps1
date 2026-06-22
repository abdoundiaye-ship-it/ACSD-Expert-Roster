# Inserts 8 new KNUST-IRDIS "Group 2" experts and updates the existing
# Prof. Paul Sarfo-Mensah record with his refreshed 2026 CV.
# Generates SQL (saved to supabase/migrations/0005_knust_group2.sql for audit)
# and executes it via the Supabase Management API.

$ErrorActionPreference = 'Stop'

function Esc($s) {
  if ($null -eq $s) { return 'NULL' }
  $escaped = $s -replace "'", "''"
  return "'$escaped'"
}
function EscNum($n) {
  if ($null -eq $n) { return 'NULL' }
  return "$n"
}

$sectorIds = @{
  'Health'=1; 'Food security'=2; 'Nutrition'=3; 'Economic recovery and livelihoods'=4; 'Protection'=5;
  'Shelter and settlements'=6; 'WASH'=7; 'Education in emergencies'=8; 'Conflict sensitivity'=9;
  'Access and safety'=10; 'Migration and displacement'=11; 'Humanitarian disarmament'=12; 'Peacebuilding'=13;
  'Climate adaptation and resilience programming'=14; 'Area-based approaches'=15; 'Cash and voucher assistance'=16;
  'Accountability to affected populations'=17; 'Gender equality and social inclusion'=18; 'MEAL technical integration'=19;
  'Localisation approaches'=20; 'Core Humanitarian Standards'=21; 'Finance'=22; 'Human Resources'=23
}
$langIds = @{
  'French'=1; 'English'=2; 'Wolof'=3; 'Bambara'=4; 'Moore'=5; 'Fulfulde'=6; 'Dioula'=7; 'Hausa'=8;
  'Arabic'=9; 'Portuguese'=10; 'Lingala'=11; 'Sango'=12; 'Hassaniya'=13; 'Bwamou'=14; 'Marka'=15; 'Zarma'=16; 'Bissa'=17
}
$geoIds = @{
  'Senegal'=1; 'Mali'=2; 'Burkina Faso'=3; 'Niger'=4; 'Chad'=5; 'Mauritania'=6; 'Nigeria'=7; 'Cameroon'=8;
  "Cote d'Ivoire"=9; 'Togo'=10; 'Benin'=11; 'Ghana'=12; 'Guinea'=13; 'Guinea-Bissau'=14; 'Liberia'=15;
  'Sierra Leone'=16; 'Gambia'=17; 'Democratic Republic of the Congo'=18; 'Central African Republic'=19;
  'Republic of the Congo'=20; 'Gabon'=21
}

$experts = @(
  @{ id=[guid]::NewGuid(); full_name='Sampson E. Edusah'; first_name='Sampson'; last_name='Edusah'; title='Associate Professor of Development Studies'; partner_org='Institute for Rural Development and Innovation Studies (IRDIS), KNUST'; seniority_tier='principal_expert'; years_experience=40; email='s.edusah@gmail.com'; phone='+233 244224458'; bio_summary='Sampson E. Edusah is an Associate Professor of Development Studies at the Institute for Rural Development and Innovation Studies (IRDIS), KNUST, Ghana, holding a PhD in Development Studies from the University of Bradford. He has over three decades of experience in rural development, small-scale industries research, and natural resource management, including senior roles as Director of the Bureau of Integrated Rural Development (BIRD) and Project Coordinator for Integrated Natural Resource Management.'; notes=$null;
    sectors=@(@{n='Economic recovery and livelihoods';p='primary'},@{n='Climate adaptation and resilience programming';p='secondary'},@{n='Food security';p='secondary'});
    languages=@(@{n='English';p='fluent'});
    geos=@('Ghana');
    edu=@(@{t='PhD Development Studies';i='University of Bradford, UK';y=1999},@{t='Postgraduate Diploma, Professional Capacity Building for Research and Development (Value Chain)';i='ICRA, Wageningen, Netherlands';y=2005},@{t='MAEd / BA Industrial Art';i='University of Science and Technology, Kumasi';y=$null}) },

  @{ id=[guid]::NewGuid(); full_name='Bernice Wadei'; first_name='Bernice'; last_name='Wadei'; title='Research Fellow'; partner_org='Institute for Rural Development and Innovation Studies (IRDIS), KNUST'; seniority_tier='senior'; years_experience=13; email='bwadei@knust.edu.gh'; phone='+233 246808970'; bio_summary='Bernice Wadei, PhD, is a Research Fellow at the Institute for Rural Development and Innovation Studies (IRDIS), KNUST, Ghana, specializing in gender, livelihoods, and household wellbeing research. She holds a PhD in Geography and Rural Development from KNUST and has led and contributed to numerous gender-focused evaluations and research projects funded by organizations such as UN Women, UNFPA/UNICEF, GIZ, Catholic Relief Services, and the International Cocoa Initiative.'; notes=$null;
    sectors=@(@{n='Gender equality and social inclusion';p='primary'},@{n='Economic recovery and livelihoods';p='secondary'},@{n='Food security';p='secondary'},@{n='Nutrition';p='secondary'},@{n='Climate adaptation and resilience programming';p='secondary'},@{n='MEAL technical integration';p='secondary'});
    languages=@(@{n='English';p='fluent'});
    geos=@('Ghana',"Cote d'Ivoire",'Liberia','Nigeria');
    edu=@(@{t='PhD Geography and Rural Development';i='Kwame Nkrumah University of Science and Technology (KNUST)';y=2020},@{t='MSc Development Management';i='University of Agder, Norway';y=2013},@{t='BA (Hons) Geography and Rural Development, First Class';i='KNUST';y=2011}) },

  @{ id=[guid]::NewGuid(); full_name='Albert A. Arhin'; first_name='Albert'; last_name='Arhin'; title='Research Fellow'; partner_org='Bureau of Integrated Rural Development (BIRD) / IRDIS, KNUST'; seniority_tier='senior'; years_experience=14; email='aaarhin@knust.edu.gh'; phone='+233 322493501'; bio_summary='Albert A. Arhin, PhD, is a Research Fellow at the Bureau of Integrated Rural Development (BIRD), KNUST, Ghana, with a PhD in Geography from the University of Cambridge (Gates Cambridge Scholar). He has extensive experience as a principal consultant and evaluator on child labour, climate adaptation, gender-transformative programming, REDD+ governance, and cocoa supply chain projects for organizations including the International Cocoa Initiative, GIZ, USAID, FAO, and Fairtrade International.'; notes=$null;
    sectors=@(@{n='Climate adaptation and resilience programming';p='primary'},@{n='Economic recovery and livelihoods';p='secondary'},@{n='Gender equality and social inclusion';p='secondary'},@{n='MEAL technical integration';p='secondary'},@{n='Protection';p='secondary'});
    languages=@(@{n='English';p='fluent'});
    geos=@('Ghana',"Cote d'Ivoire");
    edu=@(@{t='PhD Geography';i='Emmanuel College, University of Cambridge, UK';y=2017},@{t='MSc Environment and Development';i='University of Leeds, UK';y=2010},@{t='BSc Planning, First Class Honours';i='KNUST';y=2008}) },

  @{ id=[guid]::NewGuid(); full_name='Dr. Isaac Bonuedi'; first_name='Isaac'; last_name='Bonuedi'; title='Research Fellow, IRDIS'; partner_org='Institute for Rural Development and Innovation Studies (IRDIS), KNUST'; seniority_tier='senior'; years_experience=16; email='isaac.bonuedi@knust.edu.gh'; phone='+233248799905'; bio_summary='Dr. Isaac Bonuedi is a Research Fellow at IRDIS, KNUST, holding a PhD in Agricultural Development Economics from the University of Bonn, Germany. He specializes in food security, nutrition-sensitive agriculture, market access, agricultural value chains, and socioeconomic impact evaluation, with extensive experience leading donor-funded baseline studies, endline evaluations, and impact assessments across Ghana, Liberia, and Côte d''Ivoire.'; notes=$null;
    sectors=@(@{n='Food security';p='primary'},@{n='Nutrition';p='secondary'},@{n='Economic recovery and livelihoods';p='secondary'},@{n='Climate adaptation and resilience programming';p='secondary'},@{n='Gender equality and social inclusion';p='secondary'},@{n='MEAL technical integration';p='secondary'},@{n='WASH';p='secondary'});
    languages=@(@{n='English';p='fluent'});
    geos=@('Ghana','Liberia',"Cote d'Ivoire");
    edu=@(@{t='Doctor of Agricultural Sciences (Agricultural Development Economics)';i='University of Bonn, Germany';y=2021},@{t='MSc Economics';i='University of Southern Denmark';y=2015},@{t='MPhil Economics';i='KNUST, Ghana';y=2013}) },

  @{ id=[guid]::NewGuid(); full_name='Dr. Monica Addison'; first_name='Monica'; last_name='Addison'; title='Senior Research Fellow / former Director, IRDIS, KNUST'; partner_org='Institute for Rural Development and Innovation Studies (IRDIS), KNUST'; seniority_tier='principal_expert'; years_experience=23; email='maddison.canr@knust.edu.gh'; phone='+23324879990'; bio_summary='Dr. (Mrs.) Monica Addison is a Senior Research Fellow and former Director of both BIRD and IRDIS at KNUST, holding a PhD in Agricultural Economics from KNUST. She is a gender and agricultural economics specialist with over two decades of research experience on gender, agricultural innovations, rice value chains, intra-household resource allocation, and rural livelihoods in Ghana.'; notes=$null;
    sectors=@(@{n='Gender equality and social inclusion';p='primary'},@{n='Food security';p='secondary'},@{n='Economic recovery and livelihoods';p='secondary'},@{n='Climate adaptation and resilience programming';p='secondary'},@{n='MEAL technical integration';p='secondary'});
    languages=@(@{n='English';p='fluent'});
    geos=@('Ghana');
    edu=@(@{t='PhD Agricultural Economics';i='Kwame Nkrumah University of Science and Technology, Ghana';y=2018},@{t='MSc Development Policy and Planning (Economic Development Option)';i='KNUST, Ghana';y=2003},@{t='BSc (Hons) Agriculture (Agricultural Econ. Option)';i='KNUST, Ghana';y=1997}) },

  @{ id=[guid]::NewGuid(); full_name='Dr. Ibrahim Latif Apaassongo'; first_name='Ibrahim Latif'; last_name='Apaassongo'; title='Research Fellow/Lecturer, IRDIS'; partner_org='Institute for Rural Development and Innovation Studies (IRDIS), KNUST'; seniority_tier='senior'; years_experience=14; email='latif.ibrahim@knust.edu.gh'; phone='+233(0)551992130'; bio_summary='Dr. Ibrahim Latif Apaassongo is an Agricultural Economist and Research Fellow/Lecturer at IRDIS, KNUST, holding a PhD in Agricultural Economics from the University of Tokyo, Japan. He specializes in food systems, agricultural value chains, local rice market development, quality governance, impact evaluation, and climate resilience, with technical roles on donor-funded research and evaluation assignments for IFAD, USAID/ACDI-VOCA, and IDRC in Ghana.'; notes=$null;
    sectors=@(@{n='Food security';p='primary'},@{n='Economic recovery and livelihoods';p='secondary'},@{n='Climate adaptation and resilience programming';p='secondary'},@{n='MEAL technical integration';p='secondary'},@{n='Education in emergencies';p='secondary'},@{n='Gender equality and social inclusion';p='secondary'});
    languages=@(@{n='English';p='fluent'},@{n='Hausa';p='working'},@{n='Arabic';p='working'});
    geos=@('Ghana');
    edu=@(@{t='PhD Agricultural Economics';i='The University of Tokyo, Japan';y=2022},@{t='MPhil Agricultural Economics';i='Kwame Nkrumah University of Science and Technology, Ghana';y=2013},@{t='BSc Agricultural Science';i='Kwame Nkrumah University of Science and Technology, Ghana';y=2009}) },

  @{ id=[guid]::NewGuid(); full_name='Prof. Ernestina Fredua Antoh'; first_name='Ernestina'; last_name='Fredua Antoh'; title='Associate Professor, Head, Social Change Development Unit, IRDIS'; partner_org='Institute for Rural Development and Innovation Studies (IRDIS), KNUST'; seniority_tier='principal_expert'; years_experience=38; email='ernestina19@yahoo.co.uk'; phone='+233 244619492'; bio_summary='Prof. Ernestina Fredua Antoh is an Associate Professor at the Institute for Rural Development and Innovation Studies (IRDIS), KNUST, Ghana, with over three decades of experience in rural sociology, gender, and microfinance research. She has directed IRDIS twice and led numerous evaluations and baseline studies for organizations including GIZ, Newmont, USAID-funded projects, and the International Cocoa Initiative.'; notes=$null;
    sectors=@(@{n='Gender equality and social inclusion';p='primary'},@{n='Economic recovery and livelihoods';p='secondary'},@{n='Food security';p='secondary'},@{n='Climate adaptation and resilience programming';p='secondary'},@{n='MEAL technical integration';p='secondary'});
    languages=@(@{n='English';p='fluent'});
    geos=@('Ghana');
    edu=@(@{t='PhD Development Studies';i='University of Cape Coast, Ghana';y=2014},@{t='MA Education Research';i='University of Sussex, UK';y=2010},@{t='MA Rural Social Development, Agricultural Extension and Rural Development';i='University of Reading, UK';y=1990}) },

  @{ id=[guid]::NewGuid(); full_name='Dr. Thomas Yeboah'; first_name='Thomas'; last_name='Yeboah'; title='Senior Research Fellow, IRDIS'; partner_org='Institute for Rural Development and Innovation Studies (IRDIS), KNUST'; seniority_tier='senior'; years_experience=12; email='thomas.yeboah@knust.edu.gh'; phone='+233 204730853'; bio_summary='Dr. Thomas Yeboah is a Senior Research Fellow at the Institute for Rural Development and Innovation Studies (IRDIS), KNUST, Ghana, specializing in youth employment, migration, and rural livelihoods in Africa. He holds a PhD in Development Studies from the University of Cambridge and has led and contributed to numerous evaluations and research projects funded by USAID, AfDB, GIZ, UNICEF, UNFPA, and other agencies.'; notes=$null;
    sectors=@(@{n='Migration and displacement';p='primary'},@{n='Economic recovery and livelihoods';p='secondary'},@{n='Gender equality and social inclusion';p='secondary'},@{n='Food security';p='secondary'},@{n='Climate adaptation and resilience programming';p='secondary'},@{n='MEAL technical integration';p='secondary'},@{n='Localisation approaches';p='secondary'});
    languages=@(@{n='English';p='fluent'});
    geos=@('Ghana',"Cote d'Ivoire",'Nigeria','Senegal','Liberia');
    edu=@(@{t='PhD Development Studies';i='Churchill College, University of Cambridge, UK';y=2018},@{t='MPhil Development Studies';i='Churchill College, University of Cambridge, UK';y=2013},@{t='BA (Hons) Geography and Rural Development, First Class Honours';i='Kwame Nkrumah University of Science and Technology (KNUST), Ghana';y=2011}) }
)

Write-Host "Loaded $($experts.Count) new expert records."

$sql = New-Object System.Text.StringBuilder
[void]$sql.AppendLine("-- KNUST-IRDIS Group 2: 8 new experts + update existing Prof. Paul Sarfo-Mensah")
[void]$sql.AppendLine("begin;")
[void]$sql.AppendLine()

$expertRows = @()
$sectorRows = @()
$langRows = @()
$geoRows = @()
$eduRows = @()

foreach ($e in $experts) {
  $expertRows += "($(Esc $e.id), $(Esc $e.full_name), $(Esc $e.first_name), $(Esc $e.last_name), $(Esc $e.title), 'partner', $(Esc $e.partner_org), $(Esc $e.seniority_tier), $(EscNum $e.years_experience), $(Esc $e.email), $(Esc $e.phone), $(Esc $e.bio_summary), $(Esc $e.notes), true)"

  foreach ($s in $e.sectors) {
    $sid = $sectorIds[$s.n]
    if (-not $sid) { Write-Warning "Unknown sector '$($s.n)' for $($e.full_name)"; continue }
    $sectorRows += "($(Esc $e.id), $sid, $(Esc $s.p))"
  }
  foreach ($l in $e.languages) {
    $lid = $langIds[$l.n]
    if (-not $lid) { Write-Warning "Unknown language '$($l.n)' for $($e.full_name)"; continue }
    $langRows += "($(Esc $e.id), $lid, $(Esc $l.p))"
  }
  foreach ($g in $e.geos) {
    $gid = $geoIds[$g]
    if (-not $gid) { Write-Warning "Unknown geography '$g' for $($e.full_name)"; continue }
    $geoRows += "($(Esc $e.id), $gid)"
  }
  foreach ($ed in $e.edu) {
    $eduRows += "(gen_random_uuid(), $(Esc $e.id), 'education', $(Esc $ed.t), $(Esc $ed.i), $(EscNum $ed.y))"
  }
}

[void]$sql.AppendLine("insert into experts (id, full_name, first_name, last_name, title, affiliation_type, partner_org, seniority_tier, years_experience, email, phone, bio_summary, notes, is_active) values")
[void]$sql.AppendLine(($expertRows -join ",`n") + ";")
[void]$sql.AppendLine()

[void]$sql.AppendLine("insert into expert_sectors (expert_id, sector_id, priority) values")
[void]$sql.AppendLine(($sectorRows -join ",`n") + ";")
[void]$sql.AppendLine()

[void]$sql.AppendLine("insert into expert_languages (expert_id, language_id, proficiency) values")
[void]$sql.AppendLine(($langRows -join ",`n") + ";")
[void]$sql.AppendLine()

[void]$sql.AppendLine("insert into expert_geographies (expert_id, geography_id) values")
[void]$sql.AppendLine(($geoRows -join ",`n") + ";")
[void]$sql.AppendLine()

[void]$sql.AppendLine("insert into education_certifications (id, expert_id, type, title, institution, year) values")
[void]$sql.AppendLine(($eduRows -join ",`n") + ";")
[void]$sql.AppendLine()

# --- Update existing Prof. Paul Sarfo-Mensah record ---
$paulId = 'bc0a0535-b718-4007-83c6-a8df54a3b524'
$paulTitle = "Associate Professor and Development Consultant, Institute for Rural Development and Innovation Studies (IRDIS) [formerly BIRD], KNUST"
$paulOrg = "Institute for Rural Development and Innovation Studies (IRDIS), KNUST"
$paulBio = "Professor Paul Sarfo-Mensah is an Associate Professor and Development Consultant at the Institute for Rural Development and Innovation Studies (IRDIS, formerly the Bureau of Integrated Rural Development), KNUST, Ghana, with 30 years of experience in socioeconomics, agriculture, natural resource management, and rural development. He has twice served as Director of BIRD and has led numerous evaluations and baseline studies for USAID, FAO, the World Bank, DANIDA, UNICEF/UNFPA, Newmont, and the International Cocoa Initiative across Ghana, Cote d'Ivoire, and Senegal."

[void]$sql.AppendLine("-- Update Prof. Paul Sarfo-Mensah with his refreshed 2026 CV")
[void]$sql.AppendLine("update experts set title=$(Esc $paulTitle), partner_org=$(Esc $paulOrg), years_experience=30, bio_summary=$(Esc $paulBio) where id='$paulId';")
[void]$sql.AppendLine("insert into expert_sectors (expert_id, sector_id, priority) values ('$paulId', $($sectorIds['Conflict sensitivity']), 'secondary') on conflict (expert_id, sector_id) do nothing;")
[void]$sql.AppendLine("insert into expert_geographies (expert_id, geography_id) values ('$paulId', $($geoIds['Senegal'])) on conflict (expert_id, geography_id) do nothing;")
[void]$sql.AppendLine()

[void]$sql.AppendLine("commit;")

$sqlText = $sql.ToString()
$migrationPath = "C:\Users\Abdou Ndiaye\OneDrive\Desktop\Business\Application\ACSD-Expert-Roster\supabase\migrations\0005_knust_group2.sql"
Set-Content -Path $migrationPath -Value $sqlText -Encoding utf8
Write-Host "SQL written to $migrationPath ($('{0:N0}' -f $sqlText.Length) chars)"

# Execute via Supabase Management API (UTF-8 bytes — Invoke-RestMethod mis-encodes plain strings)
$token = "sbp_95521edbdb51d4872b29bbd7b1fe93da80e10b73"
$headers = @{ Authorization = "Bearer $token" }
$bodyJson = @{ query = $sqlText } | ConvertTo-Json -Depth 5
$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyJson)
$resp = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/bazrdeykmntponplkncc/database/query" -Method Post -Headers $headers -Body $bodyBytes -ContentType "application/json; charset=utf-8"
Write-Host "Execution result:"
$resp | ConvertTo-Json -Depth 5
