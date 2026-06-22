-- KNUST-IRDIS Group 2: 8 new experts + update existing Prof. Paul Sarfo-Mensah
begin;

insert into experts (id, full_name, first_name, last_name, title, affiliation_type, partner_org, seniority_tier, years_experience, email, phone, bio_summary, notes, is_active) values
('b6162cf1-633c-4696-a770-66ce6f0a5a69', 'Sampson E. Edusah', 'Sampson', 'Edusah', 'Associate Professor of Development Studies', 'partner', 'Institute for Rural Development and Innovation Studies (IRDIS), KNUST', 'principal_expert', 40, 's.edusah@gmail.com', '+233 244224458', 'Sampson E. Edusah is an Associate Professor of Development Studies at the Institute for Rural Development and Innovation Studies (IRDIS), KNUST, Ghana, holding a PhD in Development Studies from the University of Bradford. He has over three decades of experience in rural development, small-scale industries research, and natural resource management, including senior roles as Director of the Bureau of Integrated Rural Development (BIRD) and Project Coordinator for Integrated Natural Resource Management.', NULL, true),
('ebdcdd5e-4bce-444d-a063-266aead1e105', 'Bernice Wadei', 'Bernice', 'Wadei', 'Research Fellow', 'partner', 'Institute for Rural Development and Innovation Studies (IRDIS), KNUST', 'senior', 13, 'bwadei@knust.edu.gh', '+233 246808970', 'Bernice Wadei, PhD, is a Research Fellow at the Institute for Rural Development and Innovation Studies (IRDIS), KNUST, Ghana, specializing in gender, livelihoods, and household wellbeing research. She holds a PhD in Geography and Rural Development from KNUST and has led and contributed to numerous gender-focused evaluations and research projects funded by organizations such as UN Women, UNFPA/UNICEF, GIZ, Catholic Relief Services, and the International Cocoa Initiative.', NULL, true),
('a2bfc8e0-b4be-4dad-9302-47f32903f093', 'Albert A. Arhin', 'Albert', 'Arhin', 'Research Fellow', 'partner', 'Bureau of Integrated Rural Development (BIRD) / IRDIS, KNUST', 'senior', 14, 'aaarhin@knust.edu.gh', '+233 322493501', 'Albert A. Arhin, PhD, is a Research Fellow at the Bureau of Integrated Rural Development (BIRD), KNUST, Ghana, with a PhD in Geography from the University of Cambridge (Gates Cambridge Scholar). He has extensive experience as a principal consultant and evaluator on child labour, climate adaptation, gender-transformative programming, REDD+ governance, and cocoa supply chain projects for organizations including the International Cocoa Initiative, GIZ, USAID, FAO, and Fairtrade International.', NULL, true),
('12ecf1c1-92fd-478d-872c-bcfda58b6600', 'Dr. Isaac Bonuedi', 'Isaac', 'Bonuedi', 'Research Fellow, IRDIS', 'partner', 'Institute for Rural Development and Innovation Studies (IRDIS), KNUST', 'senior', 16, 'isaac.bonuedi@knust.edu.gh', '+233248799905', 'Dr. Isaac Bonuedi is a Research Fellow at IRDIS, KNUST, holding a PhD in Agricultural Development Economics from the University of Bonn, Germany. He specializes in food security, nutrition-sensitive agriculture, market access, agricultural value chains, and socioeconomic impact evaluation, with extensive experience leading donor-funded baseline studies, endline evaluations, and impact assessments across Ghana, Liberia, and Côte d''Ivoire.', NULL, true),
('c8bc52fa-1f05-4699-a62e-0c0e994d8cdd', 'Dr. Monica Addison', 'Monica', 'Addison', 'Senior Research Fellow / former Director, IRDIS, KNUST', 'partner', 'Institute for Rural Development and Innovation Studies (IRDIS), KNUST', 'principal_expert', 23, 'maddison.canr@knust.edu.gh', '+23324879990', 'Dr. (Mrs.) Monica Addison is a Senior Research Fellow and former Director of both BIRD and IRDIS at KNUST, holding a PhD in Agricultural Economics from KNUST. She is a gender and agricultural economics specialist with over two decades of research experience on gender, agricultural innovations, rice value chains, intra-household resource allocation, and rural livelihoods in Ghana.', NULL, true),
('d0fb1cf5-57d9-48d8-ba88-cbbabb1e8071', 'Dr. Ibrahim Latif Apaassongo', 'Ibrahim Latif', 'Apaassongo', 'Research Fellow/Lecturer, IRDIS', 'partner', 'Institute for Rural Development and Innovation Studies (IRDIS), KNUST', 'senior', 14, 'latif.ibrahim@knust.edu.gh', '+233(0)551992130', 'Dr. Ibrahim Latif Apaassongo is an Agricultural Economist and Research Fellow/Lecturer at IRDIS, KNUST, holding a PhD in Agricultural Economics from the University of Tokyo, Japan. He specializes in food systems, agricultural value chains, local rice market development, quality governance, impact evaluation, and climate resilience, with technical roles on donor-funded research and evaluation assignments for IFAD, USAID/ACDI-VOCA, and IDRC in Ghana.', NULL, true),
('9d4ba454-00f7-4690-bf61-b1c3c618c780', 'Prof. Ernestina Fredua Antoh', 'Ernestina', 'Fredua Antoh', 'Associate Professor, Head, Social Change Development Unit, IRDIS', 'partner', 'Institute for Rural Development and Innovation Studies (IRDIS), KNUST', 'principal_expert', 38, 'ernestina19@yahoo.co.uk', '+233 244619492', 'Prof. Ernestina Fredua Antoh is an Associate Professor at the Institute for Rural Development and Innovation Studies (IRDIS), KNUST, Ghana, with over three decades of experience in rural sociology, gender, and microfinance research. She has directed IRDIS twice and led numerous evaluations and baseline studies for organizations including GIZ, Newmont, USAID-funded projects, and the International Cocoa Initiative.', NULL, true),
('61d3d13a-2017-4918-ad64-8785f8400975', 'Dr. Thomas Yeboah', 'Thomas', 'Yeboah', 'Senior Research Fellow, IRDIS', 'partner', 'Institute for Rural Development and Innovation Studies (IRDIS), KNUST', 'senior', 12, 'thomas.yeboah@knust.edu.gh', '+233 204730853', 'Dr. Thomas Yeboah is a Senior Research Fellow at the Institute for Rural Development and Innovation Studies (IRDIS), KNUST, Ghana, specializing in youth employment, migration, and rural livelihoods in Africa. He holds a PhD in Development Studies from the University of Cambridge and has led and contributed to numerous evaluations and research projects funded by USAID, AfDB, GIZ, UNICEF, UNFPA, and other agencies.', NULL, true);

insert into expert_sectors (expert_id, sector_id, priority) values
('b6162cf1-633c-4696-a770-66ce6f0a5a69', 4, 'primary'),
('b6162cf1-633c-4696-a770-66ce6f0a5a69', 14, 'secondary'),
('b6162cf1-633c-4696-a770-66ce6f0a5a69', 2, 'secondary'),
('ebdcdd5e-4bce-444d-a063-266aead1e105', 18, 'primary'),
('ebdcdd5e-4bce-444d-a063-266aead1e105', 4, 'secondary'),
('ebdcdd5e-4bce-444d-a063-266aead1e105', 2, 'secondary'),
('ebdcdd5e-4bce-444d-a063-266aead1e105', 3, 'secondary'),
('ebdcdd5e-4bce-444d-a063-266aead1e105', 14, 'secondary'),
('ebdcdd5e-4bce-444d-a063-266aead1e105', 19, 'secondary'),
('a2bfc8e0-b4be-4dad-9302-47f32903f093', 14, 'primary'),
('a2bfc8e0-b4be-4dad-9302-47f32903f093', 4, 'secondary'),
('a2bfc8e0-b4be-4dad-9302-47f32903f093', 18, 'secondary'),
('a2bfc8e0-b4be-4dad-9302-47f32903f093', 19, 'secondary'),
('a2bfc8e0-b4be-4dad-9302-47f32903f093', 5, 'secondary'),
('12ecf1c1-92fd-478d-872c-bcfda58b6600', 2, 'primary'),
('12ecf1c1-92fd-478d-872c-bcfda58b6600', 3, 'secondary'),
('12ecf1c1-92fd-478d-872c-bcfda58b6600', 4, 'secondary'),
('12ecf1c1-92fd-478d-872c-bcfda58b6600', 14, 'secondary'),
('12ecf1c1-92fd-478d-872c-bcfda58b6600', 18, 'secondary'),
('12ecf1c1-92fd-478d-872c-bcfda58b6600', 19, 'secondary'),
('12ecf1c1-92fd-478d-872c-bcfda58b6600', 7, 'secondary'),
('c8bc52fa-1f05-4699-a62e-0c0e994d8cdd', 18, 'primary'),
('c8bc52fa-1f05-4699-a62e-0c0e994d8cdd', 2, 'secondary'),
('c8bc52fa-1f05-4699-a62e-0c0e994d8cdd', 4, 'secondary'),
('c8bc52fa-1f05-4699-a62e-0c0e994d8cdd', 14, 'secondary'),
('c8bc52fa-1f05-4699-a62e-0c0e994d8cdd', 19, 'secondary'),
('d0fb1cf5-57d9-48d8-ba88-cbbabb1e8071', 2, 'primary'),
('d0fb1cf5-57d9-48d8-ba88-cbbabb1e8071', 4, 'secondary'),
('d0fb1cf5-57d9-48d8-ba88-cbbabb1e8071', 14, 'secondary'),
('d0fb1cf5-57d9-48d8-ba88-cbbabb1e8071', 19, 'secondary'),
('d0fb1cf5-57d9-48d8-ba88-cbbabb1e8071', 8, 'secondary'),
('d0fb1cf5-57d9-48d8-ba88-cbbabb1e8071', 18, 'secondary'),
('9d4ba454-00f7-4690-bf61-b1c3c618c780', 18, 'primary'),
('9d4ba454-00f7-4690-bf61-b1c3c618c780', 4, 'secondary'),
('9d4ba454-00f7-4690-bf61-b1c3c618c780', 2, 'secondary'),
('9d4ba454-00f7-4690-bf61-b1c3c618c780', 14, 'secondary'),
('9d4ba454-00f7-4690-bf61-b1c3c618c780', 19, 'secondary'),
('61d3d13a-2017-4918-ad64-8785f8400975', 11, 'primary'),
('61d3d13a-2017-4918-ad64-8785f8400975', 4, 'secondary'),
('61d3d13a-2017-4918-ad64-8785f8400975', 18, 'secondary'),
('61d3d13a-2017-4918-ad64-8785f8400975', 2, 'secondary'),
('61d3d13a-2017-4918-ad64-8785f8400975', 14, 'secondary'),
('61d3d13a-2017-4918-ad64-8785f8400975', 19, 'secondary'),
('61d3d13a-2017-4918-ad64-8785f8400975', 20, 'secondary');

insert into expert_languages (expert_id, language_id, proficiency) values
('b6162cf1-633c-4696-a770-66ce6f0a5a69', 2, 'fluent'),
('ebdcdd5e-4bce-444d-a063-266aead1e105', 2, 'fluent'),
('a2bfc8e0-b4be-4dad-9302-47f32903f093', 2, 'fluent'),
('12ecf1c1-92fd-478d-872c-bcfda58b6600', 2, 'fluent'),
('c8bc52fa-1f05-4699-a62e-0c0e994d8cdd', 2, 'fluent'),
('d0fb1cf5-57d9-48d8-ba88-cbbabb1e8071', 2, 'fluent'),
('d0fb1cf5-57d9-48d8-ba88-cbbabb1e8071', 8, 'working'),
('d0fb1cf5-57d9-48d8-ba88-cbbabb1e8071', 9, 'working'),
('9d4ba454-00f7-4690-bf61-b1c3c618c780', 2, 'fluent'),
('61d3d13a-2017-4918-ad64-8785f8400975', 2, 'fluent');

insert into expert_geographies (expert_id, geography_id) values
('b6162cf1-633c-4696-a770-66ce6f0a5a69', 12),
('ebdcdd5e-4bce-444d-a063-266aead1e105', 12),
('ebdcdd5e-4bce-444d-a063-266aead1e105', 9),
('ebdcdd5e-4bce-444d-a063-266aead1e105', 15),
('ebdcdd5e-4bce-444d-a063-266aead1e105', 7),
('a2bfc8e0-b4be-4dad-9302-47f32903f093', 12),
('a2bfc8e0-b4be-4dad-9302-47f32903f093', 9),
('12ecf1c1-92fd-478d-872c-bcfda58b6600', 12),
('12ecf1c1-92fd-478d-872c-bcfda58b6600', 15),
('12ecf1c1-92fd-478d-872c-bcfda58b6600', 9),
('c8bc52fa-1f05-4699-a62e-0c0e994d8cdd', 12),
('d0fb1cf5-57d9-48d8-ba88-cbbabb1e8071', 12),
('9d4ba454-00f7-4690-bf61-b1c3c618c780', 12),
('61d3d13a-2017-4918-ad64-8785f8400975', 12),
('61d3d13a-2017-4918-ad64-8785f8400975', 9),
('61d3d13a-2017-4918-ad64-8785f8400975', 7),
('61d3d13a-2017-4918-ad64-8785f8400975', 1),
('61d3d13a-2017-4918-ad64-8785f8400975', 15);

insert into education_certifications (id, expert_id, type, title, institution, year) values
(gen_random_uuid(), 'b6162cf1-633c-4696-a770-66ce6f0a5a69', 'education', 'PhD Development Studies', 'University of Bradford, UK', 1999),
(gen_random_uuid(), 'b6162cf1-633c-4696-a770-66ce6f0a5a69', 'education', 'Postgraduate Diploma, Professional Capacity Building for Research and Development (Value Chain)', 'ICRA, Wageningen, Netherlands', 2005),
(gen_random_uuid(), 'b6162cf1-633c-4696-a770-66ce6f0a5a69', 'education', 'MAEd / BA Industrial Art', 'University of Science and Technology, Kumasi', NULL),
(gen_random_uuid(), 'ebdcdd5e-4bce-444d-a063-266aead1e105', 'education', 'PhD Geography and Rural Development', 'Kwame Nkrumah University of Science and Technology (KNUST)', 2020),
(gen_random_uuid(), 'ebdcdd5e-4bce-444d-a063-266aead1e105', 'education', 'MSc Development Management', 'University of Agder, Norway', 2013),
(gen_random_uuid(), 'ebdcdd5e-4bce-444d-a063-266aead1e105', 'education', 'BA (Hons) Geography and Rural Development, First Class', 'KNUST', 2011),
(gen_random_uuid(), 'a2bfc8e0-b4be-4dad-9302-47f32903f093', 'education', 'PhD Geography', 'Emmanuel College, University of Cambridge, UK', 2017),
(gen_random_uuid(), 'a2bfc8e0-b4be-4dad-9302-47f32903f093', 'education', 'MSc Environment and Development', 'University of Leeds, UK', 2010),
(gen_random_uuid(), 'a2bfc8e0-b4be-4dad-9302-47f32903f093', 'education', 'BSc Planning, First Class Honours', 'KNUST', 2008),
(gen_random_uuid(), '12ecf1c1-92fd-478d-872c-bcfda58b6600', 'education', 'Doctor of Agricultural Sciences (Agricultural Development Economics)', 'University of Bonn, Germany', 2021),
(gen_random_uuid(), '12ecf1c1-92fd-478d-872c-bcfda58b6600', 'education', 'MSc Economics', 'University of Southern Denmark', 2015),
(gen_random_uuid(), '12ecf1c1-92fd-478d-872c-bcfda58b6600', 'education', 'MPhil Economics', 'KNUST, Ghana', 2013),
(gen_random_uuid(), 'c8bc52fa-1f05-4699-a62e-0c0e994d8cdd', 'education', 'PhD Agricultural Economics', 'Kwame Nkrumah University of Science and Technology, Ghana', 2018),
(gen_random_uuid(), 'c8bc52fa-1f05-4699-a62e-0c0e994d8cdd', 'education', 'MSc Development Policy and Planning (Economic Development Option)', 'KNUST, Ghana', 2003),
(gen_random_uuid(), 'c8bc52fa-1f05-4699-a62e-0c0e994d8cdd', 'education', 'BSc (Hons) Agriculture (Agricultural Econ. Option)', 'KNUST, Ghana', 1997),
(gen_random_uuid(), 'd0fb1cf5-57d9-48d8-ba88-cbbabb1e8071', 'education', 'PhD Agricultural Economics', 'The University of Tokyo, Japan', 2022),
(gen_random_uuid(), 'd0fb1cf5-57d9-48d8-ba88-cbbabb1e8071', 'education', 'MPhil Agricultural Economics', 'Kwame Nkrumah University of Science and Technology, Ghana', 2013),
(gen_random_uuid(), 'd0fb1cf5-57d9-48d8-ba88-cbbabb1e8071', 'education', 'BSc Agricultural Science', 'Kwame Nkrumah University of Science and Technology, Ghana', 2009),
(gen_random_uuid(), '9d4ba454-00f7-4690-bf61-b1c3c618c780', 'education', 'PhD Development Studies', 'University of Cape Coast, Ghana', 2014),
(gen_random_uuid(), '9d4ba454-00f7-4690-bf61-b1c3c618c780', 'education', 'MA Education Research', 'University of Sussex, UK', 2010),
(gen_random_uuid(), '9d4ba454-00f7-4690-bf61-b1c3c618c780', 'education', 'MA Rural Social Development, Agricultural Extension and Rural Development', 'University of Reading, UK', 1990),
(gen_random_uuid(), '61d3d13a-2017-4918-ad64-8785f8400975', 'education', 'PhD Development Studies', 'Churchill College, University of Cambridge, UK', 2018),
(gen_random_uuid(), '61d3d13a-2017-4918-ad64-8785f8400975', 'education', 'MPhil Development Studies', 'Churchill College, University of Cambridge, UK', 2013),
(gen_random_uuid(), '61d3d13a-2017-4918-ad64-8785f8400975', 'education', 'BA (Hons) Geography and Rural Development, First Class Honours', 'Kwame Nkrumah University of Science and Technology (KNUST), Ghana', 2011);

-- Update Prof. Paul Sarfo-Mensah with his refreshed 2026 CV
update experts set title='Associate Professor and Development Consultant, Institute for Rural Development and Innovation Studies (IRDIS) [formerly BIRD], KNUST', partner_org='Institute for Rural Development and Innovation Studies (IRDIS), KNUST', years_experience=30, bio_summary='Professor Paul Sarfo-Mensah is an Associate Professor and Development Consultant at the Institute for Rural Development and Innovation Studies (IRDIS, formerly the Bureau of Integrated Rural Development), KNUST, Ghana, with 30 years of experience in socioeconomics, agriculture, natural resource management, and rural development. He has twice served as Director of BIRD and has led numerous evaluations and baseline studies for USAID, FAO, the World Bank, DANIDA, UNICEF/UNFPA, Newmont, and the International Cocoa Initiative across Ghana, Cote d''Ivoire, and Senegal.' where id='bc0a0535-b718-4007-83c6-a8df54a3b524';
insert into expert_sectors (expert_id, sector_id, priority) values ('bc0a0535-b718-4007-83c6-a8df54a3b524', 9, 'secondary') on conflict (expert_id, sector_id) do nothing;
insert into expert_geographies (expert_id, geography_id) values ('bc0a0535-b718-4007-83c6-a8df54a3b524', 1) on conflict (expert_id, geography_id) do nothing;

commit;

