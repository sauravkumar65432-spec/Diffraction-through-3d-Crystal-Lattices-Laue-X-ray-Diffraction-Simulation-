/**
 * Laue Detector Screen / Photographic Film Canvas Engine
 * Simulates real X-ray film exposure, Greninger chart, zone conic sections,
 * interactive spot hit-testing, and photographic inverted/positive film modes.
 */

class LaueDetectorCanvas {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        
        this.filmMode = 'positive'; // 'positive' (dark background, glowing spots) or 'negative' (white film, black spots)
        this.colorMode = 'spectral'; // 'spectral' (colored by lambda) or 'monochrome' (silver halide film look)
        this.showZoneCurves = true;
        this.showGreningerNet = false;
        this.showGrid = true;
        this.exposureGain = 1.0;

        this.simulator = null;
        this.reflections = [];
        this.zoneCurves = [];
        this.selectedSpot = null;
        this.hoveredSpot = null;

        // Callbacks
        this.onSpotSelected = null;
        this.onSpotHovered = null;

        this.initEvents();
        this.resize();
    }

    initEvents() {
        window.addEventListener('resize', () => this.resize());

        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const hit = this.hitTest(mouseX, mouseY);
            if (hit !== this.hoveredSpot) {
                this.hoveredSpot = hit;
                this.render();
                if (this.onSpotHovered) this.onSpotHovered(hit);
            }
        });

        this.canvas.addEventListener('mouseleave', () => {
            if (this.hoveredSpot) {
                this.hoveredSpot = null;
                this.render();
                if (this.onSpotHovered) this.onSpotHovered(null);
            }
        });

        this.canvas.addEventListener('click', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const hit = this.hitTest(mouseX, mouseY);
            this.selectedSpot = hit;
            this.render();
            if (this.onSpotSelected) this.onSpotSelected(hit);
        });
    }

    resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.width = rect.width;
        this.height = rect.height;
        this.ctx.scale(dpr, dpr);
        this.render();
    }

    setData(simulator, reflections, zoneCurves, selected = null) {
        this.simulator = simulator;
        this.reflections = reflections || [];
        this.zoneCurves = zoneCurves || [];
        this.selectedSpot = selected;
        this.render();
    }

    setSelectedSpot(spot) {
        this.selectedSpot = spot;
        this.render();
    }

    setFilmMode(mode) {
        this.filmMode = mode;
        this.render();
    }

    setColorMode(mode) {
        this.colorMode = mode;
        this.render();
    }

    setZoneCurvesVisible(visible) {
        this.showZoneCurves = visible;
        this.render();
    }

    setGreningerNetVisible(visible) {
        this.showGreningerNet = visible;
        this.render();
    }

    setGridVisible(visible) {
        this.showGrid = visible;
        this.render();
    }

    setExposureGain(gain) {
        this.exposureGain = Math.max(0.2, Math.min(5.0, gain));
        this.render();
    }

    // Convert film coordinates (mm, origin at center) to canvas screen pixels
    filmToScreen(xMm, yMm) {
        if (!this.simulator) return { x: 0, y: 0 };
        const filmHalf = this.simulator.filmSize / 2;
        const margin = 20;
        const availableWidth = this.width - margin * 2;
        const availableHeight = this.height - margin * 2;
        const pixelScale = Math.min(availableWidth, availableHeight) / (this.simulator.filmSize);

        const cx = this.width / 2;
        const cy = this.height / 2;

        return {
            x: cx + xMm * pixelScale,
            y: cy - yMm * pixelScale, // Screen Y is inverted
            scale: pixelScale
        };
    }

    screenToFilm(screenX, screenY) {
        if (!this.simulator) return { x: 0, y: 0 };
        const filmHalf = this.simulator.filmSize / 2;
        const margin = 20;
        const availableWidth = this.width - margin * 2;
        const availableHeight = this.height - margin * 2;
        const pixelScale = Math.min(availableWidth, availableHeight) / (this.simulator.filmSize);

        const cx = this.width / 2;
        const cy = this.height / 2;

        return {
            x: (screenX - cx) / pixelScale,
            y: (cy - screenY) / pixelScale
        };
    }

    hitTest(screenX, screenY) {
        if (!this.reflections.length) return null;
        const hitRadiusScreen = 10;
        let closest = null;
        let minD = Infinity;

        for (const ref of this.reflections) {
            if (ref.isBlocked) continue;
            const p = this.filmToScreen(ref.xFilm, ref.yFilm);
            const d = Math.hypot(screenX - p.x, screenY - p.y);
            if (d < hitRadiusScreen && d < minD) {
                minD = d;
                closest = ref;
            }
        }
        return closest;
    }

    // Maps wavelength lambda to an educational spectrum color
    getWavelengthColor(lambda) {
        if (!this.simulator) return '#38bdf8';
        const lMin = this.simulator.lambdaMin;
        const lMax = this.simulator.lambdaMax;
        const norm = Math.max(0, Math.min(1, (lambda - lMin) / (lMax - lMin)));

        // Hue from violet (270) to red (0)
        const hue = (1 - norm) * 260;
        return `hsl(${hue}, 90%, 65%)`;
    }

    render() {
        if (!this.simulator) return;
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);

        const isDark = (this.filmMode === 'positive');

        // Draw Film Background
        this.renderFilmBackground(isDark);

        // Draw Grid & Scale
        if (this.showGrid) {
            this.renderCoordinateGrid(isDark);
        }

        // Draw Greninger Net / Stereographic Projection Overlay
        if (this.showGreningerNet) {
            this.renderGreningerNet(isDark);
        }

        // Draw Zone Curves (Conic Sections)
        if (this.showZoneCurves) {
            this.renderZoneCurves();
        }

        // Draw Diffraction Spots
        this.renderSpots(isDark);

        // Draw Central Beam Stop / Collimator
        this.renderBeamStop(isDark);

        // Draw Active Hover / Selection Rings & Labels
        this.renderSelectionHighlights(isDark);

        // Draw Corner Info
        this.renderCornerHUD(isDark);
    }

    renderFilmBackground(isDark) {
        const ctx = this.ctx;
        const filmHalf = this.simulator.filmSize / 2;
        const pTL = this.filmToScreen(-filmHalf, filmHalf);
        const pBR = this.filmToScreen(filmHalf, -filmHalf);
        const w = pBR.x - pTL.x;
        const h = pBR.y - pTL.y;

        // Container frame background
        ctx.fillStyle = isDark ? '#0b0f19' : '#e2e8f0';
        ctx.fillRect(0, 0, this.width, this.height);

        // Film plate shadow
        ctx.save();
        ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.8)' : 'rgba(100, 116, 139, 0.4)';
        ctx.shadowBlur = 16;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 4;

        // Film plate face
        ctx.fillStyle = isDark ? '#070a12' : '#f8fafc';
        ctx.fillRect(pTL.x, pTL.y, w, h);
        ctx.restore();

        // Border around film
        ctx.strokeStyle = isDark ? '#334155' : '#cbd5e1';
        ctx.lineWidth = 2;
        ctx.strokeRect(pTL.x, pTL.y, w, h);

        // Subtle film grain
        ctx.save();
        ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.02)' : 'rgba(0, 0, 0, 0.02)';
        for (let i = 0; i < 200; i++) {
            const gx = pTL.x + Math.random() * w;
            const gy = pTL.y + Math.random() * h;
            ctx.fillRect(gx, gy, 1, 1);
        }
        ctx.restore();
    }

    renderCoordinateGrid(isDark) {
        const ctx = this.ctx;
        const cx = this.width / 2;
        const cy = this.height / 2;
        const pCenter = { x: cx, y: cy };
        const pRadius10 = this.filmToScreen(10, 0);
        const scale = pRadius10.scale;

        ctx.save();
        ctx.strokeStyle = isDark ? 'rgba(71, 85, 105, 0.35)' : 'rgba(148, 163, 184, 0.4)';
        ctx.lineWidth = 1;

        // Concentric radial circles at 10mm, 20mm, 30mm, 40mm
        const radii = [10, 20, 30, 40];
        for (const r of radii) {
            if (r > this.simulator.filmSize / 2) continue;
            ctx.beginPath();
            ctx.arc(cx, cy, r * scale, 0, 2 * Math.PI);
            ctx.stroke();

            // Label
            ctx.fillStyle = isDark ? '#64748b' : '#94a3b8';
            ctx.font = '9px monospace';
            ctx.fillText(`${r}mm`, cx + r * scale + 2, cy - 3);
        }

        // Center Crosshairs
        const filmHalf = this.simulator.filmSize / 2;
        const pLeft = this.filmToScreen(-filmHalf, 0);
        const pRight = this.filmToScreen(filmHalf, 0);
        const pTop = this.filmToScreen(0, filmHalf);
        const pBottom = this.filmToScreen(0, -filmHalf);

        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(pLeft.x, pLeft.y);
        ctx.lineTo(pRight.x, pRight.y);
        ctx.moveTo(pTop.x, pTop.y);
        ctx.lineTo(pBottom.x, pBottom.y);
        ctx.stroke();

        ctx.restore();
    }

    renderGreningerNet(isDark) {
        const ctx = this.ctx;
        const D = this.simulator.detectorDistance;
        const filmHalf = this.simulator.filmSize / 2;

        ctx.save();
        ctx.strokeStyle = isDark ? 'rgba(56, 189, 248, 0.22)' : 'rgba(2, 132, 199, 0.22)';
        ctx.lineWidth = 0.8;

        // Trace standard angular curves for tilt gamma and azimuth delta at 10 degree increments
        for (let gammaDeg = 10; gammaDeg <= 70; gammaDeg += 10) {
            const gamma = (gammaDeg * Math.PI) / 180;
            ctx.beginPath();
            let first = true;
            for (let betaDeg = -70; betaDeg <= 70; betaDeg += 2) {
                const beta = (betaDeg * Math.PI) / 180;
                // Standard Greninger coordinates
                const xMm = D * Math.tan(gamma) / Math.cos(beta);
                const yMm = D * Math.tan(beta);

                if (Math.abs(xMm) <= filmHalf && Math.abs(yMm) <= filmHalf) {
                    const pt = this.filmToScreen(xMm, yMm);
                    if (first) { ctx.moveTo(pt.x, pt.y); first = false; }
                    else { ctx.lineTo(pt.x, pt.y); }
                }
            }
            ctx.stroke();

            // Symmetrical other half
            ctx.beginPath();
            first = true;
            for (let betaDeg = -70; betaDeg <= 70; betaDeg += 2) {
                const beta = (betaDeg * Math.PI) / 180;
                const xMm = -D * Math.tan(gamma) / Math.cos(beta);
                const yMm = D * Math.tan(beta);

                if (Math.abs(xMm) <= filmHalf && Math.abs(yMm) <= filmHalf) {
                    const pt = this.filmToScreen(xMm, yMm);
                    if (first) { ctx.moveTo(pt.x, pt.y); first = false; }
                    else { ctx.lineTo(pt.x, pt.y); }
                }
            }
            ctx.stroke();
        }

        ctx.restore();
    }

    renderZoneCurves() {
        const ctx = this.ctx;
        ctx.save();
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 3]);

        for (const curve of this.zoneCurves) {
            if (!curve.points.length) continue;
            ctx.strokeStyle = curve.color;
            ctx.beginPath();
            let first = true;

            for (const pt of curve.points) {
                const pScreen = this.filmToScreen(pt.x, pt.y);
                if (first) {
                    ctx.moveTo(pScreen.x, pScreen.y);
                    first = false;
                } else {
                    ctx.lineTo(pScreen.x, pScreen.y);
                }
            }
            ctx.stroke();

            // Curve label at first or middle point
            const labelPt = curve.points[Math.floor(curve.points.length / 2)];
            if (labelPt) {
                const pLabel = this.filmToScreen(labelPt.x, labelPt.y);
                ctx.fillStyle = curve.color;
                ctx.font = 'bold 9px monospace';
                ctx.fillText(curve.zone, pLabel.x + 3, pLabel.y - 3);
            }
        }
        ctx.restore();
    }

    renderSpots(isDark) {
        const ctx = this.ctx;

        for (const ref of this.reflections) {
            if (ref.isBlocked) continue; // Behind beam stop

            const p = this.filmToScreen(ref.xFilm, ref.yFilm);
            const baseRadius = 2.0 + Math.sqrt(ref.normIntensity || 0.1) * 3.5 * this.exposureGain;
            const spotRadius = Math.max(1.8, Math.min(10.0, baseRadius));

            let spotColor = '#ffffff';
            if (this.colorMode === 'spectral') {
                spotColor = this.getWavelengthColor(ref.lambda);
            } else {
                spotColor = isDark ? '#ffffff' : '#0f172a';
            }

            ctx.save();

            if (isDark) {
                // High dynamic range bloom on dark film
                const glowRadius = spotRadius * 2.8;
                const grad = ctx.createRadialGradient(p.x, p.y, spotRadius * 0.2, p.x, p.y, glowRadius);
                grad.addColorStop(0, spotColor);
                grad.addColorStop(0.4, spotColor);
                grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(p.x, p.y, glowRadius, 0, 2 * Math.PI);
                ctx.fill();

                // Core white saturation
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(p.x, p.y, spotRadius * 0.45, 0, 2 * Math.PI);
                ctx.fill();
            } else {
                // Negative film (black photographic grain on white film)
                const alpha = Math.min(1.0, 0.35 + (ref.normIntensity || 0.1) * 0.65 * this.exposureGain);
                const grad = ctx.createRadialGradient(p.x, p.y, spotRadius * 0.2, p.x, p.y, spotRadius * 1.5);
                grad.addColorStop(0, `rgba(15, 23, 42, ${alpha})`);
                grad.addColorStop(0.7, `rgba(15, 23, 42, ${alpha * 0.5})`);
                grad.addColorStop(1, 'rgba(15, 23, 42, 0)');

                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(p.x, p.y, spotRadius * 1.5, 0, 2 * Math.PI);
                ctx.fill();
            }

            ctx.restore();
        }
    }

    renderBeamStop(isDark) {
        const ctx = this.ctx;
        const cx = this.width / 2;
        const cy = this.height / 2;
        const pR = this.filmToScreen(this.simulator.beamStopRadius, 0);
        const rPx = Math.abs(pR.x - cx);

        ctx.save();
        if (this.simulator.geometry === 'transmission') {
            // Lead beam stop disk
            ctx.fillStyle = isDark ? '#1e293b' : '#64748b';
            ctx.strokeStyle = isDark ? '#475569' : '#334155';
            ctx.lineWidth = 1.5;

            // Support arm from edge
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx, this.height);
            ctx.lineWidth = 3;
            ctx.stroke();

            // Center disk
            ctx.beginPath();
            ctx.arc(cx, cy, rPx, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();

            // Label
            ctx.fillStyle = isDark ? '#94a3b8' : '#e2e8f0';
            ctx.font = '8px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('STOP', cx, cy + 3);
        } else {
            // Back-reflection collimator hole
            ctx.fillStyle = '#000000';
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(cx, cy, rPx, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#38bdf8';
            ctx.font = '8px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('HOLE', cx, cy + 3);
        }
        ctx.restore();
    }

    renderSelectionHighlights(isDark) {
        const ctx = this.ctx;

        // Hovered spot ring
        if (this.hoveredSpot && !this.hoveredSpot.isBlocked) {
            const p = this.filmToScreen(this.hoveredSpot.xFilm, this.hoveredSpot.yFilm);
            ctx.save();
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 9, 0, 2 * Math.PI);
            ctx.stroke();

            // Tooltip preview
            const text = `${this.hoveredSpot.indicesStr} λ=${this.hoveredSpot.lambda.toFixed(3)}Å`;
            ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1;
            const textWidth = ctx.measureText(text).width;
            ctx.beginPath();
            ctx.roundRect(p.x + 12, p.y - 12, textWidth + 14, 22, 4);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#f8fafc';
            ctx.font = '10px monospace';
            ctx.fillText(text, p.x + 18, p.y + 3);
            ctx.restore();
        }

        // Selected spot ring
        if (this.selectedSpot && !this.selectedSpot.isBlocked) {
            const p = this.filmToScreen(this.selectedSpot.xFilm, this.selectedSpot.yFilm);
            ctx.save();
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 2;
            ctx.shadowColor = '#f59e0b';
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 11, 0, 2 * Math.PI);
            ctx.stroke();

            // Target reticle cross
            ctx.beginPath();
            ctx.moveTo(p.x - 14, p.y);
            ctx.lineTo(p.x - 6, p.y);
            ctx.moveTo(p.x + 6, p.y);
            ctx.lineTo(p.x + 14, p.y);
            ctx.moveTo(p.x, p.y - 14);
            ctx.lineTo(p.x, p.y - 6);
            ctx.moveTo(p.x, p.y + 6);
            ctx.lineTo(p.x, p.y + 14);
            ctx.stroke();

            ctx.restore();
        }
    }

    renderCornerHUD(isDark) {
        const ctx = this.ctx;
        ctx.save();
        ctx.fillStyle = isDark ? '#64748b' : '#64748b';
        ctx.font = '10px monospace';
        ctx.fillText(`GEOMETRY: ${this.simulator.geometry.toUpperCase()}`, 12, this.height - 24);
        ctx.fillText(`D = ${this.simulator.detectorDistance.toFixed(1)} mm | SPOTS: ${this.reflections.filter(r => !r.isBlocked).length}`, 12, this.height - 10);
        ctx.restore();
    }
}

window.LaueDetectorCanvas = LaueDetectorCanvas;
