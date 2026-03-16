export function getTodayString() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}
