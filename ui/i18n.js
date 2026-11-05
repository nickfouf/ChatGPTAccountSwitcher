import {languages,resolveLanguage,direction} from './languages';
export {languages,resolveLanguage,direction};
const catalogues = import.meta.glob('./locales/*.json', {eager:true,import:'default'});
export const copy = Object.fromEntries(Object.entries(catalogues).map(([path,messages])=>[
  path.split('/').pop().replace('.json',''),messages,
]));
export function translate(language,key,values={}) {
  const message=copy[language]?.[key] ?? copy.en[key] ?? key;
  return message.replace(/\{(\w+)\}/g,(placeholder,name)=>Object.hasOwn(values,name)?String(values[name]):placeholder);
}
export function readPreference(key,fallback){try{return localStorage.getItem(key)||fallback;}catch{return fallback;}}
export function savePreference(key,value){try{localStorage.setItem(key,value);}catch{}}
