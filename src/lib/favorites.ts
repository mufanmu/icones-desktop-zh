const FAV_SETS_KEY = "icones_fav_collections";
const FAV_ICONS_KEY = "icones_fav_icons";

function getStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function setStored<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore storage errors */
  }
}

export function getFavCollections(): string[] {
  return getStored<string[]>(FAV_SETS_KEY, []);
}

export function saveFavCollections(sets: string[]): void {
  setStored(FAV_SETS_KEY, sets);
}

export function getFavIcons(): string[] {
  return getStored<string[]>(FAV_ICONS_KEY, []);
}

export function saveFavIcons(icons: string[]): void {
  setStored(FAV_ICONS_KEY, icons);
}
