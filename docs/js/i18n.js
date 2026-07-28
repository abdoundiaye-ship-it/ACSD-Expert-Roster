'use strict'

// ── Shared EN/FR i18n module ────────────────────────────────────────────────
// Single source of truth for the platform's bilingual strings. Replaces the
// two previously-separate, inconsistent systems (login.html's inline
// LOGIN_STRINGS, app.js's own STRINGS/applyI18n) with one module every page
// loads. Language choice now persists via localStorage so it carries across
// pages instead of silently resetting to English on every navigation.

const I18N_STORAGE_KEY = 'acsd_lang'

const I18N_STRINGS = {
  en: {
    // ── Shared chrome ──
    logout_btn:      'Sign out',
    admin_badge:      'Admin',
    admin_panel:      'Admin Panel',
    reports:          'Reports',
    back_to_roster:   '← Back to Roster',

    // ── Public roster (index.html) ──
    header_subtitle:    'Expert Roster for Work Orders',
    filters_title:      'Filters',
    clear_filters:      'Reset',
    label_affiliation:  'Affiliation',
    opt_all:             'All',
    opt_internal:        'Core (Internal)',
    opt_partner:         'Partner',
    label_seniority:    'Level',
    label_sector:       'Sector',
    label_geography:    'Country',
    label_language:     'Language',
    label_donor:        'Donor',
    label_role:         'Assignment Type',
    label_availability: 'Availability',
    opt_available:       'Available',
    opt_assigned:         'On Assignment',
    opt_unavailable:      'Unavailable',
    opt_unknown:          'Not specified',
    search_placeholder:  'Search by name, title, bio…',
    loading:             'Loading…',
    empty_title:         'No experts found',
    empty_sub:           'Try adjusting your filters or search.',
    avail_available:     'Available',
    avail_assigned:      'On Assignment',
    avail_unavailable:   'Unavailable',
    avail_unknown:       'Not specified',
    prof_native:         'Native',
    prof_fluent:         'Fluent',
    prof_professional:   'Professional',
    prof_working:        'Working',
    count_all:           n => `${n} expert${n !== 1 ? 's' : ''}`,
    count_filtered:      (s, tot) => `${s} of ${tot} expert${tot !== 1 ? 's' : ''}`,
    years_exp:           n => `${n} year${n !== 1 ? 's' : ''} of experience`,
    download_cv:         'Open CV',
    cv_error:            'Unable to retrieve CV file: ',
    load_error:          'Loading failed',
    modal_profile:       'Profile',
    modal_sectors:       'Sectors',
    modal_languages:     'Languages',
    modal_geo:           'Geographic Experience',
    modal_donors:        'Donors',
    modal_education:     'Education &amp; Certifications',
    modal_activities:    'Activity Types',
    modal_roles:         'Assignment Types',
    seniority_principal_expert: 'Principal Expert',
    seniority_senior:            'Senior',
    seniority_intermediary:      'Intermediary',
    seniority_junior:            'Junior',
    affil_internal:      'Core',
    affil_partner:       'Partner',
    edit_expert:         'Edit Expert',

    // ── Login ──
    login_subtitle: 'Expert Roster & Proposal Intelligence',
    login_email:    'Email address',
    login_password: 'Password',
    login_signin:   'Sign in',
    login_signing:  'Signing in…',
    login_email_ph: 'you@example.com',
    login_forgot:   'Forgot password?',

    // ── Reset / update password ──
    reset_title:        'Reset Password',
    reset_sub:           'Enter your email to receive a reset link.',
    reset_btn:            'Send Reset Link',
    reset_sending:        'Sending…',
    reset_success:        'Check your email — a password reset link has been sent.',
    reset_back:           '← Back to Sign In',
    update_title:        'Set New Password',
    update_sub:           'Choose a strong password for your account.',
    update_new_pw:        'New Password',
    update_min_chars:     '(min. 8 characters)',
    update_confirm_pw:    'Confirm Password',
    update_btn:           'Update Password',
    update_updating:      'Updating…',
    update_success:       'Password updated successfully.',
    update_signin:        'Sign In',
    update_invalid_link:  'This link is invalid or has expired. Please request a new password reset.',
    update_request_new:   'Request new link',
    update_pw_too_short:  'Password must be at least 8 characters.',
    update_pw_mismatch:   'Passwords do not match.',

    // ── Admin nav ──
    nav_dashboard:        'Dashboard',
    nav_experts:          'Experts',
    nav_ask:               'Ask ACSD Intelligence',
    nav_opportunities:    'Opportunities',
    nav_sources:           'Intelligence Sources',
    nav_knowledge_base:    'Knowledge Base',
    nav_lessons_learned:   'Lessons Learned',
    nav_users:             'Users',
    nav_roles:             'Roles & Permissions',
    nav_audit:             'Audit Logs',
    nav_reports:           'Reports',
    nav_group_roster:       'Roster',
    nav_group_opportunities: 'Opportunities',
    nav_group_admin:         'Administration',
  },
  fr: {
    logout_btn:      'Déconnexion',
    admin_badge:      'Admin',
    admin_panel:      "Panneau d'administration",
    reports:          'Rapports',
    back_to_roster:   "← Retour au fichier d'experts",

    header_subtitle:    "Fichier d'experts pour ordres de travail",
    filters_title:      'Filtres',
    clear_filters:      'Réinitialiser',
    label_affiliation:  'Affiliation',
    opt_all:             'Tous',
    opt_internal:        'Core (Interne)',
    opt_partner:         'Partenaire',
    label_seniority:    'Niveau',
    label_sector:       'Secteur',
    label_geography:    'Pays',
    label_language:     'Langue',
    label_donor:        'Bailleur',
    label_role:         'Type de mission',
    label_availability: 'Disponibilité',
    opt_available:       'Disponible',
    opt_assigned:         'En mission',
    opt_unavailable:      'Indisponible',
    opt_unknown:          'Non renseigné',
    search_placeholder:  'Rechercher par nom, titre, biographie…',
    loading:             'Chargement…',
    empty_title:         'Aucun expert trouvé',
    empty_sub:           'Essayez de modifier vos filtres ou votre recherche.',
    avail_available:     'Disponible',
    avail_assigned:      'En mission',
    avail_unavailable:   'Indisponible',
    avail_unknown:       'Non renseigné',
    prof_native:         'Natif',
    prof_fluent:         'Courant',
    prof_professional:   'Professionnel',
    prof_working:        'Opérationnel',
    count_all:           n => `${n} expert${n !== 1 ? 's' : ''}`,
    count_filtered:      (s, tot) => `${s} sur ${tot} expert${tot !== 1 ? 's' : ''}`,
    years_exp:           n => `${n} an${n !== 1 ? 's' : ''} d'expérience`,
    download_cv:         'Ouvrir le CV',
    cv_error:            'Impossible de récupérer le fichier CV : ',
    load_error:          'Erreur de chargement',
    modal_profile:       'Profil',
    modal_sectors:       'Secteurs',
    modal_languages:     'Langues',
    modal_geo:           'Expérience géographique',
    modal_donors:        'Bailleurs',
    modal_education:     'Formation &amp; Certifications',
    modal_activities:    'Types de livrables',
    modal_roles:         'Types de mission',
    seniority_principal_expert: 'Expert Principal',
    seniority_senior:            'Senior',
    seniority_intermediary:      'Intermédiaire',
    seniority_junior:            'Junior',
    affil_internal:      'Core',
    affil_partner:       'Partenaire',
    edit_expert:         "Modifier l'expert",

    login_subtitle: "Fichier d'experts & intelligence des propositions",
    login_email:    'Adresse e-mail',
    login_password: 'Mot de passe',
    login_signin:   'Se connecter',
    login_signing:  'Connexion…',
    login_email_ph: 'vous@example.com',
    login_forgot:   'Mot de passe oublié ?',

    reset_title:        'Réinitialiser le mot de passe',
    reset_sub:           'Saisissez votre e-mail pour recevoir un lien de réinitialisation.',
    reset_btn:            'Envoyer le lien',
    reset_sending:        'Envoi…',
    reset_success:        'Vérifiez votre boîte mail — un lien de réinitialisation a été envoyé.',
    reset_back:           '← Retour à la connexion',
    update_title:        'Définir un nouveau mot de passe',
    update_sub:           'Choisissez un mot de passe robuste pour votre compte.',
    update_new_pw:        'Nouveau mot de passe',
    update_min_chars:     '(min. 8 caractères)',
    update_confirm_pw:    'Confirmer le mot de passe',
    update_btn:           'Mettre à jour le mot de passe',
    update_updating:      'Mise à jour…',
    update_success:       'Mot de passe mis à jour avec succès.',
    update_signin:        'Se connecter',
    update_invalid_link:  'Ce lien est invalide ou a expiré. Veuillez demander une nouvelle réinitialisation.',
    update_request_new:   'Demander un nouveau lien',
    update_pw_too_short:  'Le mot de passe doit contenir au moins 8 caractères.',
    update_pw_mismatch:   'Les mots de passe ne correspondent pas.',

    nav_dashboard:        'Tableau de bord',
    nav_experts:          'Experts',
    nav_ask:               'Ask ACSD Intelligence',
    nav_opportunities:    'Opportunités',
    nav_sources:           'Sources de veille',
    nav_knowledge_base:    'Base de connaissances',
    nav_lessons_learned:   'Enseignements tirés',
    nav_users:             'Utilisateurs',
    nav_roles:             'Rôles & permissions',
    nav_audit:             "Journaux d'audit",
    nav_reports:           'Rapports',
    nav_group_roster:       'Vivier',
    nav_group_opportunities: 'Opportunités',
    nav_group_admin:         'Administration',
  },
}

function i18nGetSavedLang() {
  try {
    const saved = localStorage.getItem(I18N_STORAGE_KEY)
    if (saved === 'en' || saved === 'fr') return saved
  } catch (_) { /* localStorage unavailable (private browsing, etc.) — default to English */ }
  return 'en'
}

window.LANG = i18nGetSavedLang()

function t(key, ...args) {
  const lang = window.LANG || 'en'
  const s = (I18N_STRINGS[lang] || I18N_STRINGS.en)[key] ?? I18N_STRINGS.en[key] ?? key
  return typeof s === 'function' ? s(...args) : s
}

// variant: 'dark' (default, for navy header bars) or 'light' (for white-card
// pages like login.html) — only affects which Tailwind classes mark the
// active button, since those pages sit on different backgrounds.
function applyI18n(root = document) {
  const lang = window.LANG || 'en'
  const strings = I18N_STRINGS[lang] || I18N_STRINGS.en

  root.querySelectorAll('[data-i18n]').forEach(el => {
    const val = strings[el.dataset.i18n]
    if (typeof val === 'string') el.textContent = val
  })
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const val = strings[el.dataset.i18nPlaceholder]
    if (typeof val === 'string') el.placeholder = val
  })
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    const val = strings[el.dataset.i18nTitle]
    if (typeof val === 'string') el.title = val
  })

  root.querySelectorAll('.lang-btn').forEach(btn => {
    const active = btn.dataset.lang === lang
    const variant = btn.closest('[data-lang-variant]')?.dataset.langVariant || 'dark'
    if (variant === 'light') {
      btn.classList.toggle('bg-blue-900', active)
      btn.classList.toggle('text-white', active)
      btn.classList.toggle('text-gray-400', !active)
    } else {
      btn.classList.toggle('bg-blue-800', active)
      btn.classList.toggle('text-white', active)
      btn.classList.toggle('text-blue-300', !active)
    }
  })

  document.documentElement.lang = lang
}

function setLang(lang) {
  window.LANG = lang
  try { localStorage.setItem(I18N_STORAGE_KEY, lang) } catch (_) { /* ignore — nothing to persist to */ }
  applyI18n()
  document.dispatchEvent(new CustomEvent('acsd:langchange', { detail: { lang } }))
}

// Builds a standalone EN/FR toggle and inserts it before `beforeEl` — used by
// pages/scripts that don't already have hand-authored toggle markup of their
// own (the admin shell, reports.html).
function i18nInsertToggle(beforeEl, variant = 'dark') {
  if (!beforeEl || !beforeEl.parentElement) return
  const wrap = document.createElement('div')
  wrap.dataset.langVariant = variant
  wrap.className = 'flex items-center gap-1 text-xs border rounded-md overflow-hidden flex-shrink-0 ' +
    (variant === 'light' ? 'border-gray-300' : 'border-blue-700')
  wrap.innerHTML = `
    <button type="button" class="lang-btn px-2 py-1 transition-colors" data-lang="en" onclick="setLang('en')">EN</button>
    <button type="button" class="lang-btn px-2 py-1 transition-colors" data-lang="fr" onclick="setLang('fr')">FR</button>`
  beforeEl.parentElement.insertBefore(wrap, beforeEl)
  applyI18n()
}

applyI18n()
