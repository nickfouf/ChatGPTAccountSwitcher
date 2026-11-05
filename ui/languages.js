// Native names let people find their language even when the current UI is unfamiliar.
export const languages = [
  {code:'en',name:'English'}, {code:'el',name:'Ελληνικά'},
  {code:'de',name:'Deutsch'}, {code:'es',name:'Español'},
  {code:'fr',name:'Français'}, {code:'it',name:'Italiano'},
  {code:'pt-BR',name:'Português (Brasil)'}, {code:'pt-PT',name:'Português (Portugal)'},
  {code:'nl',name:'Nederlands'}, {code:'sv',name:'Svenska'},
  {code:'da',name:'Dansk'}, {code:'nb',name:'Norsk bokmål'},
  {code:'fi',name:'Suomi'}, {code:'pl',name:'Polski'},
  {code:'cs',name:'Čeština'}, {code:'hu',name:'Magyar'},
  {code:'ro',name:'Română'}, {code:'bg',name:'Български'},
  {code:'uk',name:'Українська'}, {code:'ru',name:'Русский'},
  {code:'tr',name:'Türkçe'}, {code:'ar',name:'العربية',dir:'rtl'},
  {code:'he',name:'עברית',dir:'rtl'}, {code:'fa',name:'فارسی',dir:'rtl'},
  {code:'hi',name:'हिन्दी'}, {code:'zh-CN',name:'简体中文'},
  {code:'zh-TW',name:'繁體中文'}, {code:'ja',name:'日本語'},
  {code:'ko',name:'한국어'}, {code:'id',name:'Bahasa Indonesia'},
  {code:'vi',name:'Tiếng Việt'}, {code:'th',name:'ไทย'},
];

const codes = new Set(languages.map(({code})=>code));
export const direction = code => languages.find(language=>language.code===code)?.dir || 'ltr';

export function matchLanguage(tag) {
  if (typeof tag !== 'string') return null;
  let locale;
  try { locale = new Intl.Locale(tag.replaceAll('_','-')); } catch { return null; }
  const exact = locale.baseName;
  if (codes.has(exact)) return exact;
  if (locale.language==='zh') {
    // Explicit script takes precedence over territory (e.g. zh-Hant-CN).
    return locale.maximize().script==='Hant' ? 'zh-TW' : 'zh-CN';
  }
  if (locale.language==='pt') return locale.region==='BR' ? 'pt-BR' : 'pt-PT';
  if (locale.language==='no' || locale.language==='nb') return 'nb';
  return codes.has(locale.language) ? locale.language : null;
}

export function resolveLanguage(preference='system', preferredLanguages=[]) {
  if (preference!=='system' && codes.has(preference)) return preference;
  for (const tag of preferredLanguages) {
    const match = matchLanguage(tag);
    if (match) return match;
  }
  return 'en';
}
