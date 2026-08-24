#!/usr/bin/env node
/**
 * Imports 17 new experts from "ACS Pool Experts/CVs/Partners Consultants/Additional CVs"
 * into the ACSD Expert Roster, all categorized as Partner Consultants (affiliation_type='partner').
 * Two CVs from that folder (Ibrahima Niane, Beguerang Topeur) were already present in the
 * roster and are intentionally excluded here (Niane inserted in a prior run; Topeur's existing
 * record already has complete/accurate data matching this CV, so it is left untouched).
 *
 * Uses the service-role Supabase client (bypasses RLS), same approach as insert_ibrahima_niane.js.
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
function resolveId(map, name, context, warnings) {
  const id = map[name]
  if (!id) { warnings.push(`Unknown ${context}: "${name}"`); return null }
  return id
}

const experts = [
  {
    full_name: 'Belem Tinwinde Inoussa', first_name: 'Tinwinde Inoussa', last_name: 'Belem',
    title: 'Socio-économiste-gestionnaire de projets / Assistant Technique de Projet',
    partner_org: 'GAFREH', seniority_tier: 'intermediary', years_experience: 6,
    email: 'inoussategwendeb@gmail.com', phone: '+226 65 47 38 90 / 73 49 75 73',
    bio_summary: "Belem Tinwinde Inoussa is a Burkinabè socio-economist and project manager with over six years of experience in monitoring & evaluation, community mobilization, and humanitarian action in Burkina Faso. He currently serves as Technical Assistant at GAFREH and has coordinated M&E for an Amnesty International-funded project preventing female genital mutilation and child marriage, as well as a solar technician training and integration project for 300 youth and women in Loroum province.",
    sectors: { primary: 'MEAL technical integration', secondary: ['Gender equality and social inclusion', 'Protection', 'Accountability to affected populations'] },
    languages: [{ name: 'French', proficiency: 'fluent' }, { name: 'Moore', proficiency: 'native' }, { name: 'Dioula', proficiency: 'working' }],
    geographies: ['Burkina Faso'],
    education_certifications: [
      { type: 'education', title: 'Licence en économie', institution: 'Université Nazi Boni', year: 2019 },
      { type: 'education', title: 'Master I en gestion des projets (en cours)', institution: 'Institut Supérieur de la Technologie (IST)', year: null },
    ],
    notes: null,
  },
  {
    full_name: 'Drabo Bintou', first_name: 'Bintou', last_name: 'Drabo',
    title: 'Secrétaire exécutive', partner_org: 'Coordination des Volontaires de Dédougou (CVD)',
    seniority_tier: 'intermediary', years_experience: 5,
    email: 'bintoudrabo119@gmail.com', phone: '+226 65304050 / 72952305',
    bio_summary: 'Drabo Bintou is a Burkinabè project management professional with 5 years of experience in WASH, nutrition, and community-based women\'s economic empowerment programs in the Boucle du Mouhoun region. She currently serves as Executive Secretary of the Coordination des Volontaires de Dédougou (ECOSAN sanitation project) and previously supervised social-works monitoring for a water and sanitation program (PAEA/ACET-BTP.IC) and facilitated the SELEVER 2 nutrition and gender project with Association Chant de Femme and Tanager, including setting up 29 village savings and credit associations.',
    sectors: { primary: 'WASH', secondary: ['Nutrition', 'Gender equality and social inclusion', 'Economic recovery and livelihoods'] },
    languages: [{ name: 'French', proficiency: 'fluent' }, { name: 'English', proficiency: 'working' }, { name: 'Dioula', proficiency: 'working' }, { name: 'Moore', proficiency: 'working' }],
    geographies: ['Burkina Faso'],
    education_certifications: [
      { type: 'education', title: 'Master II en management de projet (en cours)', institution: 'Ecole supérieure du commerce', year: null },
      { type: 'education', title: 'Master I en gestion de projet', institution: 'Université Aube Nouvelle', year: 2021 },
      { type: 'education', title: 'Licence en sociologie, option dynamiques locales', institution: 'Université Joseph KI-ZERBO', year: 2019 },
      { type: 'certification', title: 'Project DPro / MEAL DPro', institution: 'Institut Africain de Formation et de Recherche Action Humanitaire et de Développement (I.A.F.R-A.H.D)', year: 2025 },
    ],
    notes: null,
  },
  {
    full_name: 'Drabo Jeannine', first_name: 'Jeannine Marie Patricia Lantolè', last_name: 'Drabo',
    title: 'Assistante en Suivi-Évaluation, Projet Inclusive Governance for Resilience (IGR)',
    partner_org: 'Creative Associates International (USAID)', seniority_tier: 'intermediary', years_experience: 6,
    email: 'jeanninedrabo1@gmail.com', phone: '+226 74 73 10 40 / 72 29 18 20',
    bio_summary: "Drabo Jeannine is a Burkinabè rural development engineer and M&E specialist with 6 years of experience in monitoring and evaluation, data collection, and governance research across the Hauts-Bassins and Cascades regions. She currently serves as M&E Assistant on the USAID-funded Inclusive Governance for Resilience (IGR) project implemented by Creative Associates International, and has prior experience as an organizational-capacity facilitator, data collection agent, and researcher on food security, malaria control, and non-communicable disease projects with PAM, CIRDES, and INERA.",
    sectors: { primary: 'MEAL technical integration', secondary: ['Food security', 'Climate adaptation and resilience programming', 'Health'] },
    languages: [{ name: 'French', proficiency: 'fluent' }, { name: 'English', proficiency: 'working' }, { name: 'Dioula', proficiency: 'working' }],
    geographies: ['Burkina Faso'],
    education_certifications: [
      { type: 'education', title: 'Master II en Gestion des projets (en cours)', institution: 'Université Aube Nouvelle de Bobo', year: null },
      { type: 'education', title: 'Master II de Gestion Intégrée des Ressources Naturelles, option Sociologie et Economie Rurales', institution: 'Université Nazi Boni', year: 2019 },
      { type: 'education', title: 'Ingénieure de Développement Rural, option Sociologie et Economie Rurales', institution: 'Université Nazi Boni', year: 2018 },
    ],
    notes: null,
  },
  {
    full_name: 'Kanzemo Marie-Michèle Sandrine Yi-Bula', first_name: 'Marie-Michèle Sandrine', last_name: 'Kanzemo Yi-Bula',
    title: 'Assistante Administrative et Financière', partner_org: null,
    seniority_tier: 'junior', years_experience: 1,
    email: 'sandrakanzemo@gmail.com', phone: '+226 70 94 64 67 / 77 65 38 50',
    bio_summary: 'Kanzemo Marie-Michèle Sandrine Yi-Bula is a Burkinabè administrative and financial professional holding a Licence in Economics, Business and Organizational Management from Université Saint Thomas d\'Aquin. Her experience consists of a series of internships in banking, insurance, telecoms, and corporate administration (BSIC, ONEA, SIMMOB, Orange Burkina, IAMGOLD Essakane, Bank of Africa) covering client relations, contract administration, and back-office operations.',
    sectors: { primary: 'Finance', secondary: [] },
    languages: [{ name: 'French', proficiency: 'fluent' }, { name: 'English', proficiency: 'working' }],
    geographies: ['Burkina Faso'],
    education_certifications: [
      { type: 'education', title: 'Licence en Économie, Gestion des Entreprises et des Organisations', institution: 'Université Saint Thomas d\'Aquin, Ouagadougou', year: 2018 },
      { type: 'certification', title: 'Formation Superviseur QHSE', institution: 'Centre de Formation Professionnelle Emeraude, Ouagadougou', year: 2024 },
    ],
    notes: "Sector mismatch — banking/administrative back-office profile built entirely on internships (2016-2025), no confirmed full-time professional role and no controlled sector matches closely; Finance chosen as closest fit. Also speaks Gourounsi (national language, not in the controlled languages list). Recommend manual review before deployment on ACSD assignments.",
  },
  {
    full_name: 'Kabore Karim', first_name: 'Karim', last_name: 'Kabore',
    title: 'Chef de projet (Développer la résilience et réduire la malnutrition au Burkina Faso)',
    partner_org: 'CIAUD-Canada / Programme Alimentaire Mondial (PAM)', seniority_tier: 'principal_expert', years_experience: 15,
    email: 'kaborime2003@gmail.com', phone: '+226 73774719 / 70220907 / 66303661',
    bio_summary: 'Karim Kabore is a Burkinabè expert in local governance, land tenure security, and rural development with over 15 years of experience in agriculture, farmer-organization support, and conflict prevention. He currently leads a resilience and malnutrition-reduction project for CIAUD-Canada/WFP, and previously served as Chef de service for land legislation at DGFOMR, Deputy Chief of Party on the USAID-funded ASTER land security project, and Regional Head of the land/rural-organization service for DRARAH-Centre-Nord, including implementation of the Neer-Tamba natural resource governance project.',
    sectors: { primary: 'Conflict sensitivity', secondary: ['Food security', 'Climate adaptation and resilience programming', 'Peacebuilding'] },
    languages: [{ name: 'French', proficiency: 'fluent' }, { name: 'English', proficiency: 'fluent' }, { name: 'Dioula', proficiency: 'fluent' }, { name: 'Moore', proficiency: 'working' }],
    geographies: ['Burkina Faso'],
    education_certifications: [
      { type: 'education', title: "Diplôme de Conseiller d'Agriculture (BAC+5)", institution: 'Ecole Nationale de Formation Agricole de Matourkou', year: 2017 },
      { type: 'education', title: 'Maîtrise en Géologie (BAC+4)', institution: 'Université Joseph-Ki ZERBO', year: 2013 },
      { type: 'education', title: 'Licence en Management des projets (BAC+3)', institution: 'Institut Africain de Professionnalisation en Management', year: 2011 },
      { type: 'education', title: 'Brevet de Technicien Supérieur en Pédologie (BAC+2)', institution: 'Ecole Nationale de Formation Agricole de Matourkou', year: 2005 },
    ],
    notes: 'Also reads/speaks Japanese (acceptable level, not in the controlled languages list).',
  },
  {
    full_name: 'Kabore Adama', first_name: 'Adama', last_name: 'Kabore',
    title: 'Consultant indépendant — Suivi de projets de développement rural et sécurisation foncière',
    partner_org: 'DAS-Consulting', seniority_tier: 'senior', years_experience: 25,
    email: 'adamabor@yahoo.fr', phone: '70 40 53 58 / 78 39 90 38',
    bio_summary: "Kabore Adama is a Burkinabè environmental engineer specializing in land tenure security and rural development, with 27 years of field experience since 1999. He currently provides independent monitoring support to development projects through DAS-Consulting, was Field Program Assistant on the USAID-funded Inclusive Governance for Resilience (IGR) project with Creative Associates International, and spent over seven years as Provincial Development Agent for the Chambre Régionale d'Agriculture du Centre-Nord on the Neer-Tamba natural resource governance project.",
    sectors: { primary: 'Conflict sensitivity', secondary: ['Food security', 'Climate adaptation and resilience programming', 'Gender equality and social inclusion'] },
    languages: [],
    geographies: ['Burkina Faso'],
    education_certifications: [
      { type: 'education', title: 'Licence Professionnelle, Génie de l\'Environnement, spécialité Sols, Déchets et Aménagement du Territoire (SDAT)', institution: null, year: null },
    ],
    notes: 'CV does not include a languages section; French professional fluency can be assumed from the CV\'s writing but was not independently confirmed, so no language rows were added.',
  },
  {
    full_name: 'Nignan Rachid Faïçal', first_name: 'Rachid Faïçal', last_name: 'Nignan',
    title: 'Gérant de Cabinet, Consultant Juridique & Fiscal',
    partner_org: 'Cabinet d\'Assistance Juridique Fiscale & Comptable NIGNAN (CAJFC NIGNAN)',
    seniority_tier: 'intermediary', years_experience: 7,
    email: 'a.rachid.faical@gmail.com', phone: '+226 77 29 25 10 / 70 84 02 50',
    bio_summary: 'Nignan Rachid Faïçal is a Burkinabè business-law and tax consultant, Gérant of his own legal/fiscal/accounting cabinet in Bobo-Dioulasso since 2022. Alongside his legal practice, he has field experience as a data collection agent and organizational capacity assessor (OCAT) for the USAID-funded Inclusive Governance for Resilience (IGR) project and for ACSD.',
    sectors: { primary: 'Finance', secondary: ['MEAL technical integration'] },
    languages: [{ name: 'French', proficiency: 'fluent' }, { name: 'Dioula', proficiency: 'working' }, { name: 'Moore', proficiency: 'working' }, { name: 'English', proficiency: 'working' }],
    geographies: ['Burkina Faso'],
    education_certifications: [
      { type: 'education', title: 'Master 1 Droit des Affaires & Fiscalité', institution: 'Université Aube Nouvelle', year: 2021 },
      { type: 'education', title: 'Licence Droit Privé - Droit des Affaires', institution: 'Université Nazi Boni', year: 2019 },
    ],
    notes: 'Sector mismatch — business/tax law and cabinet-management specialist; no controlled sector matches closely. Finance chosen as closest fit given his fiscal/accounting practice; his OCAT/IGR field experience is noted under MEAL technical integration. Recommend manual review.',
  },
  {
    full_name: 'Ouedraogo Salmata', first_name: 'Salmata', last_name: 'Ouedraogo',
    title: 'Spécialiste en Évaluation Environnementale & Sociale (EIES/NIES/PAR), Gérante de bureau',
    partner_org: 'ALTDev / SISDEV', seniority_tier: 'intermediary', years_experience: 4,
    email: 'salmatayembila@gmail.com', phone: '+226 65 34 22 80 / 07 47 00 47',
    bio_summary: 'Ouedraogo Salmata is a Burkinabè environmental and social safeguards specialist with 4 years of experience conducting Environmental and Social Impact Assessments (EIES), Impact Notices (NIES), and Resettlement Action Plans (PAR) to World Bank, AfDB, and BOAD standards. As office manager at ALTDev she has led 8+ major EIES/NIES/PAR missions across mining, telecom, energy, and urban-development projects in Burkina Faso, supervising multidisciplinary teams of 4-5 specialists.',
    sectors: { primary: 'Climate adaptation and resilience programming', secondary: ['WASH', 'Shelter and settlements', 'Gender equality and social inclusion'] },
    languages: [{ name: 'French', proficiency: 'fluent' }, { name: 'Moore', proficiency: 'fluent' }, { name: 'Dioula', proficiency: 'fluent' }],
    geographies: ['Burkina Faso'],
    education_certifications: [
      { type: 'education', title: 'Master professionnel — Management des Projets (en cours)', institution: 'ISPP – Institut Supérieur Privé Polytechnique', year: null },
      { type: 'education', title: 'Master de recherche — Management de l\'Environnement et du Développement Durable', institution: 'Université Aube Nouvelle', year: 2024 },
      { type: 'education', title: 'Licence — Mines et Carrières', institution: 'ESMi – École Supérieure de Microfinance', year: 2021 },
      { type: 'education', title: 'BTS — Géologie', institution: 'ESMi – École Supérieure de Microfinance', year: 2020 },
      { type: 'certification', title: 'Cadre Environnemental et Social de la Banque Mondiale (CES/ESF)', institution: 'World Bank Group', year: 2025 },
    ],
    notes: null,
  },
  {
    full_name: 'Ouedraogo Zainabou', first_name: 'Zainabou', last_name: 'Ouedraogo',
    title: 'Animatrice, chargée de communication', partner_org: 'Réseau d\'Appui des Mutuelles de Santé du Burkina Faso (RAMS/BF)',
    seniority_tier: 'intermediary', years_experience: 8,
    email: 'zeynab_oued@yahoo.fr', phone: '57 92 26 17 / 73 88 68 52',
    bio_summary: "Ouedraogo Zainabou is a Burkinabè communications and project-development professional with 8 years of experience in community mutual health insurance mobilization at the Réseau d'Appui des Mutuelles de Santé du Burkina Faso (RAMS/BF), and 3 years as an independent consultant supporting civil-society organizations in project design, business plans, and funding proposals for environment and livelihoods projects (FIE, Shared Interest Foundation, Programme Équité/AFD).",
    sectors: { primary: 'Health', secondary: ['MEAL technical integration', 'Economic recovery and livelihoods', 'Accountability to affected populations'] },
    languages: [{ name: 'French', proficiency: 'fluent' }, { name: 'English', proficiency: 'working' }, { name: 'Moore', proficiency: 'working' }, { name: 'Dioula', proficiency: 'working' }],
    geographies: ['Burkina Faso'],
    education_certifications: [
      { type: 'education', title: 'Master II en Gestion des Projets', institution: null, year: 2026 },
      { type: 'education', title: 'Licence en Communication Commerciale et Marketing', institution: 'Université Nazi Boni / IUT', year: 2016 },
      { type: 'education', title: 'DUT en communication d\'Entreprise', institution: 'Université Nazi Boni / IUT', year: 2015 },
      { type: 'certification', title: 'Certification en Action Humanitaire', institution: 'Institut National de Formation en Travail Social (INFTS)', year: 2025 },
      { type: 'certification', title: 'Formation certifiante en suivi-évaluation, redevabilité et apprentissage', institution: 'Cabinet Elite Afrique', year: 2022 },
    ],
    notes: 'Secondary email on file: ouzainakaya89@gmail.com.',
  },
  {
    full_name: 'Ouedraogo Issaka', first_name: 'Issaka', last_name: 'Ouedraogo',
    title: 'Animateur communautaire', partner_org: '4As/PDF', seniority_tier: 'senior', years_experience: 27,
    email: 'iouedraogo40@yahoo.fr', phone: '74-28-00-31 / 71-38-03-20 / 78-52-48-67',
    bio_summary: "Ouedraogo Issaka is a Burkinabè community mobilization specialist with 27 years of continuous field experience since 1999 in rural water/sanitation sensitization, HIMO labor-intensive works, and land-tenure rights education around Ouahigouya. He currently works as community facilitator on the Villes Secondaires project (4As/PDF), and has prior experience mobilizing communities for the MCA-Burkina Faso land security project, ACDIL's youth employment/hygiene program, and household latrine-adoption campaigns.",
    sectors: { primary: 'WASH', secondary: ['Conflict sensitivity', 'Food security', 'Gender equality and social inclusion'] },
    languages: [{ name: 'French', proficiency: 'fluent' }, { name: 'Moore', proficiency: 'fluent' }, { name: 'English', proficiency: 'working' }],
    geographies: ['Burkina Faso'],
    education_certifications: [
      { type: 'education', title: 'BEPC', institution: null, year: 1989 },
    ],
    notes: null,
  },
  {
    full_name: 'Sebgo Abdoulaye', first_name: 'Abdoulaye', last_name: 'Sebgo',
    title: 'Formateur SIG / Agent enquêteur', partner_org: 'Société d\'Ingénierie et Expertise pour le Développement (SIED Sarl)',
    seniority_tier: 'intermediary', years_experience: 5,
    email: 'sebgoabdoulaye1@gmail.com', phone: '(+226) 71 42 31 60 / 75 86 68 38',
    bio_summary: 'Sebgo Abdoulaye is a Burkinabè geographer and GIS specialist (Master II in Geography-Cartography-Geomatics/GIS, natural resource management option) with 5 years of experience in field data collection, GIS/mapping training, and monitoring surveys for organizations including SIED Sarl, AESCCC, and the Croix-Rouge Burkinabè. He has trained field teams and university students on QGIS, ArcGIS, and mobile data-collection tools, and facilitates community entrepreneurship and public-speaking programs for youth associations.',
    sectors: { primary: 'MEAL technical integration', secondary: ['Climate adaptation and resilience programming', 'Gender equality and social inclusion', 'Economic recovery and livelihoods'] },
    languages: [{ name: 'French', proficiency: 'fluent' }, { name: 'Moore', proficiency: 'fluent' }, { name: 'English', proficiency: 'fluent' }],
    geographies: ['Burkina Faso'],
    education_certifications: [
      { type: 'education', title: 'Master II (Bac+5), Dynamique-Espace et Société, Géographie-Cartographie-Géomatique-SIG, spécialité Gestion des Ressources Naturelles', institution: 'Université Joseph KI-ZERBO', year: 2021 },
      { type: 'education', title: 'Licence, Géographie', institution: 'Université de Koudougou (Université Norbert ZONGO)', year: 2016 },
    ],
    notes: null,
  },
  {
    full_name: 'Sebgo Sayouba', first_name: 'Sayouba', last_name: 'Sebgo',
    title: 'Enquêteur ONG locales — OCAT', partner_org: 'Bureau ACSD', seniority_tier: 'senior', years_experience: 15,
    email: 'sebgodebelloqo1986@gmail.com', phone: '+226 71 16 52 96 / 76 23 25 00',
    bio_summary: "Sebgo Sayouba is a Burkinabè agricultural economist (Master in Agroeconomics) specializing in food security, agroecology, and rice lowland (bas-fonds) development, with over 15 years of experience spanning the Ministry of Agriculture and international NGOs (NURU International, CIAUD Canada, AVAD). He supervised aménagement of rice lowlands and trained 110+ farmer cooperatives as Chef d'Unité d'Animation Technique at the Ministry of Agriculture, and most recently worked as an OCAT enquêteur for ACSD's local-NGO organizational capacity assessments (October 2024).",
    sectors: { primary: 'Food security', secondary: ['Climate adaptation and resilience programming', 'Economic recovery and livelihoods', 'MEAL technical integration'] },
    languages: [{ name: 'French', proficiency: 'fluent' }, { name: 'English', proficiency: 'working' }, { name: 'Moore', proficiency: 'fluent' }, { name: 'Fulfulde', proficiency: 'fluent' }, { name: 'Bissa', proficiency: 'working' }],
    geographies: ['Burkina Faso'],
    education_certifications: [
      { type: 'education', title: 'Master (BAC+5) en Agroéconomie', institution: 'Université Américaine des Sciences et du Développement International (UNASDI)', year: 2025 },
      { type: 'education', title: 'Diplôme de Technicien Agricole', institution: 'École Nationale de Formation Agricole (ENAFA), Matourkou', year: 2010 },
    ],
    notes: 'Has an existing working relationship with ACSD (Enquêteur des ONG locales — OCAT, Bureau ACSD, October 2024). Also speaks Koronfé/Foulsé (fluent, not in the controlled languages list).',
  },
  {
    full_name: 'Somda Callixte Nifera Magloire', first_name: 'Callixte Nifera Magloire', last_name: 'Somda',
    title: 'Spécialiste Senior MEAL', partner_org: 'Catholic Relief Services (CRS)', seniority_tier: 'principal_expert', years_experience: 15,
    email: 'nifera2006@gmail.com', phone: '64 24 88 43 / 63 99 37 70',
    bio_summary: "Somda Callixte Nifera Magloire is a Burkinabè sociologist-statistician and senior MEAL specialist with over 15 years of experience designing and managing monitoring & evaluation systems for multisectoral (health, SRH, education, protection, food security) projects funded by LuxDev and Global Affairs Canada. As MEAL lead at Catholic Relief Services he coordinated systems across three LuxDev-funded projects covering 10+ provinces, supervising up to 34 field staff; he previously spent 15 years as Chargé des Enquêtes for Burkina Faso's National Anti-Corruption Network, coordinating 15 national surveys and investigations.",
    sectors: { primary: 'MEAL technical integration', secondary: ['Health', 'Education in emergencies', 'Accountability to affected populations'] },
    languages: [{ name: 'French', proficiency: 'fluent' }, { name: 'Dioula', proficiency: 'fluent' }, { name: 'Moore', proficiency: 'working' }, { name: 'English', proficiency: 'working' }],
    geographies: ['Burkina Faso'],
    education_certifications: [
      { type: 'education', title: 'Master en Coopération internationale et aide humanitaire', institution: 'KALU Institute', year: 2020 },
      { type: 'education', title: 'Licence professionnelle en Statistiques sociales, option santé', institution: 'Université Joseph Ki-Zerbo', year: 2010 },
      { type: 'education', title: 'Licence Es. Lettres, option Sciences humaines/Sociologie', institution: 'Université Joseph Ki-Zerbo', year: 2003 },
      { type: 'certification', title: 'MEAL DPro', institution: null, year: null },
      { type: 'certification', title: 'Safeguarding', institution: null, year: null },
    ],
    notes: 'Also speaks Dagara (fluent, not in the controlled languages list).',
  },
  {
    full_name: 'Yougbare Wend-Yda Maimouna', first_name: 'Wend-Yda Maimouna', last_name: 'Yougbare',
    title: 'Économiste Agronome et Environnementaliste — Consultante indépendante', partner_org: 'Independent Consultant',
    seniority_tier: 'senior', years_experience: 15,
    email: 'maimounayougbare2@gmail.com', phone: '(+226) 70146638 / 75054990 / 79029101',
    bio_summary: "Yougbare Wend-Yda Maimouna is a Burkinabè agricultural economist and environmentalist with a Maîtrise in Agricultural Economics, Natural Resources and Environment, and 15 years of experience in pastoralism, resilience, and social cohesion programming in Burkina Faso's Eastern region. She coordinated the PROSOFIB-EST livestock value-chain project and led M&E for the Réseau de Communication sur le Pastoralisme (RECOPA-EST) across multiple pastoral security, peacebuilding, and youth-employment projects funded by USAID, the Swiss Cooperation, and Vétérinaires Sans Frontières, and now works as an independent consultant/trainer on governance, gender, and peacebuilding.",
    sectors: { primary: 'Economic recovery and livelihoods', secondary: ['Climate adaptation and resilience programming', 'Peacebuilding', 'Gender equality and social inclusion'] },
    languages: [{ name: 'French', proficiency: 'fluent' }, { name: 'Moore', proficiency: 'fluent' }, { name: 'Dioula', proficiency: 'working' }, { name: 'English', proficiency: 'working' }],
    geographies: ['Burkina Faso'],
    education_certifications: [
      { type: 'education', title: "Maîtrise en économie agricole, des ressources naturelles et de l'environnement", institution: 'Université Ouaga 2', year: 2011 },
      { type: 'education', title: "Licence en économie agricole, des ressources naturelles et de l'environnement", institution: 'Université Ouaga 2', year: 2010 },
    ],
    notes: 'Also speaks Gourmantché (working level, not in the controlled languages list).',
  },
  {
    full_name: 'Zoundi Boubacar', first_name: 'Boubacar', last_name: 'Zoundi',
    title: 'Expert Formation professionnelle / Chef de mission évaluation', partner_org: 'Independent Consultant',
    seniority_tier: 'principal_expert', years_experience: 20,
    email: null, phone: null,
    bio_summary: "Zoundi Boubacar is a Burkinabè education-policy specialist holding a PhD in Education Sciences (Politiques éducatives) from the Université de Koudougou plus two Master's degrees from the Université de Rouen, France. He has led or contributed to numerous programme evaluations and technical-vocational-education (EFTP) studies for ADA (Austrian Development Agency), GIZ, GOPA, UNESCO, and the World Bank across Burkina Faso and Cameroon, including as Project Manager for a multi-year Austrian-funded renewable-energy skills program and Chef de mission for the PARIIS irrigation programme final evaluation.",
    sectors: { primary: 'Education in emergencies', secondary: ['Economic recovery and livelihoods', 'MEAL technical integration', 'Climate adaptation and resilience programming'] },
    languages: [{ name: 'French', proficiency: 'fluent' }, { name: 'English', proficiency: 'working' }, { name: 'Moore', proficiency: 'fluent' }, { name: 'Dioula', proficiency: 'fluent' }],
    geographies: ['Burkina Faso', 'Cameroon'],
    education_certifications: [
      { type: 'education', title: "Doctorat en Sciences de l'éducation, spécialité Politiques éducatives", institution: 'Université de Koudougou', year: 2015 },
      { type: 'education', title: "Master II Recherche Sciences humaines et sociales, spécialité Sciences de l'éducation", institution: 'Université de Rouen, France', year: 2009 },
      { type: 'education', title: "Master II Professionnel, spécialité Sciences de l'éducation, option Métiers de la formation", institution: 'Université de Rouen, France', year: 2007 },
      { type: 'education', title: "Diplôme d'Ingénieur des travaux, spécialité Production animale", institution: "Université Nationale du Bénin, Ecole Polytechnique d'Abomey Calavi", year: 1989 },
    ],
    notes: 'No direct personal contact information (email/phone) was provided in this CV — only professional references. Recommend requesting direct contact details before engagement. Years of experience is estimated from documented assignment history; the CV does not state a total years figure explicitly.',
  },
  {
    full_name: 'Ouedraogo Razingrim Arthur Jean Emmanuel', first_name: 'Razingrim Arthur Jean Emmanuel', last_name: 'Ouedraogo',
    title: 'Head of West Africa Programme Implementation', partner_org: 'TREE AID', seniority_tier: 'principal_expert', years_experience: 15,
    email: 'rajeoued@yahoo.fr', phone: '+226 77028789',
    bio_summary: "Ouedraogo Razingrim Arthur Jean Emmanuel is a Burkinabè natural resource governance and drylands specialist with 15 years of experience across International NGOs (TREE AID, IUCN, ACORD, INADES-Formation) in West and East Africa. He currently leads TREE AID's West Africa Programme across five countries (Burkina Faso, Mali, Niger, Senegal, Ghana), and previously led IUCN's Global Drylands Initiative for West and Central Africa and coordinated the World Initiative for Sustainable Pastoralism (WISP) network from IUCN's Nairobi office, with multiple peer-reviewed publications on pastoralism, rangeland governance, and climate change adaptation.",
    sectors: { primary: 'Climate adaptation and resilience programming', secondary: ['Economic recovery and livelihoods', 'Migration and displacement', 'Peacebuilding'] },
    languages: [{ name: 'French', proficiency: 'fluent' }, { name: 'English', proficiency: 'fluent' }],
    geographies: ['Burkina Faso', 'Mali', 'Niger', 'Senegal', 'Ghana', 'Mauritania', 'Cameroon'],
    education_certifications: [
      { type: 'education', title: 'Master\'s degree in Ethics and Governance, specialization in Economic Ethics and Sustainable Development', institution: 'West African School for Moral and Political Sciences / CERAP, Abidjan, Ivory Coast', year: 2012 },
      { type: 'education', title: 'Bachelor in Philosophy', institution: 'Faculty of Philosophy Saint Peter Canisius of Kimwenza, Kinshasa, DR Congo', year: 2006 },
    ],
    notes: null,
  },
  {
    full_name: 'Ouedraogo Amidou', first_name: 'Amidou', last_name: 'Ouedraogo',
    title: 'Expert IT & Digital, CEO', partner_org: 'HORINFO', seniority_tier: 'principal_expert', years_experience: 25,
    email: 'amidou.ouedraogo@horinfo.com', phone: null,
    bio_summary: "Ouedraogo Amidou is a Burkinabè digital transformation expert and CEO of HORINFO, with 25 years of experience designing and deploying digital platforms, information systems, and Business Intelligence solutions for public administrations, international NGOs, and private companies across West and Central Africa. His recent work includes the Nexus Humanitarian-Development-Peace coordination platform for UNDP Chad, a citizen-engagement platform for USAID's Inclusive Governance for Resilience project, and public-finance and health-logistics Business Intelligence systems for Burkina Faso's Ministry of Economy and Ministry of Health.",
    sectors: { primary: 'MEAL technical integration', secondary: ['Finance', 'Health', 'Accountability to affected populations'] },
    languages: [{ name: 'French', proficiency: 'fluent' }, { name: 'English', proficiency: 'professional' }],
    geographies: ['Burkina Faso', "Cote d'Ivoire", 'Mali', 'Niger', 'Senegal', 'Chad', 'Togo'],
    education_certifications: [
      { type: 'education', title: 'DESS (Bac+5) en Informatique', institution: 'EIER / Fondation 2IE, Ouagadougou', year: 1995 },
      { type: 'education', title: 'Maîtrise en Sciences physiques', institution: 'Université de Ouagadougou (FAST)', year: 1994 },
      { type: 'certification', title: 'Stratégies de transformation numérique inclusive (ODD/Agenda 2063 UA)', institution: 'IDEP/CEA – FENU – PHB – UNCDF', year: 2021 },
    ],
    notes: 'Sector mismatch — IT/digital transformation and Business Intelligence specialist; no controlled sector matches closely. MEAL technical integration chosen as closest fit given extensive work on M&E/BI data systems for government and donor programs. Recommend manual review. No phone number was provided in the CV.',
  },
]

async function seedExpert(expert, maps, warnings) {
  const { sectorMap, langMap, geoMap } = maps

  const { data: row, error: expertErr } = await sb
    .from('experts')
    .insert({
      full_name: expert.full_name,
      first_name: expert.first_name,
      last_name: expert.last_name,
      title: expert.title,
      affiliation_type: 'partner',
      partner_org: expert.partner_org,
      seniority_tier: expert.seniority_tier,
      years_experience: expert.years_experience,
      email: expert.email,
      phone: expert.phone,
      bio_summary: expert.bio_summary,
      notes: expert.notes,
      is_active: true,
    })
    .select('id')
    .single()
  if (expertErr) throw new Error(`Insert expert failed: ${expertErr.message}`)
  const expertId = row.id

  const sectorRows = []
  if (expert.sectors?.primary) {
    const sid = resolveId(sectorMap, expert.sectors.primary, 'sector', warnings)
    if (sid) sectorRows.push({ expert_id: expertId, sector_id: sid, priority: 'primary' })
  }
  for (const name of (expert.sectors?.secondary ?? [])) {
    const sid = resolveId(sectorMap, name, 'sector', warnings)
    if (sid) sectorRows.push({ expert_id: expertId, sector_id: sid, priority: 'secondary' })
  }
  if (sectorRows.length) {
    const { error } = await sb.from('expert_sectors').insert(sectorRows)
    if (error) throw new Error(`expert_sectors: ${error.message}`)
  }

  const langRows = (expert.languages ?? []).map(l => {
    const lid = resolveId(langMap, l.name, 'language', warnings)
    return lid ? { expert_id: expertId, language_id: lid, proficiency: l.proficiency } : null
  }).filter(Boolean)
  if (langRows.length) {
    const { error } = await sb.from('expert_languages').insert(langRows)
    if (error) throw new Error(`expert_languages: ${error.message}`)
  }

  const geoRows = (expert.geographies ?? []).map(g => {
    const gid = resolveId(geoMap, g, 'geography', warnings)
    return gid ? { expert_id: expertId, geography_id: gid } : null
  }).filter(Boolean)
  if (geoRows.length) {
    const { error } = await sb.from('expert_geographies').insert(geoRows)
    if (error) throw new Error(`expert_geographies: ${error.message}`)
  }

  const eduRows = (expert.education_certifications ?? []).map(e => ({
    expert_id: expertId, type: e.type, title: e.title, institution: e.institution, year: e.year,
  }))
  if (eduRows.length) {
    const { error } = await sb.from('education_certifications').insert(eduRows)
    if (error) throw new Error(`education_certifications: ${error.message}`)
  }

  return expertId
}

async function main() {
  console.log('Loading lookup tables...')
  const [sectorMap, langMap, geoMap] = await Promise.all([
    fetchLookup('sectors', 'name'),
    fetchLookup('languages', 'name'),
    fetchLookup('geographies', 'country_name'),
  ])
  const maps = { sectorMap, langMap, geoMap }

  console.log('Fetching existing experts for duplicate check...')
  const { data: existing, error: existingErr } = await sb.from('experts').select('id, full_name, email')
  if (existingErr) throw new Error(`Failed to fetch existing experts: ${existingErr.message}`)
  const existingEmails = new Set(existing.filter(e => e.email).map(e => e.email.toLowerCase()))
  const existingNames = new Set(existing.map(e => e.full_name.toLowerCase()))

  let inserted = 0
  const skipped = []
  const allWarnings = []

  for (const expert of experts) {
    if (expert.email && existingEmails.has(expert.email.toLowerCase())) {
      console.log(`  SKIP (duplicate email): ${expert.full_name} <${expert.email}>`)
      skipped.push(expert.full_name)
      continue
    }
    if (existingNames.has(expert.full_name.toLowerCase())) {
      console.log(`  SKIP (duplicate name): ${expert.full_name}`)
      skipped.push(expert.full_name)
      continue
    }
    const warnings = []
    try {
      const id = await seedExpert(expert, maps, warnings)
      console.log(`  OK  ${expert.full_name} -> ${id}`)
      warnings.forEach(w => console.log(`      WARN: ${w}`))
      allWarnings.push(...warnings.map(w => `${expert.full_name}: ${w}`))
      inserted++
    } catch (err) {
      console.error(`  FAIL ${expert.full_name}: ${err.message}`)
    }
  }

  console.log('\n' + '-'.repeat(60))
  console.log(`Inserted: ${inserted} / ${experts.length}`)
  if (skipped.length) console.log(`Skipped (already present): ${skipped.join(', ')}`)
  if (allWarnings.length) {
    console.log(`\nLookup warnings (${allWarnings.length}):`)
    allWarnings.forEach(w => console.log(`  - ${w}`))
  }
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1) })
