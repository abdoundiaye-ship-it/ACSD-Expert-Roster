# Inserts the 27 "CVs to add" partner consultants into the ACSD Expert Roster database.
# Generates one big SQL script (saved to supabase/migrations/0004_acs_pool_experts_batch1.sql for audit)
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
  @{ id=[guid]::NewGuid(); full_name='Dr. Aminata Niane Badiane'; first_name='Aminata'; last_name='Niane Badiane'; title='Technical Director, African Resources Group (ARG)'; partner_org='African Resources Group (ARG)'; seniority_tier='principal_expert'; years_experience=45; email='anbadiane@gmail.com'; phone='+221 77 630 15 27'; bio_summary='Dr. Aminata Niane Badiane is a senior agricultural and natural resources management expert with over 40 years of professional experience, including 23 years with USAID/Senegal as Deputy Director of the Economic Growth Office and Agricultural/NRM Specialist. She has extensive experience in food security, agricultural research, environmental policy, and program management, and currently serves as Technical Director of ARG, leading consulting assignments for USAID, the World Bank, and other donors across West Africa.'; notes=$null;
    sectors=@(@{n='Food security';p='primary'},@{n='Economic recovery and livelihoods';p='secondary'},@{n='Climate adaptation and resilience programming';p='secondary'});
    languages=@(@{n='French';p='fluent'},@{n='English';p='fluent'});
    geos=@('Senegal','Mali','Guinea','Ghana','Guinea-Bissau');
    edu=@(@{t='PhD, Soil Science';i='Institut Polytechnique Lorraine (ENSAIA), Nancy, France';y=1993},@{t='M.S., Soil Science';i='North Carolina State University, USA';y=1983},@{t='Agronomy Engineer, Plant Science';i='Institut National Agronomique, Alger';y=1979}) },

  @{ id=[guid]::NewGuid(); full_name='Samba Barry'; first_name='Samba'; last_name='Barry'; title='International Consultant (Democracy, Human Rights, Governance and Peace Specialist)'; partner_org='Independent International Consultant / OFNAC'; seniority_tier='principal_expert'; years_experience=33; email='baccbarry@gmail.com'; phone='+221 77 706 52 00'; bio_summary='Samba Barry is a governance and peacebuilding expert with more than 30 years of experience designing and managing policies and programs in democracy, human rights, conflict resolution, and socioeconomic development. He held senior roles at USAID/Senegal (Deputy Director, DRGP Office), OHCHR West Africa, Oxfam GB (Country Director, Senegal), and currently serves as an independent international consultant and OFNAC board member.'; notes=$null;
    sectors=@(@{n='Protection';p='primary'},@{n='Peacebuilding';p='secondary'},@{n='Conflict sensitivity';p='secondary'},@{n='Economic recovery and livelihoods';p='secondary'},@{n='Cash and voucher assistance';p='secondary'},@{n='Core Humanitarian Standards';p='secondary'});
    languages=@(@{n='French';p='native'},@{n='English';p='fluent'},@{n='Wolof';p='professional'},@{n='Fulfulde';p='professional'});
    geos=@('Senegal','Mali','Guinea','Ghana','Guinea-Bissau','Gambia','Togo');
    edu=@(@{t='Diploma of Advanced Studies in Law (DEA)';i='Cheikh Anta Diop University, Dakar';y=1992},@{t='Master (Maitrise) in Law';i='Cheikh Anta Diop University, Dakar';y=1991},@{t="Bachelor's degree in Law";i='Cheikh Anta Diop University, Dakar';y=1990}) },

  @{ id=[guid]::NewGuid(); full_name='Cécile Ngalounou Toche'; first_name='Cécile'; last_name='Ngalounou Toche'; title='Statistician – M&E Specialist'; partner_org='CORAF Executive Office / ARG'; seniority_tier='intermediary'; years_experience=4; email='ceciletoche7@gmail.com'; phone='+221 77 30 26 196'; bio_summary='Cécile Ngalounou Toche is a statistical economist specializing in monitoring, evaluation, research, and learning (MERL), with expertise in survey design, sampling, statistical analysis, and impact evaluation of public policies. She has worked across multiple consulting assignments in Senegal and the broader West Africa region for CORAF, ARG, IP3-Conseil, AGRA, and FS4Africa.'; notes=$null;
    sectors=@(@{n='MEAL technical integration';p='primary'},@{n='Food security';p='secondary'},@{n='Economic recovery and livelihoods';p='secondary'},@{n='Nutrition';p='secondary'});
    languages=@(@{n='French';p='native'},@{n='English';p='working'});
    geos=@('Senegal','Cameroon','Burkina Faso','Nigeria','Togo','Guinea');
    edu=@(@{t='Diploma of Statistical Economist Engineer (ISE)';i='ENSAE Dakar';y=2022},@{t="Master's in Mathematical Economics";i='University of Yaoundé II';y=2018},@{t="Master's in Economic and Financial Engineering (IEF)";i='University of Yaoundé II';y=2017}) },

  @{ id=[guid]::NewGuid(); full_name='Dr. Abdrahmane Diallo'; first_name='Abdrahmane'; last_name='Diallo'; title='Gender and Social Inclusion (GESI) and Senior Program Management Expert'; partner_org='ARG'; seniority_tier='principal_expert'; years_experience=35; email='abdrhdiallo@outlook.com'; phone='+221 77 654 22 83'; bio_summary='Dr. Abdrahmane Diallo is a gender and social inclusion expert with over 30 years of experience in strategic planning, project evaluation, public policy analysis, and gender mainstreaming. He spent 23 years at USAID/Senegal, including as Deputy Director of the Program Office, and has since worked as an independent consultant on gender, social inclusion, and cross-border security/community engagement projects.'; notes=$null;
    sectors=@(@{n='Gender equality and social inclusion';p='primary'},@{n='Protection';p='secondary'},@{n='Migration and displacement';p='secondary'},@{n='Conflict sensitivity';p='secondary'},@{n='Access and safety';p='secondary'},@{n='Accountability to affected populations';p='secondary'});
    languages=@(@{n='French';p='fluent'},@{n='English';p='fluent'},@{n='Wolof';p='fluent'},@{n='Bambara';p='fluent'},@{n='Fulfulde';p='working'});
    geos=@('Senegal','Guinea','Mauritania','Republic of the Congo',"Cote d'Ivoire");
    edu=@(@{t='Doctorate (Doctorat de 3e cycle), Environmental/Social Sciences';i='Cheikh Anta Diop University, Dakar';y=$null},@{t='DEA, Social Anthropology';i='Cheikh Anta Diop University, Dakar';y=$null},@{t='Master (Maitrise), Philosophy';i='Cheikh Anta Diop University, Dakar';y=$null}) },

  @{ id=[guid]::NewGuid(); full_name='Dr. Moussa Diakhaté'; first_name='Moussa'; last_name='Diakhaté'; title='Senior Health Information System Advisor'; partner_org='Chemonics International (USAID)'; seniority_tier='principal_expert'; years_experience=39; email='mkelekey@yahoo.fr'; phone='+221 77 6565672'; bio_summary='Dr. Moussa Diakhaté is a physician and public health information systems expert with nearly 40 years of experience, including as Head of Senegal''s National Health Information Service and senior advisor roles with USAID-funded health projects. He has extensive expertise in health information system design, M&E, demographic and health surveys, and health workforce data systems.'; notes=$null;
    sectors=@(@{n='Health';p='primary'},@{n='MEAL technical integration';p='secondary'},@{n='Nutrition';p='secondary'});
    languages=@(@{n='French';p='fluent'},@{n='English';p='working'},@{n='Wolof';p='fluent'},@{n='Bambara';p='working'});
    geos=@('Senegal');
    edu=@(@{t='Master of Science in International Development';i='Tulane University, USA';y=2004},@{t='Certificate of Special Studies in Public Health';i='Cheikh Anta Diop University, Senegal';y=1992},@{t='Doctorate in Medicine';i='Cheikh Anta Diop University';y=1986}) },

  @{ id=[guid]::NewGuid(); full_name='Maria-Teresa Roberto'; first_name='Maria-Teresa'; last_name='Roberto'; title='International Consultant, Acquisition & Assistance'; partner_org='Jefferson Consulting Group (JCG)'; seniority_tier='principal_expert'; years_experience=40; email='maiteroberto@gmail.com'; phone='+221 77 634 37 12'; bio_summary='Maria-Teresa "Maité" Roberto is a senior Acquisition, Assistance and Procurement professional with over 20 years of experience supporting complex USAID-funded programs, contract administration, and regulatory compliance. She has provided remote acquisition and assistance consulting to USAID missions in Senegal, Nepal, Pakistan, and Zambia, and holds FAC-C Professional Certification.'; notes='Sector mismatch — specializes in USAID acquisition & procurement; no controlled sector closely matches her specialization. Finance/Core Humanitarian Standards chosen as closest fit. Recommend manual review.';
    sectors=@(@{n='Finance';p='primary'},@{n='Core Humanitarian Standards';p='secondary'});
    languages=@(@{n='English';p='fluent'},@{n='French';p='fluent'},@{n='Portuguese';p='fluent'},@{n='Wolof';p='fluent'});
    geos=@('Senegal','Mauritania','Guinea-Bissau');
    edu=@(@{t='Master of Science, Maîtrise de la Gestion des Organisations';i='Université du Québec à Chicoutimi';y=2020},@{t='MBA (HR focus)';i='Institut Africain de Management';y=2015},@{t='BBA (HR focus)';i='Institut Africain de Management';y=2013}) },

  @{ id=[guid]::NewGuid(); full_name='Honorat Sognon'; first_name='Honorat'; last_name='Sognon'; title='Coach en mobilisation des ressources / Senior International Trainer'; partner_org='Project HOPE'; seniority_tier='principal_expert'; years_experience=26; email='honoratsognon@gmail.com'; phone='+226 63 06 82 82'; bio_summary='Honorat Sognon is a humanitarian operations and capacity-building expert with over 20 years of experience in project coordination, finance, HR, logistics, and security management, and over 10 years as a senior international trainer and coach. He has held senior support and country-director-level roles with Action Contre la Faim, Croix-Rouge Française, Institut Bioforce, and INSO.'; notes=$null;
    sectors=@(@{n='Localisation approaches';p='primary'},@{n='Humanitarian disarmament';p='secondary'},@{n='Access and safety';p='secondary'},@{n='Finance';p='secondary'},@{n='Human Resources';p='secondary'},@{n='Core Humanitarian Standards';p='secondary'});
    languages=@(@{n='French';p='native'},@{n='English';p='working'});
    geos=@('Burkina Faso',"Cote d'Ivoire",'Cameroon','Chad');
    edu=@(@{t='Doctorat en Administration des Affaires (DBA, in progress)';i='Centre de Valorisation Professionnelle, Tunis';y=$null},@{t='Administrateur de la Solidarité Internationale (Bac+4)';i='Institut Bioforce Développement, Lyon, France';y=2015},@{t='Brevet de Technicien Supérieur, Finance et Comptabilité';i='Institut Supérieur de Gestion Appliquée, Abidjan';y=1999}) },

  @{ id=[guid]::NewGuid(); full_name='Abasse Ouedraogo'; first_name='Abasse'; last_name='Ouedraogo'; title='Charge Programme Terrain'; partner_org='Creative Associates International'; seniority_tier='intermediary'; years_experience=6; email='abassedinho@gmail.com'; phone='(00226)70017896'; bio_summary='Abasse Ouedraogo is a specialist in food security, nutrition, rural development and local governance with roughly six years of experience supporting USAID- and Swiss Cooperation-funded programs in Burkina Faso. He has worked on inclusive governance, grants management, agricultural value chains, and resilience programming.'; notes=$null;
    sectors=@(@{n='Food security';p='primary'},@{n='Nutrition';p='secondary'},@{n='Economic recovery and livelihoods';p='secondary'},@{n='Cash and voucher assistance';p='secondary'},@{n='MEAL technical integration';p='secondary'},@{n='Accountability to affected populations';p='secondary'});
    languages=@(@{n='French';p='fluent'},@{n='English';p='working'},@{n='Moore';p='native'},@{n='Dioula';p='native'});
    geos=@('Burkina Faso');
    edu=@(@{t="Master, Securite alimentaire et nutritionnelle en situation d'urgence";i='Institut Superieur de Securite Humaine, Ouagadougou';y=2025},@{t='Licence, Economie et science de gestion';i='Universite Norbert ZONGO, Koudougou';y=2014},@{t='Baccalaureat option comptabilite';i="College d'enseignement commercial, Ouagadougou";y=2011}) },

  @{ id=[guid]::NewGuid(); full_name='Dr. Nanema Mathieu'; first_name='Mathieu'; last_name='Nanema'; title='Senior Exploration Geologist / Executive Director'; partner_org='Eburnean Discovery'; seniority_tier='principal_expert'; years_experience=20; email='nanemageologue@gmail.com'; phone='+22676207639'; bio_summary='Dr. Nanema Mathieu is a world-class senior exploration geologist with over 20 years of experience in the extractive industry, having contributed to the discovery of major gold deposits including Kiaka (Burkina Faso), Massawa (Senegal), and Kibali (DRC). He spent 18+ years as Principal Exploration Geologist at Barrick Gold Corporation, and currently serves as Executive Director of Eburnean Discovery.'; notes='Sector mismatch — mining/exploration geology specialist; no controlled sector matches closely. "Economic recovery and livelihoods" chosen as weak fallback. Recommend manual review.';
    sectors=@(@{n='Economic recovery and livelihoods';p='primary'});
    languages=@(@{n='French';p='fluent'},@{n='English';p='fluent'});
    geos=@('Burkina Faso',"Cote d'Ivoire",'Democratic Republic of the Congo');
    edu=@(@{t='Doctorat en geologie appliquee (gitologie, petrographie, geochimie)';i='Universite Joseph Ki-Zerbo, Burkina Faso';y=2021},@{t='Master of Science (DEA-S) en geologie miniere';i='Universite Joseph Ki-Zerbo';y=2011},@{t='Master professionnel en gestion de projets';i='ISIM Bamako, Mali';y=2012}) },

  @{ id=[guid]::NewGuid(); full_name='Bè Bonkian'; first_name='Bè'; last_name='Bonkian'; title='Expert SIG (GIS/Remote Sensing Specialist)'; partner_org='Bureau Espace Geomatique Sarl'; seniority_tier='senior'; years_experience=17; email='be.bonkian@2ie-edu.org'; phone='+226 70 73 63 96'; bio_summary='Be Bonkian is a GIS, cartography and remote sensing expert (Expert SIG) with extensive consulting experience across Burkina Faso since the mid-2000s. He has supported numerous donor-funded projects (World Bank, PNUD, USAID/NCBA CLUSA, FIDA, GIZ, Luxembourg Cooperation) in land-use mapping, resettlement action plans, and environmental and social impact studies.'; notes=$null;
    sectors=@(@{n='Climate adaptation and resilience programming';p='primary'},@{n='Shelter and settlements';p='secondary'},@{n='MEAL technical integration';p='secondary'});
    languages=@(@{n='French';p='fluent'},@{n='English';p='professional'},@{n='Bwamou';p='working'},@{n='Moore';p='working'});
    geos=@('Burkina Faso');
    edu=@(@{t='Licence professionnelle en statistique sociale';i='Institut Superieur des Sciences de la Population (ISSP)';y=2013},@{t='DESS Production et Gestion de l''Information Geographique (SIG)';i='RECTAS/ITC Twente';y=2005},@{t='Maitrise Physique option Gestion de l''energie';i='Universite de Ouagadougou';y=2001}) },

  @{ id=[guid]::NewGuid(); full_name='Doufene Pagueure Raoul'; first_name='Raoul'; last_name='Doufene Pagueure'; title='Expert-Comptable Judiciaire'; partner_org='Independent (Expert-comptable Judiciaire)'; seniority_tier='intermediary'; years_experience=9; email='doufeneraoul2@gmail.com'; phone='+235 66-23-55-27'; bio_summary='Doufene Pagueure Raoul is a Chadian judicial chartered accountant (Expert-comptable Judiciaire) accredited since 2017, with prior experience in procurement, logistics, and financial management roles. He has expertise in purchasing procedures, insurance, invoice control, financial analysis, and organizational management.'; notes=$null;
    sectors=@(@{n='Finance';p='primary'});
    languages=@(@{n='French';p='fluent'},@{n='English';p='working'},@{n='Arabic';p='working'});
    geos=@('Chad');
    edu=@(@{t='Maitrise en Technique quantitative de gestion (TQG)';i='Institut Superieur des Sciences de l''Education (ISSED)';y=2011},@{t='Licence en science de gestion';i="Universite de N'djamena, Tchad";y=2001},@{t='Agrement judiciaire en expertise comptable';i=$null;y=2017}) },

  @{ id=[guid]::NewGuid(); full_name='Kuilga Emmanuel Yameogo'; first_name='Emmanuel'; last_name='Yameogo'; title='Consultant Expert Minier / Directeur General de Bouroum SA'; partner_org='Bouroum SA / Skygold Resources'; seniority_tier='principal_expert'; years_experience=31; email='yamemma@gmail.com'; phone='(226)76 47 45 33'; bio_summary='Kuilga Emmanuel Yameogo is a mining engineer and surveyor with over 30 years of experience in Burkina Faso''s mining sector, having served as Director of Mines (2011-2018), Permanent Secretary of the National Mining Commission (2018-2023), and Technical Advisor to the Minister of Energy, Mines and Quarries. He currently works as an independent mining expert consultant.'; notes='Sector mismatch — mining engineering/surveying specialist; no controlled sector matches closely. Recommend manual review.';
    sectors=@(@{n='Economic recovery and livelihoods';p='primary'});
    languages=@(@{n='French';p='fluent'},@{n='English';p='working'});
    geos=@('Burkina Faso');
    edu=@(@{t='Diplome d''Ingenieur expert (Techniques, Economie et Gestion de l''entreprise miniere)';i='Ecole des Mines de Nancy, France';y=2002},@{t='DESS Valorisation des ressources du sous-sol';i='Ecole nationale Superieure de Geologie de Nancy, France';y=2002},@{t='Diplome d''Ingenieur Arpenteur des mines';i='Institut des Mines de Moscou, Russie';y=1994}) },

  @{ id=[guid]::NewGuid(); full_name='Allayam Ndikinan'; first_name='Allayam'; last_name='Ndikinan'; title='Responsable Programmes/Projet & MEAL Manager'; partner_org='Tearfund'; seniority_tier='senior'; years_experience=17; email='pallayam@gmail.com'; phone='+235 66 30 46 85'; bio_summary='Allayam Ndikinan is a programs and MEAL manager with over a decade of experience in adaptive social protection and food security across humanitarian and development contexts in Chad and the Central African Republic. He has managed multi-donor portfolios (UNICEF, USAID, Tearfund, FHI 360) covering cash and voucher assistance, accountability mechanisms (CHS/CEA/GRM), and monitoring and evaluation.'; notes=$null;
    sectors=@(@{n='Economic recovery and livelihoods';p='primary'},@{n='Cash and voucher assistance';p='secondary'},@{n='Accountability to affected populations';p='secondary'},@{n='MEAL technical integration';p='secondary'},@{n='Protection';p='secondary'},@{n='Core Humanitarian Standards';p='secondary'},@{n='Food security';p='secondary'});
    languages=@(@{n='French';p='fluent'},@{n='English';p='professional'});
    geos=@('Chad','Central African Republic');
    edu=@(@{t='Master, Anthropologie du developpement (methodes qualitatives et quantitatives)';i='Universite de Lome, Togo';y=2015}) },

  @{ id=[guid]::NewGuid(); full_name='Diabate Adama'; first_name='Adama'; last_name='Diabate'; title='Directeur du Controle des Marches publics et des Engagements Financiers'; partner_org='Institut National de Sante Publique (INSP)'; seniority_tier='senior'; years_experience=16; email='a.diabate51@gmail.com'; phone='76510607'; bio_summary='Diabate Adama is a Burkinabe public finance administrator currently serving as Director of Public Procurement and Financial Commitments Control at the Institut National de Sante Publique (INSP) since May 2024, having held the equivalent position at IRSAT from 2019-2024. He specializes in public procurement control, budget engagement verification, and financial audits.'; notes=$null;
    sectors=@(@{n='Finance';p='primary'});
    languages=@(@{n='French';p='fluent'},@{n='English';p='working'},@{n='Dioula';p='fluent'});
    geos=@('Burkina Faso');
    edu=@(@{t='DEA en Finances Publiques';i='Ecole Nationale des Regies Financieres';y=2010},@{t='Maitrise en Droit (Droit des Affaires)';i='Universite de Ouagadougou';y=2006},@{t='Licence en Droit (Droit des Affaires)';i='Universite de Ouagadougou';y=2005}) },

  @{ id=[guid]::NewGuid(); full_name='Savadogo Gouwendé Moussa'; first_name='Moussa'; last_name='Savadogo Gouwendé'; title="Juriste d'affaires / Médiateur professionnel certifié"; partner_org="Centre d'Arbitrage, de Médiation et de Conciliation de Ouagadougou (CAMC-O)"; seniority_tier='senior'; years_experience=16; email='sav_gouwend@yahoo.fr'; phone='+226 76 31 65 64'; bio_summary='Savadogo Gouwendé Moussa is a Burkinabe business lawyer and certified professional mediator specializing in OHADA business law, corporate taxation, and Alternative Dispute Resolution. He has worked since 2012 at the Ouagadougou Arbitration, Mediation and Conciliation Center (CAMC-O), and is a founding member of an Islamic microfinance institution (MICFIB SA).'; notes='Sector mismatch — business law / arbitration & mediation (ADR) specialist; no controlled sector matches closely. Finance/Economic recovery chosen as weak fallback. Recommend manual review.';
    sectors=@(@{n='Finance';p='primary'},@{n='Economic recovery and livelihoods';p='secondary'});
    languages=@(@{n='French';p='fluent'},@{n='Moore';p='native'});
    geos=@('Burkina Faso');
    edu=@(@{t='Master II Droit des affaires et fiscalités appliquées';i='ESCO-IGES';y=2015},@{t='Maîtrise en droit (option droit des affaires)';i='Université de Ouagadougou';y=2010},@{t='Licence en droit (option droit commercial)';i='Université de Ouagadougou';y=2009}) },

  @{ id=[guid]::NewGuid(); full_name='Pallo Dapougdi Augustin'; first_name='Augustin'; last_name='Pallo'; title='Ingénieur MQHSE / Lead Auditeur PECB ISO 45001 & ISO 9001'; partner_org='Self-employed Consultant'; seniority_tier='junior'; years_experience=5; email='palloaugustin@gmail.com'; phone='+226 75 32 78 71'; bio_summary='Pallo Dapougdi Augustin is a Burkinabe QHSE engineer and PECB-certified Lead Auditor for ISO 45001 and ISO 9001, specializing in occupational health, safety and environmental risk management in the construction, hydraulic works, electrical works, mining and banking sectors. He has led HSE compliance, audits, and training for World Bank-financed infrastructure projects.'; notes='Sector mismatch — QHSE (quality/health/safety/environment) engineering specialist for construction & mining sites; no controlled sector matches closely. Recommend manual review.';
    sectors=@(@{n='WASH';p='primary'},@{n='Climate adaptation and resilience programming';p='secondary'},@{n='Core Humanitarian Standards';p='secondary'},@{n='Gender equality and social inclusion';p='secondary'});
    languages=@(@{n='French';p='fluent'},@{n='English';p='working'},@{n='Moore';p='fluent'});
    geos=@('Burkina Faso');
    edu=@(@{t='Ingénieur en Management Qualité Hygiène Santé Sécurité Environnement (MQHSE)';i='IGEDD, Université Joseph KI-ZERBO';y=2022},@{t='Licence en Gestion de Pollution et Aménagement du Territoire (GPAT)';i='Université Joseph KI-ZERBO';y=2020},@{t='Licence en Sciences et Technologies (Géosciences)';i='Université Joseph KI-ZERBO';y=2016}) },

  @{ id=[guid]::NewGuid(); full_name='Yonli Yempabou'; first_name='Yempabou'; last_name='Yonli'; title='Économiste Gestionnaire — Chargé des Subventions et Appui aux Organisations locales'; partner_org='ACSD Sarl'; seniority_tier='principal_expert'; years_experience=25; email='julienyonli@gmail.com'; phone='+226 76 61 45 59'; bio_summary='Yonli Yempabou is a Burkinabe economist and management graduate (MBA, MSG) with over 25 years of experience in grants management, financial/administrative coordination, and local development across public administration and NGOs. He has coordinated grants for major USAID, BAD, EU and UNICEF-funded programs.'; notes=$null;
    sectors=@(@{n='WASH';p='primary'},@{n='Finance';p='secondary'},@{n='Economic recovery and livelihoods';p='secondary'},@{n='Localisation approaches';p='secondary'});
    languages=@(@{n='French';p='fluent'},@{n='English';p='working'},@{n='Moore';p='fluent'});
    geos=@('Burkina Faso','Niger');
    edu=@(@{t='Master in Business Administration (MBA)';i='Université Aube Nouvelle (AUBEN)';y=2016},@{t='Maîtrise en Sciences de Gestion (MSG)';i='ESCO-IGES';y=2012},@{t='Diplôme Universitaire de Technologie (DUT) Finance Comptabilité';i='ISPP/Université de Ouagadougou';y=2002}) },

  @{ id=[guid]::NewGuid(); full_name='Moussa Sawadogo'; first_name='Moussa'; last_name='Sawadogo'; title='Enseignant universitaire en STIC / Consultant en communication'; partner_org='Independent Consultant / Université de Ouagadougou'; seniority_tier='principal_expert'; years_experience=30; email='elmous@yahoo.fr'; phone='+226 66440202'; bio_summary='Moussa Sawadogo is a Burkinabe communication expert and university lecturer with 30 years of experience in institutional communication strategy, crisis communication, media development, and peacebuilding/conflict prevention communication across West and Central Africa. He has led communication strategy assignments for USAID, EU, UNDP, UNESCO, and the World Bank.'; notes=$null;
    sectors=@(@{n='Conflict sensitivity';p='primary'},@{n='Peacebuilding';p='secondary'},@{n='Accountability to affected populations';p='secondary'},@{n='MEAL technical integration';p='secondary'});
    languages=@(@{n='French';p='native'},@{n='English';p='working'});
    geos=@('Burkina Faso','Niger','Central African Republic','Cameroon');
    edu=@(@{t='Diplôme d''Études Approfondies (DEA) en Communication et médiation des savoirs';i='Université catholique de Louvain-la-Neuve, Belgique';y=2007},@{t='Master en journalisme/communication';i='Université de Ouagadougou';y=2003},@{t='Licence en Philosophie (option philosophie politique)';i='Université de Ouagadougou';y=1996}) },

  @{ id=[guid]::NewGuid(); full_name='Dr. Beguerang Topeur'; first_name='Beguerang'; last_name='Topeur'; title='Consultant en statistique'; partner_org='Independent Consultant'; seniority_tier='senior'; years_experience=15; email='beguerang@yahoo.fr'; phone='+235 65969976'; bio_summary='Dr. Beguerang Topeur is a Chadian statistician and economist holding a doctorate in Economics, with 15 years of experience in quantitative and qualitative survey design, econometric modeling, and field data collection across Chad and West Africa. He has led numerous evaluation and survey missions for organizations including UNICEF, USAID/Africare, and the World Bank.'; notes=$null;
    sectors=@(@{n='Food security';p='primary'},@{n='Nutrition';p='secondary'},@{n='Health';p='secondary'},@{n='MEAL technical integration';p='secondary'});
    languages=@(@{n='French';p='native'},@{n='English';p='working'});
    geos=@('Chad','Mali','Niger','Benin','Burkina Faso',"Cote d'Ivoire",'Ghana','Senegal');
    edu=@(@{t="Doctorat en Economie";i="Université d'Auvergne";y=2023},@{t='DESS en Banque Finance et Gestion de Risque';i="Ecole Nationale d'Economie Appliquée (ENEA) Dakar";y=2003},@{t='Diplôme d''Ingénieur de Travaux Statistiques';i='Université de Ndjamena';y=1999}) },

  @{ id=[guid]::NewGuid(); full_name='Eric Wilfrid Yirin Zoure'; first_name='Eric'; last_name='Zoure'; title="Secrétaire Permanent de l'ITIE"; partner_org='Ministère de l''Economie et des Finances, Burkina Faso'; seniority_tier='principal_expert'; years_experience=18; email='zewyre@yahoo.fr'; phone='+226 70 76 56 90'; bio_summary='Eric Wilfrid Yirin Zoure is a Burkinabe economist, planner and financial expert with over 18 years of experience in economic monitoring, development planning, and investment tracking for national and regional programs. He currently serves as Secrétaire Permanent of the Extractive Industries Transparency Initiative (ITIE) at Burkina Faso''s Ministry of Economy and Finance.'; notes=$null;
    sectors=@(@{n='Finance';p='primary'},@{n='Economic recovery and livelihoods';p='secondary'});
    languages=@(@{n='French';p='fluent'},@{n='English';p='working'});
    geos=@('Burkina Faso','Mali','Mauritania','Niger','Chad');
    edu=@(@{t='Doctorant en sciences économiques';i='Université Aube Nouvelle';y=2024},@{t='Diplôme d''Études Supérieures Bancaires et Financières (DESBF)';i='COFEB/BCEAO, Sénégal';y=2012},@{t="Diplôme universitaire professionnel de Conseiller des affaires économiques (ECOFI)";i='ENAM';y=2007}) },

  @{ id=[guid]::NewGuid(); full_name='Tougma Adama'; first_name='Adama'; last_name='Tougma'; title='Gestionnaire finance et administration, de Subvention, Logistique et la conformité'; partner_org='TEARFUND'; seniority_tier='senior'; years_experience=11; email='adama.tougma@yahoo.fr'; phone='+226 75 10 39 19'; bio_summary='Tougma Adama is a Burkinabe finance, HR and compliance manager with over 10 years of experience managing NGO financial operations, grants, payroll, and supply chain logistics in humanitarian and development contexts. She has held finance management and compliance roles at TEARFUND, MSH, and Christoffel Blinden Mission (CBM).'; notes=$null;
    sectors=@(@{n='Health';p='primary'},@{n='Finance';p='secondary'},@{n='Human Resources';p='secondary'},@{n='Economic recovery and livelihoods';p='secondary'});
    languages=@(@{n='French';p='fluent'},@{n='English';p='working'},@{n='Moore';p='fluent'});
    geos=@('Burkina Faso');
    edu=@(@{t='Master in Engineering/Tech, Accounting Control and Audit';i='Institut Supérieur de Technologie';y=2019},@{t="Bachelor's Degree in Science, Accounting and Financial Techniques";i='Université Polytechnique de Bobo (UPB)';y=2013},@{t='Technical University Degree (DUT) in Finance-Accounting';i='Université Polytechnique de Bobo (UPB)';y=2012}) },

  @{ id=[guid]::NewGuid(); full_name='Soro Ousseini'; first_name='Ousseini'; last_name='Soro'; title='Directeur général des études et des statistiques sectorielles'; partner_org='Ministère de la famille et de la solidarité, Burkina Faso'; seniority_tier='senior'; years_experience=13; email='soroousseini@gmail.com'; phone='00226 70 07 32 59'; bio_summary='M. Soro Ousseini is a senior social protection and strategic planning specialist with over a decade of experience in Burkina Faso''s public administration, currently serving as Director-General of Studies and Sectoral Statistics at the Ministry of Family and Solidarity. He has led the design, monitoring and evaluation of national social protection policies and child protection strategies.'; notes=$null;
    sectors=@(@{n='Protection';p='primary'},@{n='Migration and displacement';p='secondary'},@{n='Gender equality and social inclusion';p='secondary'},@{n='Accountability to affected populations';p='secondary'},@{n='Economic recovery and livelihoods';p='secondary'});
    languages=@(@{n='French';p='native'},@{n='English';p='working'},@{n='Moore';p='working'});
    geos=@('Burkina Faso','Guinea','Senegal');
    edu=@(@{t='Master professionnel en développement et protection sociale (en cours)';i='Université Joseph KI-ZERBO/CEFORGRIS';y=$null},@{t="Diplôme d'État d'Inspecteur d'Éducation de Jeunes Enfants";i='Institut National de Formation en Travail Social';y=2014},@{t='Certificat de maîtrise en Psychologie (BAC+4)';i='Université de Ouagadougou';y=2013}) },

  @{ id=[guid]::NewGuid(); full_name='Sangla Mahamadi'; first_name='Mahamadi'; last_name='Sangla'; title='Chef de Brigade de vérification'; partner_org='Direction générale des impôts, Burkina Faso'; seniority_tier='principal_expert'; years_experience=19; email='msangla2001@yahoo.fr'; phone='(00226) 70 75 64 57'; bio_summary='Mahamadi Sangla is a senior tax inspector with the Burkina Faso Directorate General of Taxes, specializing in corporate taxation, tax audits (including in the mining and telecommunications sectors), and tax dispute resolution. He has nearly two decades of experience designing and optimizing fiscal policy.'; notes='Sector mismatch — tax administration / fiscal audit specialist; only "Finance" loosely matches his expertise. Recommend manual review.';
    sectors=@(@{n='Finance';p='primary'});
    languages=@(@{n='French';p='native'});
    geos=@('Burkina Faso','Guinea');
    edu=@(@{t='Master II en Comptabilité-Contrôle-Audit';i='Université Joseph KI-ZERBO (IBAM)';y=2023},@{t='Master II en Management et commerce international';i='Université Jean Moulin Lyon 3';y=2017},@{t="Diplôme de l'ENAREF — Option Fiscalité";i='École Nationale des Régies Financières';y=2007}) },

  @{ id=[guid]::NewGuid(); full_name='Al-Hassana Idriss Abakar'; first_name='Idriss'; last_name='Abakar'; title='Consultant en finance et gestion des risques'; partner_org='Cabinet ECO Finances et Trading'; seniority_tier='principal_expert'; years_experience=18; email='abakare19@gmail.com'; phone='+235 60-18-60-59'; bio_summary='Al-Hassana Idriss Abakar is a finance professional from Chad with over 18 years of experience in audit, risk management, and financial analysis across banking, consulting, and public institutions. He has led financial audit missions for ministries and public enterprises in Côte d''Ivoire and worked on microfinance regulation for Chad''s Prime Minister''s Office.'; notes=$null;
    sectors=@(@{n='Finance';p='primary'},@{n='Economic recovery and livelihoods';p='secondary'});
    languages=@(@{n='French';p='fluent'},@{n='Arabic';p='working'},@{n='English';p='working'});
    geos=@('Chad',"Cote d'Ivoire");
    edu=@(@{t='Diplôme d''Ingénieur (Bac+5), Finance & Marchés des Capitaux';i='HEC Abidjan';y=$null},@{t='BTS Banque';i='EST Abidjan';y=$null}) },

  @{ id=[guid]::NewGuid(); full_name='Sore Boureima'; first_name='Boureima'; last_name='Sore'; title='Expert en Planification Stratégique, Gouvernance institutionnelle, Gestion de Programmes et Développement Territorial'; partner_org='Independent Consultant'; seniority_tier='senior'; years_experience=17; email='boureima.sore@gmail.com'; phone='+226 76 232 962'; bio_summary='Boureima Soré is a senior strategic planning and programme management professional with over 17 years of experience coordinating complex donor-funded projects in Burkina Faso, working with the World Bank, AFD, the European Union, UN agencies, and the Peacebuilding Fund. He specializes in strategic plan development, results-based management, and territorial development.'; notes=$null;
    sectors=@(@{n='Peacebuilding';p='primary'},@{n='Conflict sensitivity';p='secondary'},@{n='Area-based approaches';p='secondary'},@{n='WASH';p='secondary'},@{n='MEAL technical integration';p='secondary'});
    languages=@(@{n='French';p='native'});
    geos=@('Burkina Faso');
    edu=@() },

  @{ id=[guid]::NewGuid(); full_name='Prof. Ebenezer Owusu-Addo'; first_name='Ebenezer'; last_name='Owusu-Addo'; title='Associate Professor and Director, IRDIS, KNUST'; partner_org='Kwame Nkrumah University of Science and Technology (KNUST)'; seniority_tier='principal_expert'; years_experience=18; email='eowusu-addo.canr@knust.edu.gh'; phone='+233501349036'; bio_summary='Professor Ebenezer Owusu-Addo is an international development and evaluation specialist with 18 years of experience in monitoring, evaluation, and learning (MEL), currently serving as Associate Professor and Director of IRDIS at KNUST, Ghana. He holds a PhD in Public Health (Programme Evaluation) from Monash University and has led numerous impact evaluations for USAID, UNICEF, UNFPA, the World Bank, and the EU.'; notes=$null;
    sectors=@(@{n='MEAL technical integration';p='primary'},@{n='Food security';p='secondary'},@{n='Nutrition';p='secondary'},@{n='WASH';p='secondary'},@{n='Economic recovery and livelihoods';p='secondary'},@{n='Protection';p='secondary'},@{n='Gender equality and social inclusion';p='secondary'},@{n='Health';p='secondary'});
    languages=@(@{n='English';p='fluent'});
    geos=@('Ghana','Nigeria','Togo','Benin',"Cote d'Ivoire",'Liberia','Niger','Mali');
    edu=@(@{t='PhD in Public Health (Programme Evaluation)';i='Monash University, Australia';y=2019},@{t='MSc Public Health (Health Promotion)';i='Leeds Beckett University, UK';y=2010},@{t='BSc (Hons) Development Planning';i='KNUST, Ghana';y=2006}) },

  @{ id=[guid]::NewGuid(); full_name='Prof. Paul Sarfo-Mensah'; first_name='Paul'; last_name='Sarfo-Mensah'; title='Associate Professor, Bureau of Integrated Rural Development (BIRD), KNUST'; partner_org='Kwame Nkrumah University of Science and Technology (KNUST)'; seniority_tier='principal_expert'; years_experience=39; email='psarfomensah@gmail.com'; phone='+233 24 3140500'; bio_summary='Professor Paul Sarfo-Mensah is a veteran natural resources management and rural development expert with close to four decades of experience at KNUST''s Bureau of Integrated Rural Development. He holds a PhD in Natural Resources Management from the University of Greenwich and has led numerous evaluations and baseline studies for USAID, the World Bank, IFAD, the EU, and the Ghana Ministry of Finance.'; notes=$null;
    sectors=@(@{n='Climate adaptation and resilience programming';p='primary'},@{n='Food security';p='secondary'},@{n='Economic recovery and livelihoods';p='secondary'},@{n='MEAL technical integration';p='secondary'},@{n='Area-based approaches';p='secondary'});
    languages=@(@{n='English';p='fluent'},@{n='French';p='working'});
    geos=@('Ghana',"Cote d'Ivoire");
    edu=@(@{t='PhD Natural Resources Management';i='University of Greenwich (Natural Resources Institute), UK';y=2001},@{t='MPhil Socio-economics of Agroforestry';i='KNUST, Ghana';y=1995},@{t='BSc (Hons) Agriculture (Economics and Farm Management)';i='KNUST, Ghana';y=1982}) }
)

Write-Host "Loaded $($experts.Count) expert records."

$sql = New-Object System.Text.StringBuilder
[void]$sql.AppendLine("-- ACS Pool Experts batch 1: 'CVs to add' (27 partner consultants)")
[void]$sql.AppendLine("-- Generated and applied via Supabase Management API.")
[void]$sql.AppendLine("begin;")
[void]$sql.AppendLine("alter table experts add column if not exists notes text;")
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

[void]$sql.AppendLine("commit;")

$sqlText = $sql.ToString()
$migrationPath = "C:\Users\Abdou Ndiaye\OneDrive\Desktop\Business\Application\ACSD-Expert-Roster\supabase\migrations\0004_acs_pool_experts_batch1.sql"
Set-Content -Path $migrationPath -Value $sqlText -Encoding utf8
Write-Host "SQL written to $migrationPath ($('{0:N0}' -f $sqlText.Length) chars)"

# Execute via Supabase Management API
# NOTE: Invoke-RestMethod in Windows PowerShell 5.1 mis-encodes non-ASCII characters
# when passed a string body — must send raw UTF-8 bytes explicitly.
$token = "sbp_95521edbdb51d4872b29bbd7b1fe93da80e10b73"
$headers = @{ Authorization = "Bearer $token" }
$bodyJson = @{ query = $sqlText } | ConvertTo-Json -Depth 5
$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyJson)
$resp = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/bazrdeykmntponplkncc/database/query" -Method Post -Headers $headers -Body $bodyBytes -ContentType "application/json; charset=utf-8"
Write-Host "Execution result:"
$resp | ConvertTo-Json -Depth 5
