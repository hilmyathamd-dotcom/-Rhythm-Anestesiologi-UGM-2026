// Shared patient data between tools (same browser only).
// Data expires after 30 minutes so an old patient is not carried into a new case.
(function () {
    const KEY = 'atb_patient';
    const TTL_MS = 30 * 60 * 1000;

    function read(raw) {
        try {
            const p = JSON.parse(raw);
            if (!p || !p.t || Date.now() - p.t > TTL_MS) return null;
            return p;
        } catch (e) { return null; }
    }

    window.PatientStore = {
        get() {
            try { return read(localStorage.getItem(KEY)); } catch (e) { return null; }
        },
        set(fields) {
            try {
                const cur = read(localStorage.getItem(KEY)) || {};
                const next = Object.assign({}, cur, fields, { t: Date.now() });
                localStorage.setItem(KEY, JSON.stringify(next));
            } catch (e) {}
        },
        clear() {
            try { localStorage.removeItem(KEY); } catch (e) {}
        },
        // Fires when another open tool updates the patient
        onChange(cb) {
            window.addEventListener('storage', (e) => {
                if (e.key !== KEY) return;
                const p = e.newValue ? read(e.newValue) : null;
                cb(p);
            });
        }
    };
})();
