import { jsx as _jsx } from "react/jsx-runtime";
import styles from './ProgressBar.module.css';
export default function ProgressBar({ total, completed, current }) {
    return (_jsx("div", { className: styles.bar, role: "progressbar", "aria-valuenow": completed, "aria-valuemax": total, "aria-label": `${completed} of ${total} modules complete`, children: Array.from({ length: total }, (_, i) => {
            let segClass = styles.segment;
            if (i < completed)
                segClass += ` ${styles.filled}`;
            else if (i === current)
                segClass += ` ${styles.active}`;
            return (_jsx("span", { className: segClass, "aria-label": `Module ${i + 1}: ${i < completed ? 'complete' : i === current ? 'in progress' : 'pending'}` }, i));
        }) }));
}
