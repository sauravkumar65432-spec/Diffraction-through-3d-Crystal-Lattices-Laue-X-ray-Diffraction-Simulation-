/**
 * Physics & Crystallography Engine for Laue X-Ray Diffraction Simulation
 * Accurate crystallographic calculations, structure factors, Ewald construction, and Bremsstrahlung spectrum.
 */

// Math utilities for 3D vectors and matrices
class Vector3 {
    constructor(x = 0, y = 0, z = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    clone() { return new Vector3(this.x, this.y, this.z); }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
    multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
    dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
    cross(v) {
        const x = this.y * v.z - this.z * v.y;
        const y = this.z * v.x - this.x * v.z;
        const z = this.x * v.y - this.y * v.x;
        this.x = x; this.y = y; this.z = z;
        return this;
    }
    length() { return Math.hypot(this.x, this.y, this.z); }
    lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
    normalize() {
        const len = this.length();
        if (len > 1e-9) { this.x /= len; this.y /= len; this.z /= len; }
        return this;
    }
    applyMatrix3(m) {
        const x = this.x, y = this.y, z = this.z;
        this.x = m[0] * x + m[1] * y + m[2] * z;
        this.y = m[3] * x + m[4] * y + m[5] * z;
        this.z = m[6] * x + m[7] * y + m[8] * z;
        return this;
    }
}

class Matrix3 {
    constructor(elements = [1, 0, 0, 0, 1, 0, 0, 0, 1]) {
        this.elements = [...elements];
    }

    static identity() { return new Matrix3(); }

    static fromEuler(phiDeg, chiDeg, omegaDeg) {
        const phi = (phiDeg * Math.PI) / 180;
        const chi = (chiDeg * Math.PI) / 180;
        const omega = (omegaDeg * Math.PI) / 180;

        const c1 = Math.cos(phi), s1 = Math.sin(phi);
        const c2 = Math.cos(chi), s2 = Math.sin(chi);
        const c3 = Math.cos(omega), s3 = Math.sin(omega);

        // Standard Z-X'-Z'' or Z-X-Y rotation sequence (Goniometer azimuth, tilt, spindle)
        // R = Rz(phi) * Rx(chi) * Ry(omega)
        const Rz = [c1, -s1, 0, s1, c1, 0, 0, 0, 1];
        const Rx = [1, 0, 0, 0, c2, -s2, 0, s2, c2];
        const Ry = [c3, 0, s3, 0, 1, 0, -s3, 0, c3];

        return Matrix3.multiplyMatrices(Matrix3.multiplyMatrices(new Matrix3(Rz), new Matrix3(Rx)), new Matrix3(Ry));
    }

    static multiplyMatrices(a, b) {
        const ae = a.elements, be = b.elements;
        const out = new Array(9);
        out[0] = ae[0]*be[0] + ae[1]*be[3] + ae[2]*be[6];
        out[1] = ae[0]*be[1] + ae[1]*be[4] + ae[2]*be[7];
        out[2] = ae[0]*be[2] + ae[1]*be[5] + ae[2]*be[8];

        out[3] = ae[3]*be[0] + ae[4]*be[3] + ae[5]*be[6];
        out[4] = ae[3]*be[1] + ae[4]*be[4] + ae[5]*be[7];
        out[5] = ae[3]*be[2] + ae[4]*be[5] + ae[5]*be[8];

        out[6] = ae[6]*be[0] + ae[7]*be[3] + ae[8]*be[6];
        out[7] = ae[6]*be[1] + ae[7]*be[4] + ae[8]*be[7];
        out[8] = ae[6]*be[2] + ae[7]*be[5] + ae[8]*be[8];
        return new Matrix3(out);
    }
}

// Atomic Form Factor Approximation: Cromer-Mann coefficients or simplified Gaussian sum
const ATOMIC_FORM_FACTORS = {
    'H':  { Z: 1,  mass: 1.008, color: '#FFFFFF', radius: 0.31 },
    'C':  { Z: 6,  mass: 12.01, color: '#909090', radius: 0.70 },
    'O':  { Z: 8,  mass: 16.00, color: '#FF0D0D', radius: 0.66 },
    'Na': { Z: 11, mass: 22.99, color: '#AB5CF2', radius: 1.02 },
    'Mg': { Z: 12, mass: 24.31, color: '#8AFF00', radius: 1.45 },
    'Al': { Z: 13, mass: 26.98, color: '#BFA6A6', radius: 1.18 },
    'Si': { Z: 14, mass: 28.08, color: '#F0C8A0', radius: 1.11 },
    'Cl': { Z: 17, mass: 35.45, color: '#1FF01F', radius: 1.81 },
    'Ti': { Z: 22, mass: 47.87, color: '#BFC2C7', radius: 1.40 },
    'Fe': { Z: 26, mass: 55.85, color: '#E06633', radius: 1.26 },
    'Cu': { Z: 29, mass: 63.55, color: '#C88033', radius: 1.28 },
    'Sr': { Z: 38, mass: 87.62, color: '#00FF00', radius: 1.95 },
    'Cs': { Z: 55, mass: 132.9, color: '#57178F', radius: 2.62 },
    'W':  { Z: 74, mass: 183.8, color: '#2194D6', radius: 1.39 },
    'Au': { Z: 79, mass: 196.9, color: '#FFD123', radius: 1.44 }
};

function getAtomicFormFactor(element, sinThetaOverLambda) {
    const data = ATOMIC_FORM_FACTORS[element] || { Z: 14 };
    const s = sinThetaOverLambda; // in 1/Angstrom
    // Approximation: f(s) = Z / (1 + (s * r0)^2)^2 or standard falloff
    const r0 = 0.45;
    return data.Z / Math.pow(1 + 4 * Math.PI * Math.PI * r0 * r0 * s * s, 1.2);
}

// Crystal Database Definition
const CRYSTAL_PRESETS = {
    'Si': {
        name: 'Silicon (Diamond Cubic)',
        system: 'Cubic',
        structureType: 'Diamond',
        a: 5.431, b: 5.431, c: 5.431,
        alpha: 90, beta: 90, gamma: 90,
        basis: [
            // FCC positions
            { element: 'Si', pos: [0, 0, 0] },
            { element: 'Si', pos: [0.5, 0.5, 0] },
            { element: 'Si', pos: [0.5, 0, 0.5] },
            { element: 'Si', pos: [0, 0.5, 0.5] },
            // + (1/4, 1/4, 1/4)
            { element: 'Si', pos: [0.25, 0.25, 0.25] },
            { element: 'Si', pos: [0.75, 0.75, 0.25] },
            { element: 'Si', pos: [0.75, 0.25, 0.75] },
            { element: 'Si', pos: [0.25, 0.75, 0.75] }
        ],
        description: 'Semiconductor standard. Exhibits diamond cubic extinction rules (h,k,l all unmixed, and if all even, h+k+l = 4n).'
    },
    'Al_FCC': {
        name: 'Aluminum (FCC)',
        system: 'Cubic',
        structureType: 'FCC',
        a: 4.049, b: 4.049, c: 4.049,
        alpha: 90, beta: 90, gamma: 90,
        basis: [
            { element: 'Al', pos: [0, 0, 0] },
            { element: 'Al', pos: [0.5, 0.5, 0] },
            { element: 'Al', pos: [0.5, 0, 0.5] },
            { element: 'Al', pos: [0, 0.5, 0.5] }
        ],
        description: 'Face-Centered Cubic metal. Reflections present only if h, k, l are all odd or all even.'
    },
    'Fe_BCC': {
        name: 'Alpha-Iron / Tungsten (BCC)',
        system: 'Cubic',
        structureType: 'BCC',
        a: 2.866, b: 2.866, c: 2.866,
        alpha: 90, beta: 90, gamma: 90,
        basis: [
            { element: 'Fe', pos: [0, 0, 0] },
            { element: 'Fe', pos: [0.5, 0.5, 0.5] }
        ],
        description: 'Body-Centered Cubic lattice. Systematic absence whenever h + k + l is odd.'
    },
    'NaCl': {
        name: 'Rock Salt (NaCl)',
        system: 'Cubic',
        structureType: 'Rock Salt',
        a: 5.640, b: 5.640, c: 5.640,
        alpha: 90, beta: 90, gamma: 90,
        basis: [
            // Na+ at FCC
            { element: 'Na', pos: [0, 0, 0] },
            { element: 'Na', pos: [0.5, 0.5, 0] },
            { element: 'Na', pos: [0.5, 0, 0.5] },
            { element: 'Na', pos: [0, 0.5, 0.5] },
            // Cl- at (1/2, 0, 0) + FCC
            { element: 'Cl', pos: [0.5, 0, 0] },
            { element: 'Cl', pos: [0, 0.5, 0] },
            { element: 'Cl', pos: [0, 0, 0.5] },
            { element: 'Cl', pos: [0.5, 0.5, 0.5] }
        ],
        description: 'Ionic salt. Form factors add for even h,k,l and subtract for odd h,k,l.'
    },
    'CsCl': {
        name: 'Cesium Chloride (CsCl)',
        system: 'Cubic',
        structureType: 'Simple Cubic with 2-atom basis',
        a: 4.123, b: 4.123, c: 4.123,
        alpha: 90, beta: 90, gamma: 90,
        basis: [
            { element: 'Cs', pos: [0, 0, 0] },
            { element: 'Cl', pos: [0.5, 0.5, 0.5] }
        ],
        description: 'Simple cubic primitive lattice with Cs at corner and Cl at body center.'
    },
    'Mg_HCP': {
        name: 'Magnesium (HCP)',
        system: 'Hexagonal',
        structureType: 'HCP',
        a: 3.209, b: 3.209, c: 5.211,
        alpha: 90, beta: 90, gamma: 120,
        basis: [
            { element: 'Mg', pos: [0, 0, 0] },
            { element: 'Mg', pos: [2/3, 1/3, 1/2] }
        ],
        description: 'Hexagonal close-packed metal with 6-fold / 3-fold symmetry along c-axis.'
    },
    'SrTiO3': {
        name: 'Strontium Titanate (Perovskite)',
        system: 'Cubic',
        structureType: 'Perovskite',
        a: 3.905, b: 3.905, c: 3.905,
        alpha: 90, beta: 90, gamma: 90,
        basis: [
            { element: 'Sr', pos: [0, 0, 0] },
            { element: 'Ti', pos: [0.5, 0.5, 0.5] },
            { element: 'O',  pos: [0.5, 0.5, 0] },
            { element: 'O',  pos: [0.5, 0, 0.5] },
            { element: 'O',  pos: [0, 0.5, 0.5] }
        ],
        description: 'Archetypal cubic perovskite structure used widely in oxide electronics.'
    }
};

/**
 * Calculates real and reciprocal lattice vectors for any crystal system
 */
class Crystallography {
    constructor(presetKey = 'Si', customParams = null) {
        this.setCrystal(presetKey, customParams);
    }

    setCrystal(presetKey, customParams = null) {
        const preset = CRYSTAL_PRESETS[presetKey] || CRYSTAL_PRESETS['Si'];
        this.presetKey = presetKey;
        this.name = preset.name;
        this.system = preset.system;
        this.structureType = preset.structureType;
        this.description = preset.description;

        this.a = customParams?.a ?? preset.a;
        this.b = customParams?.b ?? preset.b;
        this.c = customParams?.c ?? preset.c;
        this.alpha = customParams?.alpha ?? preset.alpha;
        this.beta = customParams?.beta ?? preset.beta;
        this.gamma = customParams?.gamma ?? preset.gamma;
        this.basis = preset.basis;

        this.calculateLatticeVectors();
    }

    calculateLatticeVectors() {
        const rad = Math.PI / 180;
        const al = this.alpha * rad;
        const be = this.beta * rad;
        const ga = this.gamma * rad;

        // Real-space lattice basis vectors (Cartesian coordinates)
        // a1 along X
        this.a1 = new Vector3(this.a, 0, 0);
        // a2 in XY plane
        this.a2 = new Vector3(this.b * Math.cos(ga), this.b * Math.sin(ga), 0);
        // a3 in general direction
        const cx = this.c * Math.cos(be);
        const cy = this.c * (Math.cos(al) - Math.cos(be) * Math.cos(ga)) / Math.sin(ga);
        const cz = Math.sqrt(Math.max(0, this.c * this.c - cx * cx - cy * cy));
        this.a3 = new Vector3(cx, cy, cz);

        // Unit cell volume V = a1 . (a2 x a3)
        const a2_cross_a3 = this.a2.clone().cross(this.a3);
        this.volume = this.a1.dot(a2_cross_a3);

        // Reciprocal lattice vectors (Crystallographic convention: |b| = 1/d)
        // b1 = (a2 x a3) / V
        // b2 = (a3 x a1) / V
        // b3 = (a1 x a2) / V
        this.b1 = a2_cross_a3.clone().multiplyScalar(1 / this.volume);
        this.b2 = this.a3.clone().cross(this.a1).multiplyScalar(1 / this.volume);
        this.b3 = this.a1.clone().cross(this.a2).multiplyScalar(1 / this.volume);
    }

    // Structure Factor F(h, k, l)
    getStructureFactor(h, k, l, sinThetaOverLambda) {
        let realPart = 0;
        let imagPart = 0;

        for (const atom of this.basis) {
            const f = getAtomicFormFactor(atom.element, sinThetaOverLambda);
            const phase = 2 * Math.PI * (h * atom.pos[0] + k * atom.pos[1] + l * atom.pos[2]);
            realPart += f * Math.cos(phase);
            imagPart += f * Math.sin(phase);
        }

        const intensityFactor = realPart * realPart + imagPart * imagPart;
        return {
            real: realPart,
            imag: imagPart,
            magnitude: Math.sqrt(intensityFactor),
            intensity: intensityFactor
        };
    }

    // Computes d-spacing for Miller indices (h, k, l)
    getDSpacing(h, k, l) {
        const Ghkl = this.b1.clone().multiplyScalar(h)
            .add(this.b2.clone().multiplyScalar(k))
            .add(this.b3.clone().multiplyScalar(l));
        const len = Ghkl.length();
        return len > 1e-9 ? 1 / len : 0;
    }
}

/**
 * Laue Simulation Engine
 * Calculates full polychromatic diffraction patterns for transmission and back-reflection geometries.
 */
class LaueSimulator {
    constructor(crystallography) {
        this.crystal = crystallography;
        this.geometry = 'transmission'; // 'transmission' or 'back-reflection'
        this.voltageKV = 35.0;           // Accelerating tube voltage in kV
        this.lambdaMin = 12.3984 / 35.0; // Duane-Hunt cutoff in Angstroms
        this.lambdaMax = 2.2;            // Upper cutoff in Angstroms
        this.detectorDistance = 40.0;    // mm (film to sample distance D)
        this.filmSize = 100.0;           // mm (square detector width/height)
        this.hMax = 6;                   // Miller index search limit
        this.beamStopRadius = 3.5;       // mm
        this.anodeTarget = 'W';          // Tungsten (white continuous Bremsstrahlung)

        // Goniometer rotation angles (degrees)
        this.phi = 0.0;   // azimuth
        this.chi = 0.0;   // tilt
        this.omega = 0.0; // spindle rotation
    }

    setVoltage(kV) {
        this.voltageKV = Math.max(5.0, Math.min(80.0, kV));
        // Duane-Hunt Law: lambda_min = hc / (e * V)
        this.lambdaMin = 12.3984 / this.voltageKV;
    }

    setOrientation(phi, chi, omega) {
        this.phi = phi;
        this.chi = chi;
        this.omega = omega;
    }

    // Continuous X-ray spectrum intensity (Bremsstrahlung with Duane-Hunt limit)
    getSpectralIntensity(lambda) {
        if (lambda < this.lambdaMin || lambda > this.lambdaMax) return 0;
        // Kramers' law: I(lambda) ~ (1 / lambda^2) * (1/lambda_min - 1/lambda)
        const term = (1 / this.lambdaMin) - (1 / lambda);
        if (term <= 0) return 0;
        const bremsstrahlung = (1 / (lambda * lambda)) * term;
        // Window absorption falloff at long wavelengths
        const absorption = Math.exp(-0.35 * Math.pow(lambda, 2.5));
        return Math.max(0, bremsstrahlung * absorption);
    }

    // Identifies prominent crystal zone axis [u v w] that reflection belongs to
    identifyZoneAxis(h, k, l) {
        const principalZones = [
            { u: 0, v: 0, w: 1, name: '[001]' },
            { u: 1, v: 0, w: 0, name: '[100]' },
            { u: 0, v: 1, w: 0, name: '[010]' },
            { u: 1, v: 1, w: 0, name: '[110]' },
            { u: 1, v: -1, w: 0, name: '[1-10]' },
            { u: 1, v: 1, w: 1, name: '[111]' },
            { u: 1, v: -1, w: 1, name: '[1-11]' },
            { u: 1, v: 1, w: -1, name: '[11-1]' },
            { u: 1, v: 0, w: 1, name: '[101]' },
            { u: 0, v: 1, w: 1, name: '[011]' },
            { u: 1, v: 1, w: 2, name: '[112]' }
        ];

        for (const zone of principalZones) {
            if (zone.u * h + zone.v * k + zone.w * l === 0) {
                return zone.name;
            }
        }
        return 'General';
    }

    // Simulates all active reflections
    simulate() {
        const rotationMatrix = Matrix3.fromEuler(this.phi, this.chi, this.omega);
        const incidentBeam = new Vector3(0, 0, 1); // Incident ray along +Z

        const activeReflections = [];
        const hMax = this.hMax;
        const D = this.detectorDistance;
        const halfFilm = this.filmSize / 2;

        for (let h = -hMax; h <= hMax; h++) {
            for (let k = -hMax; k <= hMax; k++) {
                for (let l = -hMax; l <= hMax; l++) {
                    if (h === 0 && k === 0 && l === 0) continue;

                    // Reciprocal vector in crystal coordinates
                    const G_cryst = this.crystal.b1.clone().multiplyScalar(h)
                        .add(this.crystal.b2.clone().multiplyScalar(k))
                        .add(this.crystal.b3.clone().multiplyScalar(l));

                    const G_len = G_cryst.length();
                    if (G_len < 1e-9) continue;
                    const d_spacing = 1 / G_len;

                    // Transform G to laboratory frame
                    const G_lab = G_cryst.clone().applyMatrix3(rotationMatrix.elements);

                    // Bragg condition vector formulation:
                    // s - s0 = lambda * G
                    // |s0 + lambda * G|^2 = 1 => 2 * (s0 . G) + lambda * |G|^2 = 0
                    // lambda = -2 * (s0 . G) / |G|^2
                    // For lambda > 0, we must have (s0 . G) < 0.
                    let Gz = G_lab.z;
                    let h_active = h, k_active = k, l_active = l;
                    let G_active = G_lab.clone();

                    if (Gz > 0) {
                        // Reflect from back side of plane (-h, -k, -l)
                        G_active.multiplyScalar(-1);
                        Gz = -Gz;
                        h_active = -h;
                        k_active = -k;
                        l_active = -l;
                    }

                    // Avoid duplicate processing if already handled opposite index
                    if (h_active < 0 || (h_active === 0 && k_active < 0) || (h_active === 0 && k_active === 0 && l_active < 0)) {
                        // Keep canonical representation
                    }

                    const G2 = G_len * G_len;
                    const lambda = (-2 * G_active.z) / G2;

                    // Check wavelength bounds
                    if (lambda < this.lambdaMin || lambda > this.lambdaMax) continue;

                    // Bragg glancing angle theta
                    const sinTheta = (lambda * G_len) / 2;
                    if (sinTheta <= 0 || sinTheta >= 1) continue;
                    const thetaRad = Math.asin(sinTheta);
                    const twoThetaRad = 2 * thetaRad;

                    // Structure factor
                    const sinThetaOverLambda = sinTheta / lambda;
                    const F = this.crystal.getStructureFactor(h_active, k_active, l_active, sinThetaOverLambda);
                    if (F.intensity < 1e-4) continue; // Forbidden reflection (systematic absence)

                    // Scattered ray direction unit vector
                    const s = incidentBeam.clone().add(G_active.clone().multiplyScalar(lambda));
                    s.normalize();

                    let xFilm = 0, yFilm = 0;
                    let isValidGeometry = false;

                    if (this.geometry === 'transmission') {
                        // Transmission: ray must proceed forward (sz > 0)
                        if (s.z > 0.05) {
                            const t = D / s.z;
                            xFilm = t * s.x;
                            yFilm = t * s.y;
                            isValidGeometry = true;
                        }
                    } else {
                        // Back-reflection: ray must scatter backward toward source (sz < 0)
                        if (s.z < -0.05) {
                            const t = -D / s.z;
                            xFilm = -t * s.x;
                            yFilm = -t * s.y;
                            isValidGeometry = true;
                        }
                    }

                    if (!isValidGeometry) continue;

                    // Check if within detector film area
                    if (Math.abs(xFilm) > halfFilm || Math.abs(yFilm) > halfFilm) continue;

                    const rFilm = Math.hypot(xFilm, yFilm);
                    // Check beam stop shadow in transmission
                    const isBlocked = (this.geometry === 'transmission' && rFilm < this.beamStopRadius);

                    // Physical Intensity Calculation
                    const spectralI = this.getSpectralIntensity(lambda);
                    // Lorentz-polarization factor for stationary single-crystal polychromatic Laue
                    const cos2Theta = Math.cos(twoThetaRad);
                    const sin2Theta = Math.sin(twoThetaRad);
                    const Lp = (1 + cos2Theta * cos2Theta) / (2 * Math.sin(thetaRad) * Math.sin(thetaRad) * Math.cos(thetaRad));
                    
                    const rawIntensity = F.intensity * spectralI * Lp;

                    activeReflections.push({
                        h: h_active,
                        k: k_active,
                        l: l_active,
                        indicesStr: `(${h_active} ${k_active} ${l_active})`,
                        lambda: lambda,
                        dSpacing: d_spacing,
                        thetaDeg: (thetaRad * 180) / Math.PI,
                        twoThetaDeg: (twoThetaRad * 180) / Math.PI,
                        xFilm: xFilm,
                        yFilm: yFilm,
                        rFilm: rFilm,
                        intensity: rawIntensity,
                        structureFactor: F.magnitude,
                        isBlocked: isBlocked,
                        zone: this.identifyZoneAxis(h_active, k_active, l_active),
                        rayDir: s,
                        G_vector: G_active
                    });
                }
            }
        }

        // Normalize intensities relative to max reflection
        let maxI = 0;
        for (const ref of activeReflections) {
            if (ref.intensity > maxI) maxI = ref.intensity;
        }
        if (maxI > 0) {
            for (const ref of activeReflections) {
                ref.normIntensity = ref.intensity / maxI;
            }
        }

        // Sort by intensity descending
        activeReflections.sort((a, b) => b.intensity - a.intensity);

        return activeReflections;
    }

    // Calculates analytical conic curves for major crystal zone axes on detector
    getZoneCurves() {
        const rotationMatrix = Matrix3.fromEuler(this.phi, this.chi, this.omega);
        const D = this.detectorDistance;
        const halfFilm = this.filmSize / 2;

        const zonesToTrace = [
            { u: 0, v: 0, w: 1, label: '[001]', color: '#38bdf8' },
            { u: 1, v: 0, w: 0, label: '[100]', color: '#f43f5e' },
            { u: 0, v: 1, w: 0, label: '[010]', color: '#10b981' },
            { u: 1, v: 1, w: 0, label: '[110]', color: '#fbbf24' },
            { u: 1, v: -1, w: 0, label: '[1-10]', color: '#a855f7' },
            { u: 1, v: 1, w: 1, label: '[111]', color: '#ec4899' },
            { u: 1, v: -1, w: 1, label: '[1-11]', color: '#06b6d4' }
        ];

        const curves = [];

        for (const zone of zonesToTrace) {
            // Zone axis in real space
            const z_cryst = this.crystal.a1.clone().multiplyScalar(zone.u)
                .add(this.crystal.a2.clone().multiplyScalar(zone.v))
                .add(this.crystal.a3.clone().multiplyScalar(zone.w));

            const len = z_cryst.length();
            if (len < 1e-9) continue;
            const z_unit = z_cryst.clone().normalize();

            // Transform zone axis to laboratory frame
            const z_lab = z_unit.clone().applyMatrix3(rotationMatrix.elements);

            // Angle alpha between zone axis and incident beam s0 (0, 0, 1)
            const cosAlpha = z_lab.z;
            const sinAlpha = Math.sqrt(Math.max(0, 1 - cosAlpha * cosAlpha));

            // Diffracted rays form a cone of semi-angle alpha around zone axis z_lab!
            // s . z_lab = s0 . z_lab = cosAlpha
            // We sample the cone by rotating around z_lab
            const points = [];
            const numSteps = 120;

            // Coordinate system with z_axis along z_lab
            let perp1 = new Vector3(0, 1, 0).cross(z_lab);
            if (perp1.length() < 0.1) perp1 = new Vector3(1, 0, 0).cross(z_lab);
            perp1.normalize();
            const perp2 = z_lab.clone().cross(perp1).normalize();

            for (let i = 0; i < numSteps; i++) {
                const psi = (i / (numSteps - 1)) * 2 * Math.PI;
                // Ray on cone
                const ray = z_lab.clone().multiplyScalar(cosAlpha)
                    .add(perp1.clone().multiplyScalar(sinAlpha * Math.cos(psi)))
                    .add(perp2.clone().multiplyScalar(sinAlpha * Math.sin(psi)));

                ray.normalize();

                if (this.geometry === 'transmission') {
                    if (ray.z > 0.08) {
                        const t = D / ray.z;
                        const x = t * ray.x;
                        const y = t * ray.y;
                        if (Math.abs(x) <= halfFilm * 1.3 && Math.abs(y) <= halfFilm * 1.3) {
                            points.push({ x, y });
                        }
                    }
                } else {
                    if (ray.z < -0.08) {
                        const t = -D / ray.z;
                        const x = -t * ray.x;
                        const y = -t * ray.y;
                        if (Math.abs(x) <= halfFilm * 1.3 && Math.abs(y) <= halfFilm * 1.3) {
                            points.push({ x, y });
                        }
                    }
                }
            }

            if (points.length > 5) {
                curves.push({
                    zone: zone.label,
                    color: zone.color,
                    points: points
                });
            }
        }

        return curves;
    }
}

// Export classes to global window scope for modularity
window.Vector3 = Vector3;
window.Matrix3 = Matrix3;
window.Crystallography = Crystallography;
window.LaueSimulator = LaueSimulator;
window.CRYSTAL_PRESETS = CRYSTAL_PRESETS;
window.ATOMIC_FORM_FACTORS = ATOMIC_FORM_FACTORS;
