import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import styles from './SceneInfoBar.module.css';
export default function SceneInfoBar({ sceneInfo }) {
    return (_jsxs("div", { className: styles.bar, "aria-label": "Scene information panel", children: [_jsxs("span", { className: styles.field, children: [_jsx("span", { className: styles.label, children: "SN:" }), _jsx("span", { className: styles.value, children: sceneInfo.serialNumber })] }), _jsxs("span", { className: styles.field, children: [_jsx("span", { className: styles.label, children: "BATT:" }), _jsx("span", { className: styles.value, children: sceneInfo.batteryCount })] }), sceneInfo.indicators.map(ind => (_jsx("span", { className: `${styles.indicator} ${ind.lit ? styles.lit : styles.unlit}`, title: ind.lit ? `${ind.label} (lit)` : `${ind.label} (unlit)`, children: ind.label }, ind.label)))] }));
}
