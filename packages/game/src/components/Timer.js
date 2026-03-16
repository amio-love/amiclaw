import { jsx as _jsx } from "react/jsx-runtime";
import styles from './Timer.module.css';
export default function Timer({ display, isRunning }) {
    return (_jsx("div", { className: `${styles.timer} ${isRunning ? styles.running : ''}`, role: "timer", "aria-label": `Elapsed time: ${display}`, children: display }));
}
