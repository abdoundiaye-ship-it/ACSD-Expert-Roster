'use strict'

// ── Language ──────────────────────────────────────────────────────────────────

window.LANG = 'en'

const STRINGS = {
  en: {
    header_subtitle:    'Expert Roster for Work Orders',
    logout_btn:         'Sign out',
    filters_title:      'Filters',
    clear_filters:      'Reset',
    label_affiliation:  'Affiliation',
    opt_all:            'All',
    opt_internal:       'Core (Internal)',
    opt_partner:        'Partner',
    label_seniority:    'Level',
    label_sector:       'Sector',
    label_geography:    'Country',
    label_language:     'Language',
    label_donor:        'Donor',
    label_role:         'Assignment Type',
    label_availability: 'Availability',
    opt_available:      'Available',
    opt_assigned:       'On Assignment',
    opt_unavailable:    'Unavailable',
    opt_unknown:        'Not specified',
    search_placeholder: 'Search by name, title, bio…',
    loading:            'Loading…',
    empty_title:        'No experts found',
    empty_sub:          'Try adjusting your filters or search.',
    avail_available:    'Available',
    avail_assigned:     'On Assignment',
    avail_unavailable:  'Unavailable',
    avail_unknown:      'Not specified',
    prof_native:        'Native',
    prof_fluent:        'Fluent',
    prof_professional:  'Professional',
    prof_working:       'Working',
    count_all:          n => `${n} expert${n !== 1 ? 's' : ''}`,
    count_filtered:     (s, tot) => `${s} of ${tot} expert${tot !== 1 ? 's' : ''}`,
    years_exp:          n => `${n} year${n !== 1 ? 's' : ''} of experience`,
    download_cv:        'Open CV',
    cv_error:           'Unable to retrieve CV file: ',
    load_error:         'Loading failed',
    modal_profile:      'Profile',
    modal_sectors:      'Sectors',
    modal_languages:    'Languages',
    modal_geo:          'Geographic Experience',
    modal_donors:       'Donors',
    modal_education:    'Education &amp; Certifications',
    modal_activities:   'Activity Types',
    modal_roles:        'Assignment Types',
  },
  fr: {
    header_subtitle:    'Fichier d\'experts pour ordres de travail',
    logout_btn:         'Déconnexion',
    filters_title:      'Filtres',
    clear_filters:      'Réinitialiser',
    label_affiliation:  'Affiliation',
    opt_all:            'Tous',
    opt_internal:       'Core (Interne)',
    opt_partner:        'Partenaire',
    label_seniority:    'Niveau',
    label_sector:       'Secteur',
    label_geography:    'Pays',
    label_language:     'Langue',
    label_donor:        'Bailleur',
    label_role:         'Type de mission',
    label_availability: 'Disponibilité',
    opt_available:      'Disponible',
    opt_assigned:       'En mission',
    opt_unavailable:    'Indisponible',
    opt_unknown:        'Non renseigné',
    search_placeholder: 'Rechercher par nom, titre, biographie…',
    loading:            'Chargement…',
    empty_title:        'Aucun expert trouvé',
    empty_sub:          'Essayez de modifier vos filtres ou votre recherche.',
    avail_available:    'Disponible',
    avail_assigned:     'En mission',
    avail_unavailable:  'Indisponible',
    avail_unknown:      'Non renseigné',
    prof_native:        'Natif',
    prof_fluent:        'Courant',
    prof_professional:  'Professionnel',
    prof_working:       'Opérationnel',
    count_all:          n => `${n} expert${n !== 1 ? 's' : ''}`,
    count_filtered:     (s, tot) => `${s} sur ${tot} expert${tot !== 1 ? 's' : ''}`,
    years_exp:          n => `${n} an${n !== 1 ? 's' : ''} d'expérience`,
    download_cv:        'Ouvrir le CV',
    cv_error:           'Impossible de récupérer le fichier CV : ',
    load_error:         'Erreur de chargement',
    modal_profile:      'Profil',
    modal_sectors:      'Secteurs',
    modal_languages:    'Langues',
    modal_geo:          'Expérience géographique',
    modal_donors:       'Bailleurs',
    modal_education:    'Formation &amp; Certifications',
    modal_activities:   'Types de livrables',
    modal_roles:        'Types de mission',
  }
}

function t(key, ...args) {
  const lang = window.LANG || 'en'
  const s = (STRINGS[lang] || STRINGS.en)[key] ?? STRINGS.en[key] ?? key
  return typeof s === 'function' ? s(...args) : s
}

function applyI18n() {
  const lang = window.LANG || 'en'
  const strings = STRINGS[lang] || STRINGS.en

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const val = strings[el.dataset.i18n]
    if (typeof val === 'string') el.textContent = val
  })
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const val = strings[el.dataset.i18nPlaceholder]
    if (typeof val === 'string') el.placeholder = val
  })

  document.querySelectorAll('.lang-btn').forEach(btn => {
    const active = btn.dataset.lang === lang
    btn.classList.toggle('bg-blue-800', active)
    btn.classList.toggle('text-white',  active)
    btn.classList.toggle('text-blue-400', !active)
  })

  document.documentElement.lang = lang
}

function setLang(lang) {
  window.LANG = lang
  applyI18n()
  renderFiltered()
}

// Apply language immediately on script load (DOM already present — scripts are at bottom of body)
applyI18n()

// ── Display constants ─────────────────────────────────────────────────────────

const SENIORITY_LABEL = {
  principal_expert: 'Principal Expert',
  senior:           'Senior',
  intermediary:     'Intermediary',
  junior:           'Junior',
}

const SENIORITY_COLOR = {
  principal_expert: 'bg-purple-100 text-purple-800',
  senior:           'bg-blue-100 text-blue-800',
  intermediary:     'bg-teal-100 text-teal-800',
  junior:           'bg-gray-100 text-gray-600',
}

const AFFIL_LABEL = { internal: 'Core', partner: 'Partner' }
const AFFIL_COLOR = { internal: 'bg-blue-900 text-white', partner: 'bg-emerald-700 text-white' }
const AVAIL_DOT   = { available: 'bg-green-500', assigned: 'bg-amber-500', unavailable: 'bg-red-500', unknown: 'bg-gray-300' }

// ── State ─────────────────────────────────────────────────────────────────────

let allExperts = []
let isAdmin = false

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function init() {
  const session = await checkAuth()
  if (!session) return

  document.getElementById('user-email').textContent = session.user.email

  const role = await getUserRole()
  isAdmin = role === 'admin'
  if (isAdmin) {
    document.getElementById('admin-badge').classList.remove('hidden')
    document.getElementById('admin-panel-link').classList.remove('hidden')
  }

  document.getElementById('logout-btn').addEventListener('click', logout)

  setLoading(true)
  try {
    const [experts, sectors, languages, geographies, donors, roles] = await Promise.all([
      fetchExperts(),
      sb.from('sectors').select('name').order('sort_order'),
      sb.from('languages').select('name').order('name'),
      sb.from('geographies').select('country_name').order('country_name'),
      sb.from('donors').select('name').order('name'),
      sb.from('work_order_roles').select('name').order('name'),
    ])

    allExperts = experts

    populateSelect('f-sector',    sectors.data,     'name')
    populateSelect('f-geography', geographies.data, 'country_name')
    populateSelect('f-language',  languages.data,   'name')
    populateSelect('f-donor',     donors.data,      'name')
    populateSelect('f-role',      roles.data,       'name')

    const FILTER_IDS = ['f-affiliation','f-seniority','f-sector','f-geography',
                        'f-language','f-donor','f-role','f-availability']
    FILTER_IDS.forEach(id => document.getElementById(id).addEventListener('change', renderFiltered))
    document.getElementById('search-input').addEventListener('input', debounce(renderFiltered, 220))
    document.getElementById('clear-filters').addEventListener('click', clearFilters)

    document.getElementById('modal-close').addEventListener('click', closeModal)
    document.getElementById('modal-backdrop').addEventListener('click', closeModal)
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal() })

    renderFiltered()
  } finally {
    setLoading(false)
  }
}

// ── Data ──────────────────────────────────────────────────────────────────────

async function fetchExperts() {
  const { data, error } = await sb
    .from('experts')
    .select(`
      id, full_name, title, affiliation_type, partner_org,
      seniority_tier, years_experience, availability_status, bio_summary,
      cv_storage_path,
      expert_sectors(priority, sectors(name)),
      expert_languages(proficiency, languages(name)),
      expert_geographies(geographies(country_name)),
      expert_donor_experience(notes, donors(name)),
      education_certifications(type, title, institution, year),
      expert_activity_experience(activity_types(name)),
      expert_role_fit(work_order_roles(name))
    `)
    .order('full_name')

  if (error) throw new Error(error.message)
  return data ?? []
}

// ── Filtering ─────────────────────────────────────────────────────────────────

function getFilters() {
  const v = id => document.getElementById(id).value
  return {
    search:       document.getElementById('search-input').value.trim().toLowerCase(),
    affiliation:  v('f-affiliation'),
    seniority:    v('f-seniority'),
    availability: v('f-availability'),
    sector:       v('f-sector'),
    geography:    v('f-geography'),
    language:     v('f-language'),
    donor:        v('f-donor'),
    role:         v('f-role'),
  }
}

function applyFilters(experts, f) {
  return experts.filter(e => {
    if (f.search) {
      const hay = [e.full_name, e.title, e.bio_summary, e.partner_org]
        .filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(f.search)) return false
    }

    if (f.affiliation  && e.affiliation_type   !== f.affiliation)  return false
    if (f.seniority    && e.seniority_tier      !== f.seniority)    return false
    if (f.availability && e.availability_status !== f.availability) return false

    if (f.sector) {
      const names = e.expert_sectors?.map(s => s.sectors?.name).filter(Boolean) ?? []
      if (!names.includes(f.sector)) return false
    }
    if (f.geography) {
      const names = e.expert_geographies?.map(g => g.geographies?.country_name).filter(Boolean) ?? []
      if (!names.includes(f.geography)) return false
    }
    if (f.language) {
      const names = e.expert_languages?.map(l => l.languages?.name).filter(Boolean) ?? []
      if (!names.includes(f.language)) return false
    }
    if (f.donor) {
      const names = e.expert_donor_experience?.map(d => d.donors?.name).filter(Boolean) ?? []
      if (!names.includes(f.donor)) return false
    }
    if (f.role) {
      const names = e.expert_role_fit?.map(r => r.work_order_roles?.name).filter(Boolean) ?? []
      if (!names.includes(f.role)) return false
    }

    return true
  })
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderFiltered() {
  const filters  = getFilters()
  const filtered = applyFilters(allExperts, filters)

  const grid    = document.getElementById('experts-grid')
  const empty   = document.getElementById('empty-state')
  const countEl = document.getElementById('results-count')

  const total = allExperts.length
  const shown = filtered.length
  countEl.textContent = shown === total
    ? t('count_all', total)
    : t('count_filtered', shown, total)

  if (shown === 0) {
    grid.innerHTML = ''
    empty.classList.remove('hidden')
    return
  }
  empty.classList.add('hidden')

  grid.innerHTML = filtered.map(expertCard).join('')
  grid.querySelectorAll('.expert-card').forEach(card => {
    card.addEventListener('click', () => {
      const e = filtered.find(x => x.id === card.dataset.id)
      if (e) showModal(e)
    })
  })
}

function expertCard(e) {
  const primary = e.expert_sectors?.find(s => s.priority === 'primary')?.sectors?.name ?? ''
  const geos    = e.expert_geographies?.map(g => g.geographies?.country_name).filter(Boolean).sort() ?? []
  const MAX_GEO = 3
  const geoText = geos.slice(0, MAX_GEO).join(', ') + (geos.length > MAX_GEO ? ` +${geos.length - MAX_GEO}` : '')
  const dot     = AVAIL_DOT[e.availability_status] ?? 'bg-gray-300'
  const dotTip  = t('avail_' + (e.availability_status ?? 'unknown'))

  return `
<div class="expert-card bg-white rounded-xl border border-gray-200 shadow-sm
            hover:shadow-md hover:border-blue-300 transition-all cursor-pointer p-5 flex flex-col gap-3"
     data-id="${esc(e.id)}">
  <div class="flex items-start justify-between gap-2">
    <div class="flex-1 min-w-0">
      <h3 class="font-semibold text-gray-900 text-sm leading-snug">${esc(e.full_name)}</h3>
      <p class="text-xs text-gray-500 mt-0.5 line-clamp-2">${esc(e.title ?? '')}</p>
    </div>
    <div class="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
      ${e.cv_storage_path ? `<span class="text-xs font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded" title="CV available">CV</span>` : ''}
      <span class="w-2.5 h-2.5 rounded-full ${dot}" title="${esc(dotTip)}"></span>
    </div>
  </div>

  <div class="flex flex-wrap gap-1.5">
    <span class="text-xs font-medium px-2 py-0.5 rounded-full ${AFFIL_COLOR[e.affiliation_type]}">${AFFIL_LABEL[e.affiliation_type]}</span>
    ${e.seniority_tier
      ? `<span class="text-xs font-medium px-2 py-0.5 rounded-full ${SENIORITY_COLOR[e.seniority_tier]}">${SENIORITY_LABEL[e.seniority_tier]}</span>`
      : ''}
  </div>

  ${primary ? `<p class="text-xs font-medium text-gray-700 border-l-2 border-blue-500 pl-2 leading-snug">${esc(primary)}</p>` : ''}
  ${geos.length ? `<p class="text-xs text-gray-400">${esc(geoText)}</p>` : ''}
</div>`
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function showModal(e) {
  const primarySector    = e.expert_sectors?.find(s => s.priority === 'primary')?.sectors?.name
  const secondarySectors = e.expert_sectors?.filter(s => s.priority === 'secondary').map(s => s.sectors?.name).filter(Boolean) ?? []
  const languages        = e.expert_languages ?? []
  const geos             = e.expert_geographies?.map(g => g.geographies?.country_name).filter(Boolean).sort() ?? []
  const donors           = e.expert_donor_experience ?? []
  const eduItems         = (e.education_certifications ?? []).sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
  const activities       = e.expert_activity_experience?.map(a => a.activity_types?.name).filter(Boolean) ?? []
  const roles            = e.expert_role_fit?.map(r => r.work_order_roles?.name).filter(Boolean) ?? []

  const adminBtn = isAdmin
    ? `<div class="pt-4 border-t border-gray-100 flex items-center gap-3">
         <a href="admin/experts.html?edit=${esc(e.id)}"
            class="inline-flex items-center gap-1.5 text-sm text-blue-700 hover:text-blue-900 font-medium">
           <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
             <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
               d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
           </svg>
           Edit Expert
         </a>
       </div>`
    : ''

  const cvBtn = e.cv_storage_path
    ? `<div class="pt-4 border-t border-gray-100">
         <button onclick="downloadCV('${esc(e.cv_storage_path)}')"
           class="inline-flex items-center gap-2 text-sm font-semibold text-white
                  bg-blue-800 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors">
           <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
             <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
               d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0
                  0013 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/>
             <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
               d="M9 13h6m-3-3v6"/>
           </svg>
           ${t('download_cv')}
         </button>
       </div>`
    : ''

  document.getElementById('modal-content').innerHTML = `
<div class="space-y-5">

  <div>
    <div class="flex flex-wrap items-center gap-2 mb-2">
      <span class="text-xs font-medium px-2 py-0.5 rounded-full ${AFFIL_COLOR[e.affiliation_type]}">${AFFIL_LABEL[e.affiliation_type]}</span>
      ${e.seniority_tier ? `<span class="text-xs font-medium px-2 py-0.5 rounded-full ${SENIORITY_COLOR[e.seniority_tier]}">${SENIORITY_LABEL[e.seniority_tier]}</span>` : ''}
      <span class="text-xs text-gray-500 flex items-center gap-1">
        <span class="w-2 h-2 rounded-full ${AVAIL_DOT[e.availability_status] ?? 'bg-gray-300'}"></span>
        ${esc(t('avail_' + (e.availability_status ?? 'unknown')))}
      </span>
    </div>
    <h2 class="text-xl font-bold text-gray-900">${esc(e.full_name)}</h2>
    ${e.title         ? `<p class="text-sm text-gray-600 mt-0.5">${esc(e.title)}</p>` : ''}
    ${e.partner_org   ? `<p class="text-xs text-gray-500 mt-1">📍 ${esc(e.partner_org)}</p>` : ''}
    ${e.years_experience != null ? `<p class="text-xs text-gray-500 mt-0.5">⏱ ${t('years_exp', e.years_experience)}</p>` : ''}
  </div>

  ${e.bio_summary ? `
  <div>
    <span class="section-title">${t('modal_profile')}</span>
    <p class="text-sm text-gray-700 leading-relaxed">${esc(e.bio_summary)}</p>
  </div>` : ''}

  ${(primarySector || secondarySectors.length) ? `
  <div>
    <span class="section-title">${t('modal_sectors')}</span>
    <div class="flex flex-wrap gap-1.5">
      ${primarySector ? `<span class="tag tag-primary">${esc(primarySector)}</span>` : ''}
      ${secondarySectors.map(s => `<span class="tag">${esc(s)}</span>`).join('')}
    </div>
  </div>` : ''}

  ${languages.length ? `
  <div>
    <span class="section-title">${t('modal_languages')}</span>
    <div class="flex flex-wrap gap-1.5">
      ${languages.map(l => `
        <span class="tag">
          ${esc(l.languages?.name ?? '')}
          ${l.proficiency ? `<span class="opacity-50 ml-1">${esc(t('prof_' + l.proficiency))}</span>` : ''}
        </span>`).join('')}
    </div>
  </div>` : ''}

  ${geos.length ? `
  <div>
    <span class="section-title">${t('modal_geo')}</span>
    <div class="flex flex-wrap gap-1.5">
      ${geos.map(g => `<span class="tag">${esc(g)}</span>`).join('')}
    </div>
  </div>` : ''}

  ${donors.length ? `
  <div>
    <span class="section-title">${t('modal_donors')}</span>
    <div class="space-y-2">
      ${donors.map(d => `
        <div class="bg-gray-50 rounded-lg px-3 py-2">
          <p class="text-sm font-semibold text-gray-800">${esc(d.donors?.name ?? '')}</p>
          ${d.notes ? `<p class="text-xs text-gray-500 mt-0.5 leading-relaxed">${esc(d.notes)}</p>` : ''}
        </div>`).join('')}
    </div>
  </div>` : ''}

  ${eduItems.length ? `
  <div>
    <span class="section-title">${t('modal_education')}</span>
    <div class="space-y-2">
      ${eduItems.filter(ed => ed.type === 'education').map(ed => `
        <div class="flex gap-2.5 items-start">
          <span class="text-blue-500 mt-0.5">🎓</span>
          <div>
            <p class="text-sm font-medium text-gray-800">${esc(ed.title)}</p>
            ${ed.institution ? `<p class="text-xs text-gray-500">${esc(ed.institution)}${ed.year ? ` · ${ed.year}` : ''}</p>` : ''}
          </div>
        </div>`).join('')}
      ${eduItems.filter(ed => ed.type === 'certification').map(ed => `
        <div class="flex gap-2.5 items-start">
          <span class="text-amber-500 mt-0.5">🏅</span>
          <div>
            <p class="text-sm font-medium text-gray-800">${esc(ed.title)}</p>
            ${ed.institution ? `<p class="text-xs text-gray-500">${esc(ed.institution)}${ed.year ? ` · ${ed.year}` : ''}</p>` : ''}
          </div>
        </div>`).join('')}
    </div>
  </div>` : ''}

  ${activities.length ? `
  <div>
    <span class="section-title">${t('modal_activities')}</span>
    <div class="flex flex-wrap gap-1.5">
      ${activities.map(a => `<span class="tag">${esc(a)}</span>`).join('')}
    </div>
  </div>` : ''}

  ${roles.length ? `
  <div>
    <span class="section-title">${t('modal_roles')}</span>
    <div class="flex flex-wrap gap-1.5">
      ${roles.map(r => `<span class="tag tag-role">${esc(r)}</span>`).join('')}
    </div>
  </div>` : ''}

  ${adminBtn}
  ${cvBtn}
</div>`

  document.getElementById('modal').classList.remove('hidden')
  document.body.style.overflow = 'hidden'
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden')
  document.body.style.overflow = ''
}

async function downloadCV(storagePath) {
  const { data, error } = await sb.storage.from('expert-cvs').createSignedUrl(storagePath, 120)
  if (error) { alert(t('cv_error') + error.message); return }
  window.open(data.signedUrl, '_blank')
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function populateSelect(id, items, key) {
  const sel = document.getElementById(id)
  items.forEach(item => {
    const opt = document.createElement('option')
    opt.value = item[key]
    opt.textContent = item[key]
    sel.appendChild(opt)
  })
}

function clearFilters() {
  ;['f-affiliation','f-seniority','f-sector','f-geography',
    'f-language','f-donor','f-role','f-availability'].forEach(id => {
    document.getElementById(id).value = ''
  })
  document.getElementById('search-input').value = ''
  renderFiltered()
}

function setLoading(on) {
  document.getElementById('loading-indicator').classList.toggle('hidden', !on)
}

function debounce(fn, ms) {
  let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms) }
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── Start ─────────────────────────────────────────────────────────────────────

init().catch(err => {
  document.body.innerHTML = `
    <div class="min-h-screen flex items-center justify-center">
      <div class="text-center">
        <p class="text-red-600 font-semibold">${t('load_error')}</p>
        <p class="text-gray-500 text-sm mt-1">${esc(err.message)}</p>
      </div>
    </div>`
})
