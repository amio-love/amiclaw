import { useState, useCallback } from 'react';
import { getTodayString } from '@/utils/date';
/**
 * Returns manual URLs for today's daily challenge and the practice mode.
 * Tracks attempt number per day in sessionStorage.
 */
export function useDailyChallenge() {
    const today = getTodayString();
    const dailyUrl = `https://bombsquad.amio.fans/manual/${today}`;
    const practiceUrl = 'https://bombsquad.amio.fans/manual/practice';
    const key = `attempt-${today}`;
    const [attemptNumber, setAttemptNumber] = useState(() => parseInt(sessionStorage.getItem(key) ?? '0', 10));
    const incrementAttempt = useCallback(() => {
        setAttemptNumber(prev => {
            const next = prev + 1;
            sessionStorage.setItem(key, String(next));
            return next;
        });
    }, [key]);
    return { practiceUrl, dailyUrl, attemptNumber, incrementAttempt };
}
