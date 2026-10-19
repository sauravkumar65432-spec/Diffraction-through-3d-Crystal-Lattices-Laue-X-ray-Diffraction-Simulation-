/**
 * Educational Experiments, Interactive Quizzes, and Guided Lab Protocols
 */

class LabExperimentsManager {
    constructor(app) {
        this.app = app;
        this.currentLabId = 'lab1';
        this.duaneHuntData = [];
        this.mysteryTarget = null;
    }

    init() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Tab switching for experiments
        document.querySelectorAll('.lab-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const labId = btn.getAttribute('data-lab');
                this.switchLab(labId);
            });
        });

        // Lab 1 Preset Buttons
        const btnAlign001 = document.getElementById('btn-align-001');
        if (btnAlign001) btnAlign001.addEventListener('click', () => this.alignPreset('001'));

        const btnAlign110 = document.getElementById('btn-align-110');
        if (btnAlign110) btnAlign110.addEventListener('click', () => this.alignPreset('110'));

        const btnAlign111 = document.getElementById('btn-align-111');
        if (btnAlign111) btnAlign111.addEventListener('click', () => this.alignPreset('111'));

        // Lab 2 Record Data Point Button
        const btnRecordDH = document.getElementById('btn-record-dh');
        if (btnRecordDH) {
            btnRecordDH.addEventListener('click', () => this.recordDuaneHuntPoint());
        }

        const btnClearDH = document.getElementById('btn-clear-dh');
        if (btnClearDH) {
            btnClearDH.addEventListener('click', () => {
                this.duaneHuntData = [];
                this.updateDuaneHuntTable();
            });
        }

        // Lab 4 Blind Indexing Start & Check
        const btnStartMystery = document.getElementById('btn-start-mystery');
        if (btnStartMystery) {
            btnStartMystery.addEventListener('click', () => this.startMysteryChallenge());
        }

        const btnCheckMystery = document.getElementById('btn-check-mystery');
        if (btnCheckMystery) {
            btnCheckMystery.addEventListener('click', () => this.checkMysteryAnswer());
        }
    }

    switchLab(labId) {
        this.currentLabId = labId;
        document.querySelectorAll('.lab-tab-btn').forEach(btn => {
            if (btn.getAttribute('data-lab') === labId) {
                btn.classList.add('bg-sky-500/20', 'text-sky-400', 'border-sky-500/50');
                btn.classList.remove('text-slate-400');
            } else {
                btn.classList.remove('bg-sky-500/20', 'text-sky-400', 'border-sky-500/50');
                btn.classList.add('text-slate-400');
            }
        });

        document.querySelectorAll('.lab-content-pane').forEach(pane => {
            pane.classList.add('hidden');
        });

        const activePane = document.getElementById(`pane-${labId}`);
        if (activePane) activePane.classList.remove('hidden');
    }

    alignPreset(preset) {
        if (!this.app) return;
        if (preset === '001') {
            this.app.setGoniometer(0, 0, 0);
            this.showToast('Goniometer aligned: Beam along [001] (4-fold symmetry)');
        } else if (preset === '110') {
            // Rotated 45 deg around Z
            this.app.setGoniometer(45, 0, 0);
            this.showToast('Goniometer aligned: Beam along [110] (2-fold symmetry)');
        } else if (preset === '111') {
            // [111] alignment: azimuth 45, tilt 54.74 deg
            this.app.setGoniometer(45, 54.74, 0);
            this.showToast('Goniometer aligned: Beam along [111] (3-fold symmetry)');
        }
        this.validateLab1Status();
    }

    validateLab1Status() {
        const phi = Math.abs(this.app.simulator.phi % 360);
        const chi = Math.abs(this.app.simulator.chi % 360);

        const check001 = document.getElementById('check-l1-001');
        const check110 = document.getElementById('check-l1-110');
        const check111 = document.getElementById('check-l1-111');

        if (check001 && chi < 2 && (phi < 2 || Math.abs(phi - 90) < 2)) {
            check001.checked = true;
        }
        if (check110 && chi < 2 && Math.abs(phi - 45) < 3) {
            check110.checked = true;
        }
        if (check111 && Math.abs(chi - 54.7) < 3 && Math.abs(phi - 45) < 3) {
            check111.checked = true;
        }
    }

    recordDuaneHuntPoint() {
        const V = this.app.simulator.voltageKV;
        const lMin = this.app.simulator.lambdaMin;
        const spotCount = this.app.lastReflections.filter(r => !r.isBlocked).length;
        const invLambda = 1 / lMin; // in 1/Angstrom = 10^10 m^-1

        this.duaneHuntData.push({ V, lMin, invLambda, spotCount });
        this.updateDuaneHuntTable();
        this.showToast(`Recorded: V = ${V.toFixed(1)} kV, λ_min = ${lMin.toFixed(3)} Å`);
    }

    updateDuaneHuntTable() {
        const tbody = document.getElementById('dh-data-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        this.duaneHuntData.forEach((row, idx) => {
            const tr = document.createElement('tr');
            tr.className = 'border-b border-slate-800 hover:bg-slate-800/40 text-xs font-mono';
            tr.innerHTML = `
                <td class="p-2 text-slate-400">${idx + 1}</td>
                <td class="p-2 text-sky-400 font-semibold">${row.V.toFixed(1)}</td>
                <td class="p-2 text-amber-400">${row.lMin.toFixed(3)}</td>
                <td class="p-2 text-emerald-400">${row.invLambda.toFixed(3)}</td>
                <td class="p-2 text-slate-300">${row.spotCount}</td>
            `;
            tbody.appendChild(tr);
        });

        // Calculate slope if >= 2 points
        const slopeBadge = document.getElementById('dh-calc-slope');
        if (slopeBadge && this.duaneHuntData.length >= 2) {
            // Linear regression of invLambda vs V
            let sumV = 0, sumY = 0, sumVY = 0, sumV2 = 0;
            const N = this.duaneHuntData.length;
            this.duaneHuntData.forEach(d => {
                sumV += d.V;
                sumY += d.invLambda;
                sumVY += d.V * d.invLambda;
                sumV2 += d.V * d.V;
            });
            const slope = (N * sumVY - sumV * sumY) / (N * sumV2 - sumV * sumV); // (1/Angstrom) / kV
            // 1 / (Angstrom * kV) = (10^10 m^-1) / (10^3 V) = 10^7 m^-1 V^-1
            // e / (h * c) = 1.602e-19 / (6.626e-34 * 3e8) = 8.06e5 m^-1 V^-1 = 0.0806 (A * kV)^-1
            const h_calc = (1.602e-19 / (slope * 1e7 * 2.998e8)) * 1e34;
            slopeBadge.innerHTML = `Derived Planck constant: <span class="text-amber-400 font-bold">${h_calc.toFixed(3)} × 10⁻³⁴ J·s</span> (True: 6.626)`;
        }
    }

    startMysteryChallenge() {
        // Pick random angles: phi 0-360, chi 0-60, omega 0-45
        const randPhi = Math.floor(Math.random() * 36) * 10;
        const randChi = Math.floor(Math.random() * 6) * 10;
        const randOmega = 0;

        this.mysteryTarget = { phi: randPhi, chi: randChi, omega: randOmega };
        this.app.setGoniometer(randPhi, randChi, randOmega);

        const banner = document.getElementById('mystery-status');
        if (banner) {
            banner.innerHTML = `<span class="text-amber-400 font-semibold">Challenge Active:</span> Unknown Crystal Orientation loaded! Use the zone conic curves and spot symmetry to identify the nearest primary zone axis.`;
        }
        this.showToast('Mystery crystal orientation set! Examine the diffraction pattern.');
    }

    checkMysteryAnswer() {
        if (!this.mysteryTarget) {
            this.showToast('Click "Generate Random Orientation" first!');
            return;
        }

        const userSelect = document.getElementById('mystery-axis-select').value;
        const phi = this.app.simulator.phi;
        const chi = this.app.simulator.chi;

        const banner = document.getElementById('mystery-status');
        if (banner) {
            banner.innerHTML = `
                <div class="p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-lg text-emerald-300">
                    <div class="font-bold mb-1">Analysis Result:</div>
                    <div>Actual Goniometer Settings: φ = ${this.mysteryTarget.phi}°, χ = ${this.mysteryTarget.chi}°</div>
                    <div class="text-xs text-slate-300 mt-1">Excellent analysis! Notice how spots cluster along intersecting conic sections meeting at the zone axis coordinates.</div>
                </div>
            `;
        }
    }

    showToast(msg) {
        const toast = document.getElementById('toast');
        if (toast) {
            toast.textContent = msg;
            toast.classList.remove('opacity-0', 'pointer-events-none');
            toast.classList.add('opacity-100');
            setTimeout(() => {
                toast.classList.add('opacity-0', 'pointer-events-none');
                toast.classList.remove('opacity-100');
            }, 3000);
        }
    }
}

window.LabExperimentsManager = LabExperimentsManager;
