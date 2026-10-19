/**
 * 3D Canvas Perspective Renderer
 * Self-contained 3D engine with orbit controls, depth sorting, sphere lighting,
 * real-space lattice visualization, and reciprocal Ewald sphere construction.
 */

class Interactive3DRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.viewMode = 'real'; // 'real' (crystal lattice) or 'reciprocal' (Ewald sphere)
        
        // Camera / Orbit state
        this.camDistance = 16.0;
        this.rotX = 0.45;
        this.rotY = -0.65;
        this.panX = 0;
        this.panY = 0;
        this.isDragging = false;
        this.isPanning = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;

        // Model / simulation data
        this.crystal = null;
        this.simulator = null;
        this.activeReflections = [];
        this.selectedReflection = null;
        this.showPlane = false;
        this.planeIndices = { h: 1, k: 1, l: 1 };
        this.unitCellCount = 2; // 2x2x2 unit cells

        this.initEvents();
        this.resize();
    }

    initEvents() {
        window.addEventListener('resize', () => this.resize());

        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 2) {
                this.isPanning = true;
            } else {
                this.isDragging = true;
            }
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.isDragging && !this.isPanning) return;
            const dx = e.clientX - this.lastMouseX;
            const dy = e.clientY - this.lastMouseY;
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;

            if (this.isDragging) {
                this.rotY += dx * 0.008;
                this.rotX += dy * 0.008;
                this.rotX = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.rotX));
            } else if (this.isPanning) {
                this.panX += dx * 0.02;
                this.panY += dy * 0.02;
            }
            this.render();
        });

        window.addEventListener('mouseup', () => {
            this.isDragging = false;
            this.isPanning = false;
        });

        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = e.deltaY > 0 ? 1.08 : 0.92;
            this.camDistance = Math.max(3.0, Math.min(60.0, this.camDistance * zoomFactor));
            this.render();
        }, { passive: false });

        // Touch support
        let touchStartDist = 0;
        this.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                this.isDragging = true;
                this.lastMouseX = e.touches[0].clientX;
                this.lastMouseY = e.touches[0].clientY;
            } else if (e.touches.length === 2) {
                touchStartDist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
            }
        });

        this.canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length === 1 && this.isDragging) {
                const dx = e.touches[0].clientX - this.lastMouseX;
                const dy = e.touches[0].clientY - this.lastMouseY;
                this.lastMouseX = e.touches[0].clientX;
                this.lastMouseY = e.touches[0].clientY;
                this.rotY += dx * 0.008;
                this.rotX += dy * 0.008;
                this.render();
            } else if (e.touches.length === 2) {
                const dist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                if (touchStartDist > 0) {
                    const factor = touchStartDist / dist;
                    this.camDistance = Math.max(3.0, Math.min(60.0, this.camDistance * factor));
                    touchStartDist = dist;
                    this.render();
                }
            }
        }, { passive: false });

        this.canvas.addEventListener('touchend', () => {
            this.isDragging = false;
            touchStartDist = 0;
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

    resetView() {
        this.camDistance = this.viewMode === 'real' ? 16.0 : 8.0;
        this.rotX = 0.45;
        this.rotY = -0.65;
        this.panX = 0;
        this.panY = 0;
        this.render();
    }

    setViewMode(mode) {
        this.viewMode = mode;
        this.camDistance = mode === 'real' ? 16.0 : 8.0;
        this.render();
    }

    setData(crystal, simulator, reflections, selectedRef = null) {
        this.crystal = crystal;
        this.simulator = simulator;
        this.activeReflections = reflections;
        this.selectedReflection = selectedRef;
        this.render();
    }

    setSelectedReflection(ref) {
        this.selectedReflection = ref;
        this.render();
    }

    setPlaneSlice(visible, h, k, l) {
        this.showPlane = visible;
        this.planeIndices = { h, k, l };
        this.render();
    }

    // Camera project 3D point to 2D screen coordinates with perspective
    project(p) {
        // Orbit rotation around origin
        const cosY = Math.cos(this.rotY), sinY = Math.sin(this.rotY);
        const cosX = Math.cos(this.rotX), sinX = Math.sin(this.rotX);

        // Apply Y rotation
        const x1 = p.x * cosY + p.z * sinY;
        const y1 = p.y;
        const z1 = -p.x * sinY + p.z * cosY;

        // Apply X rotation
        const x2 = x1;
        const y2 = y1 * cosX - z1 * sinX;
        const z2 = y1 * sinX + z1 * cosX;

        // Apply camera distance & pan
        const camZ = z2 + this.camDistance;
        if (camZ <= 0.1) return null; // Behind camera clipping

        const fov = 650; // Focal length
        const scale = fov / camZ;
        const sx = this.width / 2 + (x2 + this.panX) * scale;
        const sy = this.height / 2 + (-y2 + this.panY) * scale;

        return { x: sx, y: sy, z: camZ, scale: scale, depth: z2 };
    }

    render() {
        if (!this.crystal || !this.simulator) return;
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);

        // Background gradient
        const bgGrad = ctx.createLinearGradient(0, 0, 0, this.height);
        bgGrad.addColorStop(0, '#090d16');
        bgGrad.addColorStop(1, '#0f172a');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, this.width, this.height);

        // Render based on selected view mode
        if (this.viewMode === 'real') {
            this.renderRealSpace();
        } else {
            this.renderReciprocalSpace();
        }

        // Draw incident beam indicator
        this.renderIncidentBeamIndicator();

        // Draw Viewport Mode Badge
        this.renderOverlayInfo();
    }

    renderIncidentBeamIndicator() {
        const ctx = this.ctx;
        // The beam enters along +Z: from (0, 0, -8) to (0, 0, 8)
        const pStart = this.project(new Vector3(0, 0, -10));
        const pOrigin = this.project(new Vector3(0, 0, 0));
        const pEnd = this.project(new Vector3(0, 0, 8));

        if (pStart && pOrigin) {
            ctx.save();
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(pStart.x, pStart.y);
            ctx.lineTo(pOrigin.x, pOrigin.y);
            ctx.stroke();

            // Arrow head towards origin
            ctx.strokeStyle = '#38bdf8';
            ctx.fillStyle = '#38bdf8';
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.arc(pOrigin.x, pOrigin.y, 3, 0, 2 * Math.PI);
            ctx.fill();
            ctx.restore();
        }
    }

    renderRealSpace() {
        const ctx = this.ctx;
        const rotMat = Matrix3.fromEuler(this.simulator.phi, this.simulator.chi, this.simulator.omega);
        const elements = [];

        // Build Real-Space Lattice Model
        const a1 = this.crystal.a1.clone().applyMatrix3(rotMat.elements);
        const a2 = this.crystal.a2.clone().applyMatrix3(rotMat.elements);
        const a3 = this.crystal.a3.clone().applyMatrix3(rotMat.elements);

        const nCells = this.unitCellCount;
        const offset = new Vector3()
            .add(a1.clone().multiplyScalar((nCells - 1) / 2))
            .add(a2.clone().multiplyScalar((nCells - 1) / 2))
            .add(a3.clone().multiplyScalar((nCells - 1) / 2));

        // Generate unit cell bounding boxes
        const boxCorners = [
            new Vector3(0,0,0), a1, a1.clone().add(a2), a2,
            a3, a1.clone().add(a3), a1.clone().add(a2).add(a3), a2.clone().add(a3)
        ].map(p => p.clone().sub(offset));

        const boxEdges = [
            [0,1], [1,2], [2,3], [3,0], // bottom
            [4,5], [5,6], [6,7], [7,4], // top
            [0,4], [1,5], [2,6], [3,7]  // vertical
        ];

        for (const edge of boxEdges) {
            const p1 = boxCorners[edge[0]];
            const p2 = boxCorners[edge[1]];
            elements.push({
                type: 'line',
                p1: p1,
                p2: p2,
                color: 'rgba(148, 163, 184, 0.4)',
                width: 1.5,
                depth: (p1.z + p2.z) / 2
            });
        }

        // Generate Atoms in unit cells
        const scaleFactor = 1.0;
        const atomList = [];

        for (let ix = 0; ix < nCells; ix++) {
            for (let iy = 0; iy < nCells; iy++) {
                for (let iz = 0; iz < nCells; iz++) {
                    const cellOrigin = a1.clone().multiplyScalar(ix)
                        .add(a2.clone().multiplyScalar(iy))
                        .add(a3.clone().multiplyScalar(iz))
                        .sub(offset);

                    for (const base of this.crystal.basis) {
                        const localPos = this.crystal.a1.clone().multiplyScalar(base.pos[0])
                            .add(this.crystal.a2.clone().multiplyScalar(base.pos[1]))
                            .add(this.crystal.a3.clone().multiplyScalar(base.pos[2]))
                            .applyMatrix3(rotMat.elements);

                        const atomPos = cellOrigin.clone().add(localPos);
                        const atomData = ATOMIC_FORM_FACTORS[base.element] || { color: '#38bdf8', radius: 1.2 };
                        
                        atomList.push({
                            pos: atomPos,
                            element: base.element,
                            color: atomData.color,
                            radius: (atomData.radius || 1.0) * 0.35 * scaleFactor
                        });
                    }
                }
            }
        }

        // Add atoms to depth queue
        for (const atom of atomList) {
            elements.push({
                type: 'atom',
                pos: atom.pos,
                element: atom.element,
                color: atom.color,
                radius: atom.radius,
                depth: atom.pos.z
            });
        }

        // Optional Miller plane slice polygon
        if (this.showPlane && (this.planeIndices.h || this.planeIndices.k || this.planeIndices.l)) {
            const h = this.planeIndices.h, k = this.planeIndices.k, l = this.planeIndices.l;
            // Generate cutting plane vertices
            const planeCorners = this.generateMillerPlaneVertices(h, k, l, a1, a2, a3, offset);
            if (planeCorners.length >= 3) {
                let avgZ = 0;
                planeCorners.forEach(p => avgZ += p.z);
                avgZ /= planeCorners.length;
                elements.push({
                    type: 'polygon',
                    points: planeCorners,
                    color: 'rgba(236, 72, 153, 0.35)',
                    borderColor: '#f43f5e',
                    depth: avgZ
                });
            }
        }

        // Draw Coordinate Frame Axes (a1 red, a2 green, a3 blue)
        const axisLen = 3.5;
        const origin = new Vector3(0, 0, 0).sub(offset);
        elements.push({ type: 'axis', p1: origin, p2: origin.clone().add(a1.clone().normalize().multiplyScalar(axisLen)), color: '#ef4444', label: 'a', depth: origin.z });
        elements.push({ type: 'axis', p1: origin, p2: origin.clone().add(a2.clone().normalize().multiplyScalar(axisLen)), color: '#22c55e', label: 'b', depth: origin.z });
        elements.push({ type: 'axis', p1: origin, p2: origin.clone().add(a3.clone().normalize().multiplyScalar(axisLen)), color: '#3b82f6', label: 'c', depth: origin.z });

        // Depth sort and render all elements
        this.renderSortedElements(elements);
    }

    generateMillerPlaneVertices(h, k, l, a1, a2, a3, offset) {
        // Find intercepts on unit cell edges
        const intercepts = [];
        if (h !== 0) intercepts.push(a1.clone().multiplyScalar(1 / h));
        if (k !== 0) intercepts.push(a2.clone().multiplyScalar(1 / k));
        if (l !== 0) intercepts.push(a3.clone().multiplyScalar(1 / l));

        if (intercepts.length === 3) {
            return intercepts.map(p => p.clone().sub(offset));
        }
        return [];
    }

    renderReciprocalSpace() {
        const ctx = this.ctx;
        const rotMat = Matrix3.fromEuler(this.simulator.phi, this.simulator.chi, this.simulator.omega);
        const elements = [];

        // In reciprocal space, |b| is in 1/Angstrom (typically ~ 0.2 - 0.4 A^-1)
        // We scale for visual clarity
        const recScale = 5.0;

        const b1 = this.crystal.b1.clone().applyMatrix3(rotMat.elements).multiplyScalar(recScale);
        const b2 = this.crystal.b2.clone().applyMatrix3(rotMat.elements).multiplyScalar(recScale);
        const b3 = this.crystal.b3.clone().applyMatrix3(rotMat.elements).multiplyScalar(recScale);

        // Reciprocal axes (b1 red, b2 green, b3 blue)
        const recOrigin = new Vector3(0, 0, 0);
        elements.push({ type: 'axis', p1: recOrigin, p2: b1.clone().normalize().multiplyScalar(2.5), color: '#f87171', label: 'b₁*', depth: 0 });
        elements.push({ type: 'axis', p1: recOrigin, p2: b2.clone().normalize().multiplyScalar(2.5), color: '#4ade80', label: 'b₂*', depth: 0 });
        elements.push({ type: 'axis', p1: recOrigin, p2: b3.clone().normalize().multiplyScalar(2.5), color: '#60a5fa', label: 'b₃*', depth: 0 });

        // Ewald Spheres Construction
        // Incident beam points along +Z. The center of Ewald sphere of wavelength lambda
        // is at C = -s0 / lambda = (0, 0, -1/lambda) in reciprocal space!
        // Radius of Ewald sphere is R = 1/lambda.
        // For continuous polychromatic beam:
        // Outer Ewald Sphere (maximum energy / minimum wavelength lambda_min):
        const R_out = (1 / this.simulator.lambdaMin) * recScale;
        const C_out = new Vector3(0, 0, -R_out);

        // Inner Ewald Sphere (minimum energy / maximum wavelength lambda_max):
        const R_in = (1 / this.simulator.lambdaMax) * recScale;
        const C_in = new Vector3(0, 0, -R_in);

        // Add Ewald wireframe circles
        elements.push({ type: 'ewaldSphere', center: C_out, radius: R_out, color: 'rgba(56, 189, 248, 0.25)', label: `λ_min (${this.simulator.lambdaMin.toFixed(2)}Å)`, depth: C_out.z });
        elements.push({ type: 'ewaldSphere', center: C_in, radius: R_in, color: 'rgba(251, 191, 36, 0.2)', label: `λ_max (${this.simulator.lambdaMax.toFixed(2)}Å)`, depth: C_in.z });

        // Reciprocal Lattice Nodes
        const hLimit = 3;
        for (let h = -hLimit; h <= hLimit; h++) {
            for (let k = -hLimit; k <= hLimit; k++) {
                for (let l = -hLimit; l <= hLimit; l++) {
                    if (h === 0 && k === 0 && l === 0) continue;

                    const G = b1.clone().multiplyScalar(h)
                        .add(b2.clone().multiplyScalar(k))
                        .add(b3.clone().multiplyScalar(l));

                    // Check if node lies between the two Ewald spheres
                    const distFromCenterOut = G.clone().sub(C_out).length();
                    const distFromCenterIn = G.clone().sub(C_in).length();

                    // If it satisfies Laue condition for some lambda in [lambda_min, lambda_max]
                    const isDiffracting = (distFromCenterOut <= R_out * 1.02 && distFromCenterIn >= R_in * 0.98);

                    // Check if this matches selected reflection
                    const isSelected = this.selectedReflection &&
                        ((this.selectedReflection.h === h && this.selectedReflection.k === k && this.selectedReflection.l === l) ||
                         (this.selectedReflection.h === -h && this.selectedReflection.k === -k && this.selectedReflection.l === -l));

                    elements.push({
                        type: 'reciprocalNode',
                        pos: G,
                        h: h, k: k, l: l,
                        isDiffracting: isDiffracting,
                        isSelected: isSelected,
                        depth: G.z
                    });
                }
            }
        }

        // If a reflection is selected, draw its diffracted wavevector ray
        if (this.selectedReflection) {
            const ref = this.selectedReflection;
            const G_sel = b1.clone().multiplyScalar(ref.h)
                .add(b2.clone().multiplyScalar(ref.k))
                .add(b3.clone().multiplyScalar(ref.l));

            elements.push({
                type: 'diffractedRay',
                origin: new Vector3(0, 0, 0),
                target: G_sel,
                color: '#38bdf8',
                label: `k' ${ref.indicesStr}`,
                depth: G_sel.z / 2
            });
        }

        this.renderSortedElements(elements);
    }

    renderSortedElements(elements) {
        const ctx = this.ctx;

        // Project elements and sort back to front (painter's algorithm)
        elements.sort((a, b) => (b.depth || 0) - (a.depth || 0));

        for (const el of elements) {
            if (el.type === 'line') {
                const p1 = this.project(el.p1);
                const p2 = this.project(el.p2);
                if (p1 && p2) {
                    ctx.save();
                    ctx.strokeStyle = el.color;
                    ctx.lineWidth = el.width;
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                    ctx.restore();
                }
            } else if (el.type === 'axis') {
                const p1 = this.project(el.p1);
                const p2 = this.project(el.p2);
                if (p1 && p2) {
                    ctx.save();
                    ctx.strokeStyle = el.color;
                    ctx.lineWidth = 2.5;
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();

                    // Axis label
                    ctx.fillStyle = el.color;
                    ctx.font = 'bold 12px sans-serif';
                    ctx.fillText(el.label, p2.x + 4, p2.y + 4);
                    ctx.restore();
                }
            } else if (el.type === 'polygon') {
                const projPts = el.points.map(p => this.project(p)).filter(p => p !== null);
                if (projPts.length >= 3) {
                    ctx.save();
                    ctx.fillStyle = el.color;
                    ctx.strokeStyle = el.borderColor;
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(projPts[0].x, projPts[0].y);
                    for (let i = 1; i < projPts.length; i++) {
                        ctx.lineTo(projPts[i].x, projPts[i].y);
                    }
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                    ctx.restore();
                }
            } else if (el.type === 'atom') {
                const p = this.project(el.pos);
                if (p) {
                    const r = Math.max(3, el.radius * p.scale);
                    ctx.save();
                    // 3D sphere gradient highlight
                    const grad = ctx.createRadialGradient(
                        p.x - r * 0.35, p.y - r * 0.35, r * 0.1,
                        p.x, p.y, r
                    );
                    grad.addColorStop(0, '#ffffff');
                    grad.addColorStop(0.3, el.color);
                    grad.addColorStop(1, '#05070c');

                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
                    ctx.fill();

                    // Outline
                    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
                    ctx.lineWidth = 0.8;
                    ctx.stroke();
                    ctx.restore();
                }
            } else if (el.type === 'reciprocalNode') {
                const p = this.project(el.pos);
                if (p) {
                    ctx.save();
                    if (el.isSelected) {
                        // Highlight selected node
                        ctx.fillStyle = '#38bdf8';
                        ctx.shadowColor = '#38bdf8';
                        ctx.shadowBlur = 12;
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, 6, 0, 2 * Math.PI);
                        ctx.fill();
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 1.5;
                        ctx.stroke();

                        ctx.fillStyle = '#ffffff';
                        ctx.font = '11px monospace';
                        ctx.fillText(`(${el.h} ${el.k} ${el.l})`, p.x + 8, p.y - 4);
                    } else if (el.isDiffracting) {
                        // Diffracting active node (satisfies Laue condition)
                        ctx.fillStyle = '#f59e0b';
                        ctx.shadowColor = '#fbbf24';
                        ctx.shadowBlur = 8;
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
                        ctx.fill();
                    } else {
                        // Inactive node
                        ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, 2.5, 0, 2 * Math.PI);
                        ctx.fill();
                    }
                    ctx.restore();
                }
            } else if (el.type === 'ewaldSphere') {
                // Render Ewald sphere equator & meridian circles
                this.renderSphereWireframe(el.center, el.radius, el.color, el.label);
            } else if (el.type === 'diffractedRay') {
                const p1 = this.project(el.origin);
                const p2 = this.project(el.target);
                if (p1 && p2) {
                    ctx.save();
                    ctx.strokeStyle = el.color;
                    ctx.lineWidth = 2;
                    ctx.shadowColor = el.color;
                    ctx.shadowBlur = 6;
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                    ctx.restore();
                }
            }
        }
    }

    renderSphereWireframe(center, radius, color, label) {
        const ctx = this.ctx;
        const steps = 40;
        const planes = ['xy', 'xz', 'yz'];

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;

        for (const plane of planes) {
            ctx.beginPath();
            let first = true;
            for (let i = 0; i <= steps; i++) {
                const angle = (i / steps) * 2 * Math.PI;
                let pt = new Vector3();
                if (plane === 'xy') {
                    pt.set(center.x + radius * Math.cos(angle), center.y + radius * Math.sin(angle), center.z);
                } else if (plane === 'xz') {
                    pt.set(center.x + radius * Math.cos(angle), center.y, center.z + radius * Math.sin(angle));
                } else {
                    pt.set(center.x, center.y + radius * Math.cos(angle), center.z + radius * Math.sin(angle));
                }
                const p2d = this.project(pt);
                if (p2d) {
                    if (first) { ctx.moveTo(p2d.x, p2d.y); first = false; }
                    else { ctx.lineTo(p2d.x, p2d.y); }
                }
            }
            ctx.stroke();
        }

        // Center dot
        const cProj = this.project(center);
        if (cProj) {
            ctx.fillStyle = color;
            ctx.font = '10px sans-serif';
            ctx.fillText(label, cProj.x + 6, cProj.y);
        }
        ctx.restore();
    }

    renderOverlayInfo() {
        const ctx = this.ctx;
        ctx.save();
        ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
        ctx.strokeStyle = 'rgba(51, 65, 85, 0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(10, 10, 200, 48, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(this.viewMode === 'real' ? '● Real-Space Crystal' : '● Reciprocal Space & Ewald', 18, 28);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px sans-serif';
        ctx.fillText('Drag: Rotate | Scroll: Zoom', 18, 46);
        ctx.restore();
    }
}

window.Interactive3DRenderer = Interactive3DRenderer;
