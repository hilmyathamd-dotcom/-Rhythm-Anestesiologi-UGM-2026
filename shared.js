// Shared between the clinical tabs (same browser only):
//   PatientStore   one patient record, expires after 30 minutes so an old patient is not carried into a new case
//   ClinicalParser reads pasted WhatsApp / EMR / analyzer text into patient fields + lab values
//   QuickFill      the paste box at the top of every clinical tab; the pasted text itself is shared too
//
// Patient record (localStorage 'atb_patient'):
// {
//   t,                                    last update (ms) - used for the 30 min expiry
//   weight, height, ageYear, ageMonth,    patient (Neopad, Continuous)
//   gender, hctInit, ppHours,             patient (Neopad)
//   labs: { ph, pco2, hco3, na, cl, alb, lac, po2, fio2, be, gluc, bun, osmo, temp },   (BGA)
//   raw,                                  the pasted text, shown in every tab's paste box
//   pasteId                               changes on every paste, so a tab knows new text arrived
// }
(function () {
    const KEY = 'atb_patient';
    const TTL_MS = 30 * 60 * 1000;

    // ================= PATIENT STORE =================
    function read(raw) {
        try {
            const p = JSON.parse(raw);
            if (!p || !p.t || Date.now() - p.t > TTL_MS) return null;
            return p;
        } catch (e) { return null; }
    }

    const PatientStore = {
        get() {
            try {
                const raw = localStorage.getItem(KEY);
                const p = read(raw);
                if (!p && raw) localStorage.removeItem(KEY);   // expired: delete it, including the pasted text
                return p;
            } catch (e) { return null; }
        },
        set(fields) {
            try {
                const cur = read(localStorage.getItem(KEY)) || {};
                const next = Object.assign({}, cur, fields, { t: Date.now() });
                localStorage.setItem(KEY, JSON.stringify(next));
                return next;
            } catch (e) { return Object.assign({}, fields); }
        },
        clear() {
            try { localStorage.removeItem(KEY); } catch (e) {}
        },
        // Fires when another open tab/tool updates the patient
        onChange(cb) {
            window.addEventListener('storage', (e) => {
                if (e.key !== KEY) return;
                cb(e.newValue ? read(e.newValue) : null);
            });
        }
    };

    // ================= PARSER =================
    // Several patients pasted at once (WhatsApp handover)? Use only the first one.
    // A patient header looks like "Nama/P/49th/..." or "Nama/L/4 th 9 bln/...".
    function firstPatient(text) {
        const lines = text.split(/\r?\n/);
        const headerIdx = lines.map((l, i) => /\/\s*[LP]\s*\//i.test(l) ? i : -1).filter(i => i >= 0);
        if (headerIdx.length >= 2) return { text: lines.slice(0, headerIdx[1]).join('\n'), multi: headerIdx.length };
        return { text, multi: 0 };
    }

    // Patient: weight (kg / g), height (cm), age (tahun/bulan/minggu/hari), gender, Hct, puasa (jam).
    function parsePatient(text) {
        const out = {};
        // Clean WhatsApp formatting: *bold*, _italic_, emoji arrows, decimal commas
        const clean = text
            .replace(/[*_~]/g, ' ')
            .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}‍️]/gu, ' ')
            .replace(/(\d),(\d)/g, '$1.$2');
        const s = ' ' + clean.toLowerCase() + ' ';
        const N = '(\\d+(?:\\.\\d+)?)';
        let m;

        // Weight: "12.5 kg", "BB 12.5", "BB: 12,5", "2800 gr"
        if ((m = s.match(new RegExp('\\b(?:bb|berat(?:\\s*badan)?|bw|wt)\\s*[:=]?\\s*' + N + '\\s*(?:kg)?(?![\\d.]|\\s*(?:g|gr|gram)\\b)')))) out.weight = parseFloat(m[1]);
        else if ((m = s.match(new RegExp(N + '\\s*(?:kg|kgbb|kilo)\\b')))) out.weight = parseFloat(m[1]);
        else if ((m = s.match(new RegExp(N + '\\s*(?:g|gr|gram)\\b(?!\\s*\\/)')))) out.weight = parseFloat(m[1]) / 1000;
        if (out.weight !== undefined) out.weight = +out.weight.toFixed(2);

        // Height: "TB 88", "PB 50", "88 cm" (labelled value preferred over any stray "cm")
        if ((m = s.match(new RegExp('\\b(?:tb|pb|tinggi(?:\\s*badan)?|panjang(?:\\s*badan)?)\\s*[:=]?\\s*' + N)))) out.height = parseFloat(m[1]);
        else if ((m = s.match(new RegExp(N + '\\s*cm\\b')))) out.height = parseFloat(m[1]);

        // Age: header "/49th/" or "/4 th 9 bln/" first, then anywhere
        const ageSrc = (s.match(/\/\s*[lp]\s*\/([^\/\n]{1,25})\//) || [])[1] || s;
        let years = null, months = null;
        if ((m = ageSrc.match(new RegExp(N + '\\s*(?:tahun|thn|th|yo|y\\.?o\\.?|yrs?|years?|y)\\b')))) years = parseFloat(m[1]);
        if ((m = ageSrc.match(new RegExp(N + '\\s*(?:bulan|bln|bl|mo|mos|months?|mth)\\b')))) months = parseFloat(m[1]);
        if (years === null && months === null && (m = ageSrc.match(new RegExp(N + '\\s*(?:minggu|mgg|wk|wks|weeks?)\\b')))) months = parseFloat(m[1]) * 7 / 30.44;
        if (years === null && months === null && (m = ageSrc.match(new RegExp(N + '\\s*(?:hari|days?)\\b')))) months = parseFloat(m[1]) / 30.44;
        if (years === null && months === null && (m = s.match(new RegExp('\\b(?:usia|umur|age)\\s*[:=]?\\s*' + N)))) years = parseFloat(m[1]);
        if (years !== null || months !== null) {
            let total = (years || 0) * 12 + (months || 0);
            total = Math.round(total * 10) / 10;
            out.ageYear = Math.floor(total / 12);
            out.ageMonth = Math.floor(total - out.ageYear * 12);
        }

        // Gender: header "/P/" or "/L/" first, then words
        const sg = s.replace(/\bby\.?\s*ny\.?\s/g, ' by ');   // "By. Ny X" = baby of Mrs X, not female
        if ((m = s.match(/\/\s*([lp])\s*\//))) out.gender = m[1] === 'l' ? 'male' : 'female';
        else if (/\b(?:perempuan|wanita|female|girl)\b|\b(?:ny|nn|nona)\.?\s/.test(sg)) out.gender = 'female';
        else if (/\b(?:laki(?:-laki)?|pria|male|boy)\b|\btn\.?\s/.test(sg)) out.gender = 'male';
        else if ((m = sg.match(/(?:^|[\s(,;])([lp])(?=[\s),;.]|$)/))) out.gender = m[1] === 'l' ? 'male' : 'female';

        // Hct: "Hb/Ht: 12.0 / 36.3" takes the second number; else "Hct 34" / "Ht 34"
        if ((m = s.match(new RegExp('\\bhb\\s*\\/\\s*h(?:c)?t\\s*[:=]?\\s*' + N + '\\s*%?\\s*\\/\\s*' + N)))) out.hctInit = parseFloat(m[2]);
        else if ((m = s.match(new RegExp('\\b(?:hct|hematokrit|ht)\\s*[:=]?\\s*' + N + '(?![\\d.]|\\s*cm)')))) out.hctInit = parseFloat(m[1]);
        if (out.hctInit !== undefined && (out.hctInit < 10 || out.hctInit > 75)) delete out.hctInit;

        // Fasting: "Puasa ... 8 jam" preferred, else first "N jam"
        if ((m = s.match(new RegExp('\\bpuasa[^\\n]{0,60}?' + N + '\\s*(?:jam|hours?|hrs?)\\b')))) out.ppHours = parseFloat(m[1]);
        else if ((m = s.match(new RegExp('\\b(?:puasa|pp)\\s*[:=]?\\s*' + N)))) out.ppHours = parseFloat(m[1]);
        else if ((m = s.match(new RegExp(N + '\\s*(?:jam|hours?|hrs?)\\b')))) out.ppHours = parseFloat(m[1]);

        return out;
    }

    // Labs / blood gas: raw EMR / analyzer text ("pH 7.32", "pCO2: 48 mmHg", tab-separated, grouped) or CSV.
    function parseLabs(text) {
        const found = {};
        const isT = {};   // remembers values that came from temperature-corrected (T) rows
        const put = (name, v, tCorr) => {
            if (found[name] === undefined || (isT[name] && !tCorr)) { found[name] = v; isT[name] = tCorr; }
        };

        // Unicode sub/superscripts from WhatsApp/EMR (FiO₂, HCO₃⁻, Na⁺) -> plain text; drop emoji
        const SUB = '₀₁₂₃₄₅₆₇₈₉', SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
        const norm = (t) => t
            .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, c => SUB.indexOf(c))
            .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, c => SUP.indexOf(c))
            .replace(/⁻/g, '-').replace(/⁺/g, '+')
            .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}‍️⬆⬇]/gu, ' ');

        const handle = (key, valStr, rawLine) => {
            const val = parseFloat(String(valStr).replace(',', '.'));
            if (isNaN(val)) return;

            const k = key.toLowerCase().replace(/[\s.]+$/g, '').replace(/\s+/g, '');
            if (k === 'parameter') return;
            const tCorr = /\(t\)/.test(k);
            const base = k.replace(/\((t|p|a|aa)\)/g, '').replace(/,c$/, '');
            const unit = rawLine.toLowerCase();

            if (base === 'ph') put('ph', val, tCorr);
            else if (base === 'pco2' || base === 'paco2') put('pco2', /kpa/.test(unit) ? val * 7.5 : val, tCorr);
            else if (base === 'po2' || base === 'pao2') put('po2', /kpa/.test(unit) ? val * 7.5 : val, tCorr);
            else if (base.includes('hco3') || base.includes('bicarb')) {
                if (/\(st\)|std|standard|sbc/.test(base)) return;            // standard bicarbonate ignored
                if (/act|^chco3/.test(base) || base === 'actualbicarbonate') put('hco3_act', val, false);
                else put('hco3_gen', val, false);
            }
            else if (/^(c?na\+?|sodium|natrium)$/.test(base)) put('na', val, false);
            else if (/^(c?cl-?|chloride|klorida)$/.test(base)) put('cl', val, false);
            else if (base.includes('albumin') || base === 'alb') put('alb', /g\/l/.test(unit) && val > 10 ? val / 10 : val, false);
            else if (base.includes('lact') || base === 'clac' || base === 'lac' || base === 'laktat') put('lac', /mg\/dl/.test(unit) ? val / 9 : val, false);
            else if (base.includes('fio2')) put('fio2', val, false);
            else if (/^(be|be\(b\)|abe|cbase\(b\)|baseexcess(\(b\))?)$/.test(base)) put('be', val, false);
            else if (/^(beecf|be\(ecf\)|sbe|cbase\(ecf\)|baseexcess\(ecf\))$/.test(base)) { if (found.be === undefined) found.be_ecf = val; }
            else if (base.includes('glu') || base === 'gds' || base === 'guladarah') put('gluc', /mmol/.test(unit) ? val * 18 : val, false);
            else if (base === 'bun') put('bun', /mmol/.test(unit) ? val * 2.8 : val, false);
            else if (base === 'urea' || base === 'ureum') put('bun', /mmol/.test(unit) ? val * 2.8 : val / 2.14, false);
            else if (base.includes('osmol') && (base.includes('meas') || base.includes('ukur'))) put('osmo', val, false);
            else if (base.startsWith('temp') || base === 't' || base === 'suhu') put('temp', val, false);
        };

        text.split(/\r?\n/).forEach(rawLine0 => {
            const rawLine = norm(rawLine0);
            const line = rawLine.replace(/[*#]/g, '').trim();
            if (!line) return;

            // Grouped values: "Na/K/Cl : 142 / 4.1 / 104", "BUN/Cr : 11 / 1.01"
            const g = line.match(/^([A-Za-z][^:=]*\/[^:=]*?)\s*[:=]\s*(-?\d[\d.,]*(?:\s*\/\s*-?\d[\d.,]*)+)/);
            if (g) {
                const ks = g[1].split('/'), vs = g[2].split('/');
                if (ks.length === vs.length) {
                    ks.forEach((k, i) => handle(k.trim(), vs[i].trim(), rawLine));
                    return;
                }
            }

            let key, valStr;
            if ((line.match(/,/g) || []).length >= 2 || /^[^,]+,\s*-?\d/.test(line) && !/\d,\d/.test(line)) {
                const parts = line.split(',');
                key = parts[0]; valStr = (parts[1] || '').trim();
            } else {
                const m = line.match(/^([^\d\-\s][^:=\t]*?)\s*(?:[:=\t]|\s)\s*(-?\d+(?:[.,]\d+)?)/);
                if (!m) return;
                key = m[1]; valStr = m[2];
            }
            handle(key, valStr, rawLine);
        });
        if (found.be === undefined && found.be_ecf !== undefined) found.be = found.be_ecf;

        // Normalise to the record's lab fields
        const labs = {};
        const hco3 = found.hco3_act !== undefined ? found.hco3_act : found.hco3_gen;
        const src = { ph: found.ph, pco2: found.pco2, hco3, na: found.na, cl: found.cl, alb: found.alb, lac: found.lac,
                      po2: found.po2, be: found.be, gluc: found.gluc, bun: found.bun, osmo: found.osmo, temp: found.temp,
                      fio2: found.fio2 !== undefined ? (found.fio2 > 1 ? found.fio2 / 100 : found.fio2) : undefined };
        Object.keys(src).forEach(k => { if (src[k] !== undefined && isFinite(src[k])) labs[k] = +(+src[k]).toFixed(3); });
        return labs;
    }

    const ClinicalParser = {
        parse(text) {
            const fp = firstPatient(text || '');
            return { patient: parsePatient(fp.text), labs: parseLabs(fp.text), multi: fp.multi };
        }
    };

    // ================= QUICK-FILL BOX =================
    const LAB_LABEL = { ph: 'pH', pco2: 'PaCO₂', hco3: 'HCO₃', na: 'Na', cl: 'Cl', alb: 'Alb', lac: 'Laktat', po2: 'PaO₂',
                        fio2: 'FiO₂', be: 'BE', gluc: 'GDS', bun: 'BUN', osmo: 'Osm', temp: 'Suhu' };

    function injectCss() {
        if (document.getElementById('qf-css')) return;
        const st = document.createElement('style');
        st.id = 'qf-css';
        st.textContent = `
            .qf-box { background:#eaf4fc; border:1px solid #b6d9f2; border-radius:6px; padding:12px; margin-bottom:12px; box-sizing:border-box; }
            .qf-box .qf-label { display:block; font-weight:600; font-size:0.85rem; margin:0 0 5px; color:#2c3e50; text-transform:none; }
            .qf-box .qf-text { width:100%; height:auto; box-sizing:border-box; min-height:48px; padding:8px; border:1px solid #bdc3c7;
                               border-radius:4px; font-size:16px; font-family:inherit; resize:vertical; background:#fff; }
            .qf-row { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-top:6px; flex-wrap:wrap; }
            .qf-chips { display:flex; flex-wrap:wrap; gap:4px; }
            .qf-chip { background:#fff; border:1px solid #a3c9e8; color:#2c3e50; border-radius:12px; padding:2px 8px; font-size:0.8rem; }
            .qf-chip.lab { border-color:#c3b5e3; }
            .qf-chip.none { border-color:#ddd; color:#999; }
            .qf-chip.warn { border-color:#f0b27a; background:#fdf2e9; color:#a04000; }
            .qf-box .qf-clear { background:none; border:1px solid #bdc3c7; border-radius:4px; padding:4px 10px; font-size:0.8rem;
                                color:#555; cursor:pointer; margin:0; width:auto; }
            .qf-flash { animation: qfFlash 1s ease-out; }
            @keyframes qfFlash { from { background:#fff3b0; } to { background:#fff; } }`;
        document.head.appendChild(st);
    }

    function chipsHtml(text) {
        if (!text || !text.trim()) return '<span class="qf-chip none">Belum ada data terbaca</span>';
        const r = ClinicalParser.parse(text), p = r.patient, chips = [];
        if (p.weight !== undefined) chips.push(`BB ${p.weight} kg`);
        if (p.height !== undefined) chips.push(`TB ${p.height} cm`);
        if (p.ageYear !== undefined) chips.push(`Usia ${p.ageYear} th ${p.ageMonth} bln`);
        if (p.gender) chips.push(p.gender === 'male' ? 'Laki-laki' : 'Perempuan');
        if (p.hctInit !== undefined) chips.push(`Hct ${p.hctInit}%`);
        if (p.ppHours !== undefined) chips.push(`Puasa ${p.ppHours} jam`);
        let html = chips.map(c => `<span class="qf-chip">✓ ${c}</span>`).join('');
        html += Object.keys(r.labs).map(k => `<span class="qf-chip lab">✓ ${LAB_LABEL[k]} ${r.labs[k]}</span>`).join('');
        if (!html) html = '<span class="qf-chip none">Belum ada data terbaca</span>';
        if (r.multi) html += `<span class="qf-chip warn">⚠ ${r.multi} pasien terdeteksi, hanya pasien pertama dipakai</span>`;
        return html;
    }

    const QuickFill = {
        // Renders the shared paste box into `host`. opts.onPaste(record) runs after each paste/typing in this tab;
        // other tabs receive the same record through PatientStore.onChange.
        mount(host, opts) {
            opts = opts || {};
            injectCss();
            host.innerHTML = `
                <div class="qf-box">
                    <label class="qf-label" for="qfInput">Isi cepat: paste data pasien / hasil lab (dipakai di semua tab)</label>
                    <textarea id="qfInput" class="qf-text" rows="2" placeholder="Contoh: An. L, 2 th 3 bln, BB 12,5 kg, TB 88 cm, Hct 34, puasa 6 jam&#10;atau hasil BGA: pH 7.32 / pCO2 48 / HCO3 21.5 / Na 138 ...&#10;Diproses di perangkat ini saja, terhapus otomatis setelah 30 menit."></textarea>
                    <div class="qf-row">
                        <div class="qf-chips"></div>
                        <button type="button" class="qf-clear">Hapus</button>
                    </div>
                </div>`;
            const ta = host.querySelector('.qf-text'), chips = host.querySelector('.qf-chips');
            const show = () => { chips.innerHTML = chipsHtml(ta.value); };

            const cur = PatientStore.get();
            if (cur && cur.raw) ta.value = cur.raw;
            show();

            ta.addEventListener('input', () => {
                const r = ClinicalParser.parse(ta.value);
                const rec = PatientStore.set(Object.assign({}, r.patient, { labs: r.labs, raw: ta.value, pasteId: Date.now() }));
                show();
                if (opts.onPaste) opts.onPaste(rec);
            });
            host.querySelector('.qf-clear').addEventListener('click', () => {
                ta.value = '';
                PatientStore.set({ raw: '' });   // clears the text in every tab; filled values stay
                show();
            });
            PatientStore.onChange((p) => {
                if (document.activeElement === ta) return;
                ta.value = p && p.raw ? p.raw : '';
                show();
            });
        },

        // Put a value into an input; flashes it when it changes. null/NaN -> empty, undefined -> leave alone.
        setField(el, v) {
            if (typeof el === 'string') el = document.getElementById(el);
            if (!el || v === undefined) return;
            const s = (v === null || (typeof v === 'number' && !isFinite(v))) ? '' : String(v);
            if (el.value === s) return;
            el.value = s;
            if (el.tagName !== 'SELECT') { el.classList.remove('qf-flash'); void el.offsetWidth; el.classList.add('qf-flash'); }
        }
    };

    window.PatientStore = PatientStore;
    window.ClinicalParser = ClinicalParser;
    window.QuickFill = QuickFill;
})();
