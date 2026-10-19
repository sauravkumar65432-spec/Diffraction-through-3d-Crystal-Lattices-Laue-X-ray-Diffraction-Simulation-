/**
 * Main Application Controller for Laue Diffraction Virtual Lab
 * Connects UI, Physics engine, 3D Renderer, Detector Canvas, and Experiments.
 */

class LaueVirtualLabApp {
    constructor() {
        this.crystal = new Crystallography('Si');
        this.simulator = new LaueSimulator(this.crystal);
        this.renderer3D = null;
        this.detectorCanvas = null;
        this.experimentsManager = null;
        
        this.lastReflections = [];
        this.lastZoneCurves = [];
        this.selectedReflection = null;
    }

    init() {
        // Initialize renderers
        this.renderer3D = new Interactive3DRenderer('canvas-3d');
        this.detectorCanvas = new LaueDetectorCanvas('canvas-detector');
        this.experimentsManager = new LabExperimentsManager(this);

        // Bind spot selection & hover events
        this.detectorCanvas.onSpotSelected = (ref) => this.selectReflection(ref);
        this.detectorCanvas.onSpotHovered = (ref) => this.hoverReflection(ref);

        this.setupUIBindings();
        this.experimentsManager.init();

        // Initial simulation & render
        this.updateSimulation();
    }

    setupUIBindings() {
        // Main Navigation Tabs
        document.querySelectorAll('.main-nav-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const target = tab.getAttribute('data-tab');
                this.switchMainTab(target);
            });
        });

        // Crystal Selector
        const crystalSelect = document.getElementById('crystal-select');
        if (crystalSelect) {
            crystalSelect.addEventListener('change', (e) => {
                this.crystal.setCrystal(e.target.value);
                this.updateCrystalParamsUI();
                this.updateSimulation();
            });
        }

        // Lattice Parameter Sliders
        const paramA = document.getElementById('param-a');
        if (paramA) {
            paramA.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                this.crystal.a = val;
                if (this.crystal.system === 'Cubic') {
                    this.crystal.b = val;
                    this.crystal.c = val;
                }
                this.crystal.calculateLatticeVectors();
                document.getElementById('param-a-val').textContent = val.toFixed(3);
                this.updateSimulation();
            });
        }

        // Voltage Slider
        const voltageSlider = document.getElementById('slider-voltage');
        const voltageInput = document.getElementById('input-voltage');
        if (voltageSlider) {
            voltageSlider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                this.simulator.setVoltage(val);
                if (voltageInput) voltageInput.value = val;
                document.getElementById('dh-min-val').textContent = this.simulator.lambdaMin.toFixed(3);
                this.updateSimulation();
            });
        }
        if (voltageInput) {
            voltageInput.addEventListener('change', (e) => {
                const val = parseFloat(e.target.value);
                this.simulator.setVoltage(val);
                if (voltageSlider) voltageSlider.value = val;
                document.getElementById('dh-min-val').textContent = this.simulator.lambdaMin.toFixed(3);
                this.updateSimulation();
            });
        }

        // Lambda Max Slider
        const lMaxSlider = document.getElementById('slider-lmax');
        if (lMaxSlider) {
            lMaxSlider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                this.simulator.lambdaMax = val;
                document.getElementById('lmax-val').textContent = val.toFixed(2);
                this.updateSimulation();
            });
        }

        // Geometry Selector (Transmission vs Back-Reflection)
        const geomSelect = document.getElementById('geometry-select');
        if (geomSelect) {
            geomSelect.addEventListener('change', (e) => {
                this.simulator.geometry = e.target.value;
                document.getElementById('badge-geom').textContent = e.target.value.toUpperCase();
                this.updateSimulation();
            });
        }

        // Detector Distance D Slider
        const distSlider = document.getElementById('slider-dist');
        if (distSlider) {
            distSlider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                this.simulator.detectorDistance = val;
                document.getElementById('dist-val').textContent = val.toFixed(1);
                this.updateSimulation();
            });
        }

        // Goniometer Sliders
        const phiSlider = document.getElementById('slider-phi');
        const chiSlider = document.getElementById('slider-chi');
        const omegaSlider = document.getElementById('slider-omega');

        const updateGonioFromSliders = () => {
            const phi = parseFloat(phiSlider.value);
            const chi = parseFloat(chiSlider.value);
            const omega = parseFloat(omegaSlider.value);
            this.simulator.setOrientation(phi, chi, omega);
            document.getElementById('phi-val').textContent = `${phi}°`;
            document.getElementById('chi-val').textContent = `${chi}°`;
            document.getElementById('omega-val').textContent = `${omega}°`;
            this.updateSimulation();
            this.experimentsManager.validateLab1Status();
        };

        if (phiSlider) phiSlider.addEventListener('input', updateGonioFromSliders);
        if (chiSlider) chiSlider.addEventListener('input', updateGonioFromSliders);
        if (omegaSlider) omegaSlider.addEventListener('input', updateGonioFromSliders);

        // Goniometer Quick Step Buttons
        document.querySelectorAll('.gonio-step-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const axis = btn.getAttribute('data-axis');
                const step = parseFloat(btn.getAttribute('data-step'));
                if (axis === 'phi' && phiSlider) {
                    phiSlider.value = (parseFloat(phiSlider.value) + step + 360) % 360;
                } else if (axis === 'chi' && chiSlider) {
                    chiSlider.value = Math.max(-90, Math.min(90, parseFloat(chiSlider.value) + step));
                } else if (axis === 'omega' && omegaSlider) {
                    omegaSlider.value = Math.max(-180, Math.min(180, parseFloat(omegaSlider.value) + step));
                }
                updateGonioFromSliders();
            });
        });

        // 3D View Mode Buttons (Real vs Reciprocal)
        document.querySelectorAll('.btn-3d-mode').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.getAttribute('data-mode');
                document.querySelectorAll('.btn-3d-mode').forEach(b => {
                    b.classList.remove('bg-sky-500/30', 'text-sky-300', 'border-sky-500/50');
                    b.classList.add('text-slate-400');
                });
                btn.classList.add('bg-sky-500/30', 'text-sky-300', 'border-sky-500/50');
                btn.classList.remove('text-slate-400');
                this.renderer3D.setViewMode(mode);
            });
        });

        const btnReset3D = document.getElementById('btn-reset-3d');
        if (btnReset3D) btnReset3D.addEventListener('click', () => this.renderer3D.resetView());

        // Plane Slicing Controls
        const togglePlane = document.getElementById('toggle-show-plane');
        const planeH = document.getElementById('plane-h');
        const planeK = document.getElementById('plane-k');
        const planeL = document.getElementById('plane-l');

        const updatePlane = () => {
            if (togglePlane && togglePlane.checked) {
                const h = parseInt(planeH.value) || 0;
                const k = parseInt(planeK.value) || 0;
                const l = parseInt(planeL.value) || 0;
                this.renderer3D.setPlaneSlice(true, h, k, l);
            } else {
                this.renderer3D.setPlaneSlice(false, 1, 1, 1);
            }
        };

        if (togglePlane) togglePlane.addEventListener('change', updatePlane);
        if (planeH) planeH.addEventListener('input', updatePlane);
        if (planeK) planeK.addEventListener('input', updatePlane);
        if (planeL) planeL.addEventListener('input', updatePlane);

        // Detector Film Controls
        const toggleZones = document.getElementById('toggle-zone-curves');
        if (toggleZones) toggleZones.addEventListener('change', (e) => this.detectorCanvas.setZoneCurvesVisible(e.target.checked));

        const toggleGreninger = document.getElementById('toggle-greninger');
        if (toggleGreninger) toggleGreninger.addEventListener('change', (e) => this.detectorCanvas.setGreningerNetVisible(e.target.checked));

        const toggleGrid = document.getElementById('toggle-grid');
        if (toggleGrid) toggleGrid.addEventListener('change', (e) => this.detectorCanvas.setGridVisible(e.target.checked));

        const filmModeSelect = document.getElementById('film-mode-select');
        if (filmModeSelect) filmModeSelect.addEventListener('change', (e) => this.detectorCanvas.setFilmMode(e.target.value));

        const colorModeSelect = document.getElementById('color-mode-select');
        if (colorModeSelect) colorModeSelect.addEventListener('change', (e) => this.detectorCanvas.setColorMode(e.target.value));

        const sliderGain = document.getElementById('slider-exposure-gain');
        if (sliderGain) sliderGain.addEventListener('input', (e) => this.detectorCanvas.setExposureGain(parseFloat(e.target.value)));

        // Export Buttons
        const btnExportPNG = document.getElementById('btn-export-png');
        if (btnExportPNG) btnExportPNG.addEventListener('click', () => this.exportFilmImage());

        const btnExportCSV = document.getElementById('btn-export-csv');
        if (btnExportCSV) btnExportCSV.addEventListener('click', () => this.exportReflectionCSV());

        // Table Search & Filter
        const tableSearch = document.getElementById('table-search');
        if (tableSearch) {
            tableSearch.addEventListener('input', (e) => this.filterReflectionTable(e.target.value));
        }
    }

    switchMainTab(tabKey) {
        document.querySelectorAll('.main-nav-tab').forEach(t => {
            if (t.getAttribute('data-tab') === tabKey) {
                t.classList.add('border-sky-500', 'text-sky-400');
                t.classList.remove('border-transparent', 'text-slate-400');
            } else {
                t.classList.remove('border-sky-500', 'text-sky-400');
                t.classList.add('border-transparent', 'text-slate-400');
            }
        });

        document.querySelectorAll('.tab-section').forEach(sec => {
            sec.classList.add('hidden');
        });

        const activeSec = document.getElementById(`tab-section-${tabKey}`);
        if (activeSec) {
            activeSec.classList.remove('hidden');
            // Trigger resize for canvases if switching to bench
            if (tabKey === 'bench') {
                setTimeout(() => {
                    this.renderer3D.resize();
                    this.detectorCanvas.resize();
                }, 50);
            }
        }
    }

    updateCrystalParamsUI() {
        const paramA = document.getElementById('param-a');
        if (paramA) paramA.value = this.crystal.a;
        const paramAVal = document.getElementById('param-a-val');
        if (paramAVal) paramAVal.textContent = this.crystal.a.toFixed(3);

        const desc = document.getElementById('crystal-desc');
        if (desc) desc.textContent = this.crystal.description;
    }

    setGoniometer(phi, chi, omega) {
        this.simulator.setOrientation(phi, chi, omega);
        const phiSlider = document.getElementById('slider-phi');
        const chiSlider = document.getElementById('slider-chi');
        const omegaSlider = document.getElementById('slider-omega');

        if (phiSlider) phiSlider.value = phi;
        if (chiSlider) chiSlider.value = chi;
        if (omegaSlider) omegaSlider.value = omega;

        document.getElementById('phi-val').textContent = `${phi}°`;
        document.getElementById('chi-val').textContent = `${chi}°`;
        document.getElementById('omega-val').textContent = `${omega}°`;

        this.updateSimulation();
    }

    updateSimulation() {
        // Run physical simulation
        this.lastReflections = this.simulator.simulate();
        this.lastZoneCurves = this.simulator.getZoneCurves();

        // Update 3D Viewer & 2D Detector
        this.renderer3D.setData(this.crystal, this.simulator, this.lastReflections, this.selectedReflection);
        this.detectorCanvas.setData(this.simulator, this.lastReflections, this.lastZoneCurves, this.selectedReflection);

        // Update Reflection Table
        this.updateReflectionTable(this.lastReflections);

        // Update Summary Counts
        const countBadge = document.getElementById('summary-spot-count');
        if (countBadge) {
            const visibleCount = this.lastReflections.filter(r => !r.isBlocked).length;
            countBadge.textContent = `${visibleCount} active spots`;
        }
    }

    selectReflection(ref) {
        this.selectedReflection = ref;
        this.renderer3D.setSelectedReflection(ref);
        this.detectorCanvas.setSelectedSpot(ref);
        this.updateInspectorCard(ref);

        // Also sync 3D plane slice if requested
        if (ref) {
            const planeH = document.getElementById('plane-h');
            const planeK = document.getElementById('plane-k');
            const planeL = document.getElementById('plane-l');
            if (planeH) planeH.value = ref.h;
            if (planeK) planeK.value = ref.k;
            if (planeL) planeL.value = ref.l;
        }
    }

    hoverReflection(ref) {
        if (!this.selectedReflection && ref) {
            this.updateInspectorCard(ref);
        }
    }

    updateInspectorCard(ref) {
        const card = document.getElementById('inspector-card');
        if (!card) return;

        if (!ref) {
            card.innerHTML = `
                <div class="text-center py-6 text-slate-500 text-xs">
                    Hover over or click any diffraction spot on the film to view crystallographic details.
                </div>
            `;
            return;
        }

        card.innerHTML = `
            <div class="space-y-2">
                <div class="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span class="text-sky-400 font-mono font-bold text-base">${ref.indicesStr}</span>
                    <span class="px-2 py-0.5 rounded text-[11px] font-mono bg-sky-500/20 text-sky-300 border border-sky-500/30">
                        Zone ${ref.zone}
                    </span>
                </div>
                <div class="grid grid-cols-2 gap-2 text-xs">
                    <div class="bg-slate-900/60 p-2 rounded border border-slate-800">
                        <div class="text-slate-400">Bragg Wavelength (λ)</div>
                        <div class="font-mono text-amber-400 font-semibold">${ref.lambda.toFixed(4)} Å</div>
                    </div>
                    <div class="bg-slate-900/60 p-2 rounded border border-slate-800">
                        <div class="text-slate-400">Interplanar Spacing (d)</div>
                        <div class="font-mono text-emerald-400 font-semibold">${ref.dSpacing.toFixed(3)} Å</div>
                    </div>
                    <div class="bg-slate-900/60 p-2 rounded border border-slate-800">
                        <div class="text-slate-400">Glancing Angle (θ)</div>
                        <div class="font-mono text-slate-200">${ref.thetaDeg.toFixed(2)}°</div>
                    </div>
                    <div class="bg-slate-900/60 p-2 rounded border border-slate-800">
                        <div class="text-slate-400">Diffraction Angle (2θ)</div>
                        <div class="font-mono text-slate-200">${ref.twoThetaDeg.toFixed(2)}°</div>
                    </div>
                    <div class="bg-slate-900/60 p-2 rounded border border-slate-800">
                        <div class="text-slate-400">Film Position (X, Y)</div>
                        <div class="font-mono text-slate-300">${ref.xFilm.toFixed(1)}, ${ref.yFilm.toFixed(1)} mm</div>
                    </div>
                    <div class="bg-slate-900/60 p-2 rounded border border-slate-800">
                        <div class="text-slate-400">Structure Factor |F|</div>
                        <div class="font-mono text-purple-400">${ref.structureFactor.toFixed(1)}</div>
                    </div>
                </div>
            </div>
        `;
    }

    updateReflectionTable(reflections) {
        const tbody = document.getElementById('reflections-table-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        const visibleRefs = reflections.filter(r => !r.isBlocked);

        visibleRefs.forEach((ref) => {
            const tr = document.createElement('tr');
            tr.className = 'border-b border-slate-800/60 hover:bg-slate-800/50 cursor-pointer text-xs font-mono transition-colors';
            if (this.selectedReflection === ref) {
                tr.classList.add('bg-sky-500/20');
            }

            tr.innerHTML = `
                <td class="p-2.5 font-bold text-sky-400">${ref.indicesStr}</td>
                <td class="p-2.5 text-amber-400">${ref.lambda.toFixed(3)}</td>
                <td class="p-2.5 text-emerald-400">${ref.dSpacing.toFixed(3)}</td>
                <td class="p-2.5 text-slate-300">${ref.twoThetaDeg.toFixed(1)}°</td>
                <td class="p-2.5 text-slate-400">${ref.xFilm.toFixed(1)}, ${ref.yFilm.toFixed(1)}</td>
                <td class="p-2.5 text-slate-300">${ref.zone}</td>
                <td class="p-2.5 text-right text-purple-400">${ref.structureFactor.toFixed(1)}</td>
            `;

            tr.addEventListener('click', () => {
                this.selectReflection(ref);
                this.switchMainTab('bench');
            });

            tbody.appendChild(tr);
        });
    }

    filterReflectionTable(query) {
        const q = query.trim().toLowerCase();
        const rows = document.querySelectorAll('#reflections-table-body tr');
        rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(q) ? '' : 'none';
        });
    }

    exportFilmImage() {
        const link = document.createElement('a');
        link.download = `laue_${this.crystal.presetKey}_${this.simulator.geometry}_${this.simulator.voltageKV}kV.png`;
        link.href = this.detectorCanvas.canvas.toDataURL('image/png');
        link.click();
    }

    exportReflectionCSV() {
        const visibleRefs = this.lastReflections.filter(r => !r.isBlocked);
        let csv = 'h,k,l,lambda_Angstrom,d_spacing_Angstrom,theta_deg,two_theta_deg,x_film_mm,y_film_mm,zone,structure_factor,norm_intensity\n';
        for (const r of visibleRefs) {
            csv += `${r.h},${r.k},${r.l},${r.lambda.toFixed(4)},${r.dSpacing.toFixed(4)},${r.thetaDeg.toFixed(2)},${r.twoThetaDeg.toFixed(2)},${r.xFilm.toFixed(2)},${r.yFilm.toFixed(2)},"${r.zone}",${r.structureFactor.toFixed(2)},${(r.normIntensity||0).toFixed(4)}\n`;
        }
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `laue_reflections_${this.crystal.presetKey}.csv`;
        link.click();
    }
}

// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
    window.app = new LaueVirtualLabApp();
    window.app.init();
});
