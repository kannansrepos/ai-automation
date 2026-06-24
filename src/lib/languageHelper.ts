import { LanguageMap } from '../constants/configs.js';

type LanguageKey = keyof typeof LanguageMap;
type LanguageValue = (typeof LanguageMap)[LanguageKey];

const getLanguageName = (key: string): LanguageValue | undefined => {
  if (key in LanguageMap) {
    return LanguageMap[key as LanguageKey];
  }
  return undefined;
};

export { getLanguageName };
