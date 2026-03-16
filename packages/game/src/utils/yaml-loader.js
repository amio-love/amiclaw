import yaml from 'js-yaml';
const CACHE = new Map();
export async function loadManual(url) {
    if (CACHE.has(url))
        return CACHE.get(url);
    const res = await fetch(url, {
        headers: { Accept: 'application/yaml, text/plain' },
    });
    if (!res.ok) {
        throw new Error(`Failed to load manual: ${res.status} ${res.statusText}`);
    }
    const text = await res.text();
    const manual = yaml.load(text);
    CACHE.set(url, manual);
    return manual;
}
