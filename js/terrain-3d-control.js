/**
 * Controller for Three Dimensional Terrain
 */
import { trackEvent } from './analytics.js';
import { MapContextMessagesControl } from './map-context-messages-control.js';

// Geometry of the side-elevation guide in the panel, in its 132x72 viewBox.
// The camera swings on a radius around the point it is aimed at, which sits on
// the ground line; the profile is a normalised skyline scaled by amplitude.
const SCENE = {
    width: 132,
    height: 72,
    originX: 66,
    originY: 56,
    radius: 42,
    maxAmplitude: 34,
    profile: [[20, 0.28], [31, 0.1], [45, 0.78], [57, 0.34], [70, 1], [84, 0.4], [96, 0.62], [110, 0.16]]
};

// The panel's map-layer chips. These are ordinary atlas layers rather than
// anything the terrain engine owns, so they are toggled through the same
// handler the layer browser uses - which also pulls a layer in from the
// registry when the current atlas doesn't include it.
//
// Buildings come from either vendor's tiles, styled identically (see the two
// atlas configs), so the choice is about data coverage rather than looks.
const BUILDING_SOURCES = {
    mapbox: { label: 'Mapbox Streets', layerId: 'mapbox-3d-buildings' },
    osm: { label: 'OpenStreetMap', layerId: 'osm-3d-buildings' }
};

const CONTOURS_LAYER = 'mapbox-terrain-v2';

function findLayerGroupIndex(layerId) {
    const groups = window.layerControl?._state?.groups || [];
    return groups.findIndex(g => g.id === layerId || g._prefixedId === layerId || g._originalId === layerId);
}

function isAtlasLayerVisible(layerId) {
    const index = findLayerGroupIndex(layerId);
    if (index === -1) return false;
    const element = window.layerControl?._sourceControls?.[index];
    return !!element?.querySelector('.toggle-switch input[type="checkbox"]')?.checked;
}

export class Terrain3DControl {
    constructor(options = {}) {
        this.options = {
            initialExaggeration: 1.5,
            minExaggeration: 0,
            maxExaggeration: 20.0,
            step: 0.5,
            ...options
        };

        this._enabled = false; // Default to disabled for lazy loading
        this._exaggeration = this.options.initialExaggeration;
        this._animate = false; // Default to disabled
        this._showWireframe = false; // Default to disabled
        this._enableFog = true; // Default to enabled
        this._visualizeSound = false; // Default to disabled
        this._fov = 0.643; // Default FOV in radians (~36.87°)
        this._bearing = 0; // Default bearing (rotation) in degrees
        this._pitch = 0; // Default pitch (tilt) in degrees
        this._animationFrame = null; // For requestAnimationFrame
        this._panel = null;
        this._map = null;
        this._terrainSource = 'mapbox'; // Default to Mapbox terrain
        this._buildingSource = 'mapbox'; // Which vendor's building tiles the chip toggles
        this._initializing = false; // Flag to prevent URL updates during initialization
        this._pitchListener = null; // Track pitch change listener for cleanup
        this._autoPitchAnimationFrame = null;
        this._autoPitchAnimating = false;
        // Last pitch the panel's own animation wrote, so a pitch that no
        // longer matches it can be recognised as the user's own choice.
        this._autoPitchLastSet = null;
        this._pitchBeforePanel = null;
        this._syncCallback = null; // Optional callback fired after visual updates (e.g. compare/swipe)
        this._autoEnableMessageId = null; // Context message shown when terrain auto-enables from a tilt gesture
        this._autoEnableMessageTimer = null;

        // Audio visualization properties
        this._audioContext = null;
        this._analyser = null;
        this._microphone = null;
        this._audioStream = null;
        this._audioAnimationFrame = null;
        this._baseExaggeration = this.options.initialExaggeration; // Store base value

        // Define terrain sources
        this._terrainSources = {
            'mapbox': {
                name: 'Mapbox Terrain',
                sourceConfig: {
                    'type': 'raster-dem',
                    'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
                    'tileSize': 512,
                    'maxzoom': 14
                },
                sourceId: 'mapbox-dem'
            },
            'cartodem': {
                name: 'ISRO CartoDEM 30m',
                sourceConfig: {
                    'type': 'raster-dem',
                    'tiles': [
                        'https://indianopenmaps.fly.dev/dem/terrain-rgb/cartodem-v3r1/bhuvan/{z}/{x}/{y}.webp'
                    ],
                    'tileSize': 512,
                    'attribution': 'ISRO/Bhuvan CartoDEM'
                },
                sourceId: 'cartodem',
                hillshadeLayerId: 'cartodem-hillshade'
            }
        };
    }

    onAdd(map) {
        this._map = map;

        // Initialize bearing and pitch from current map state
        this._bearing = this._map.getBearing();
        this._pitch = this._map.getPitch();

        // Create container with jQuery
        this._container = $('<div>', {
            class: 'mapboxgl-ctrl mapboxgl-ctrl-group'
        })[0];

        // Create button with jQuery
        const $button = $('<button>', {
            class: 'mapboxgl-ctrl-icon',
            type: 'button',
            'aria-label': '3D Controls',
            css: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '30px',
                height: '30px',
                fontSize: '12px',
                fontWeight: 'bold',
                color: '#666'
            }
        });

        // Create 3D text
        const $text = $('<span>', {
            text: '3D',
            css: {
                display: 'block',
                lineHeight: '1'
            }
        });

        // Add event handlers using jQuery
        $button
            .append($text)
            .on('click', () => {
                this._togglePanel();
            })
            .on('mouseenter', function () {
                $(this).css('backgroundColor', '#f0f0f0');
            })
            .on('mouseleave', function () {
                $(this).css('backgroundColor', '#ffffff');
            })
            .appendTo(this._container);

        // Create panel
        this._createPanel();

        return this._container;
    }

    onRemove() {
        // Stop animation if running
        this._stopAnimation();

        // Stop audio visualization if running
        this._stopAudioVisualization();

        // Remove pitch listener
        this.removePitchListener();

        this._closeAutoEnabledMessage();

        if (this._panel) {
            $(this._panel).remove();
        }
        $(this._container).remove();
        this._map = undefined;
    }

    // The panel's markup. Styling lives in css/styles.css (.terrain-3d-* /
    // .t3d-*), sharing map-browser.html's palette. Element ids are unchanged so
    // the public setters and initializeFromURL keep addressing the same nodes.
    _panelHtml() {
        const { minExaggeration, maxExaggeration, step } = this.options;
        const sources = Object.entries(this._terrainSources)
            .map(([key, config]) =>
                `<option value="${key}"${key === this._terrainSource ? ' selected' : ''}>${config.name}</option>`)
            .join('');
        const buildingSources = Object.entries(BUILDING_SOURCES)
            .map(([key, config]) =>
                `<option value="${key}"${key === this._buildingSource ? ' selected' : ''}>${config.label} buildings</option>`)
            .join('');

        return `
        <div class="t3d-header">
            <span class="t3d-title"><sl-icon name="badge-3d"></sl-icon>3D Terrain</span>
            <button type="button" class="t3d-close terrain-3d-close-button" aria-label="Close">&times;</button>
        </div>
        <div class="t3d-body">
            <svg class="t3d-scene" viewBox="0 0 132 72" role="img"
                 aria-label="Side view of the camera angle and terrain height. Drag to tilt.">
                <path class="t3d-scene-arc" d="M66,14 A42,42 0 0,1 107.8,52.3"></path>
                <path class="t3d-scene-profile" d=""></path>
                <line class="t3d-scene-ground" x1="8" y1="56" x2="124" y2="56"></line>
                <line class="t3d-scene-ray" x1="66" y1="14" x2="66" y2="56"></line>
                <g class="t3d-scene-cam" transform="translate(66,14)">
                    <rect x="-5.5" y="-5" width="11" height="8" rx="2.5"></rect>
                    <path d="M-3.2,3 L3.2,3 L2,6.8 L-2,6.8 Z"></path>
                </g>
            </svg>

            <div class="t3d-row">
                <div class="t3d-row-head">
                    <span class="t3d-label"><sl-icon name="triangle"></sl-icon>Tilt</span>
                    <button type="button" class="t3d-value" id="terrain-3d-pitch-value" title="Reset to top-down">0&deg;</button>
                </div>
                <input type="range" class="t3d-slider" id="terrain-3d-pitch-slider" min="0" max="85" step="1" value="0">
                <div class="t3d-scale"><span>Top-down</span><span>Horizon</span></div>
            </div>

            <div id="terrain-3d-controls-container">
                <div class="t3d-row">
                    <div class="t3d-row-head">
                        <span class="t3d-label"><sl-icon name="arrow-bar-up"></sl-icon>Vertical Scale</span>
                        <button type="button" class="t3d-value" id="terrain-3d-exaggeration-value" title="Reset to default">1.5&times;</button>
                    </div>
                    <input type="range" class="t3d-slider" id="terrain-3d-exaggeration-slider"
                           min="${minExaggeration}" max="${maxExaggeration}" step="${step}" value="${this._exaggeration}">
                    <div class="t3d-scale"><span>Flat</span><span>${maxExaggeration}&times;</span></div>
                </div>
            </div>

            <div class="t3d-chips">
                <label class="t3d-chip" title="Toggle 3D terrain">
                    <input type="checkbox" id="terrain-3d-enabled"><span>3D</span>
                </label>
                <select class="t3d-select" id="terrain-source-select" aria-label="Terrain source">${sources}</select>
            </div>

            <div class="t3d-chips t3d-chips-sub">
                <label class="t3d-chip" title="Extruded building footprints">
                    <input type="checkbox" id="terrain-3d-buildings"><span>3D Buildings</span>
                </label>
                <label class="t3d-chip" title="Elevation contour lines from Mapbox Terrain">
                    <input type="checkbox" id="terrain-3d-contours"><span>Contours</span>
                </label>
            </div>

            <div class="t3d-chips t3d-chips-sub t3d-building-source" hidden>
                <select class="t3d-select" id="terrain-3d-building-source" aria-label="Building source">${buildingSources}</select>
            </div>

            <details class="t3d-more">
                <summary class="t3d-more-toggle"><sl-icon name="chevron-right"></sl-icon>More options</summary>
                <div class="t3d-more-body">
                    <div class="t3d-row">
                        <div class="t3d-row-head">
                            <span class="t3d-label"><sl-icon name="arrow-counterclockwise"></sl-icon>Rotation</span>
                            <button type="button" class="t3d-value" id="terrain-3d-bearing-value" title="Reset to North">0&deg;</button>
                        </div>
                        <input type="range" class="t3d-slider" id="terrain-3d-bearing-slider" min="0" max="360" step="1" value="0">
                    </div>
                    <div class="t3d-row">
                        <div class="t3d-row-head">
                            <span class="t3d-label"><sl-icon name="arrows-angle-expand"></sl-icon>Perspective</span>
                            <button type="button" class="t3d-value" id="terrain-3d-fov-value" title="Reset to default">36.8&deg;</button>
                        </div>
                        <input type="range" class="t3d-slider" id="terrain-3d-fov-slider" min="0.1" max="1.5" step="0.01" value="0.643">
                    </div>
                    <label class="t3d-check"><input type="checkbox" id="terrain-3d-wireframe"><span>Show terrain mesh</span></label>
                    <label class="t3d-check"><input type="checkbox" id="terrain-3d-fog" checked><span>Atmospheric fog</span></label>
                    <label class="t3d-check"><input type="checkbox" id="terrain-3d-animate"><span>Orbit around location</span></label>
                    <label class="t3d-check"><input type="checkbox" id="terrain-3d-sound"><span>Dancing terrain (microphone)</span></label>
                    <button type="button" class="t3d-reset" id="terrain-3d-reset">Reset to defaults</button>
                </div>
            </details>
        </div>`;
    }

    _createPanel() {
        this._panel = $('<div>', { class: 'terrain-3d-panel' }).html(this._panelHtml());
        const find = (selector) => this._panel.find(selector);

        this._sceneEl = find('.t3d-scene')[0];
        this._sceneProfile = find('.t3d-scene-profile')[0];
        this._sceneGround = find('.t3d-scene-ground')[0];
        this._sceneRay = find('.t3d-scene-ray')[0];
        this._sceneCam = find('.t3d-scene-cam')[0];

        const defaults = {
            bearing: 0,
            pitch: 0,
            fov: 0.643,
            exaggeration: this.options.initialExaggeration,
            source: 'mapbox',
            wireframe: false
        };

        // Each row's value chip doubles as its reset: it only lights up, and
        // only accepts a click, once the value is off its default.
        const readout = ($value, format, defaultValue, epsilon, apply) => {
            const render = (value) => {
                $value.text(format(value)).toggleClass('is-modified', Math.abs(value - defaultValue) > epsilon);
            };
            $value.on('click', () => {
                if ($value.hasClass('is-modified')) apply(defaultValue);
            });
            return render;
        };

        const $pitchSlider = find('#terrain-3d-pitch-slider');
        const $exaggerationSlider = find('#terrain-3d-exaggeration-slider');
        const $bearingSlider = find('#terrain-3d-bearing-slider');
        const $fovSlider = find('#terrain-3d-fov-slider');

        // The UI setters are stored on the instance so the public setters, the
        // pitch animation and initializeFromURL can all refresh the panel
        // without reaching back into the DOM by id.
        this._setPitchUI = (value) => {
            $pitchSlider.val(value);
            renderPitch(value);
            this._renderScene();
        };
        this._setExaggerationUI = (value) => {
            $exaggerationSlider.val(value);
            renderExaggeration(value);
            this._renderScene();
        };
        this._setBearingUI = (value) => {
            $bearingSlider.val(value);
            renderBearing(value);
        };
        this._setFovUI = (value) => {
            $fovSlider.val(value);
            renderFov(value);
        };

        const applyPitch = (value) => {
            // Any hand-set tilt ends the panel's intro animation and becomes the
            // user's own (see _hidePanel).
            this._cancelAutoPitch();
            this._pitch = Math.max(0, Math.min(85, value));
            this._setPitchUI(this._pitch);
            this._updatePitch();
        };

        const applyExaggeration = (value) => {
            this._exaggeration = value;
            this._setExaggerationUI(value);
            if (this._enabled) this._updateTerrain();
        };

        const renderPitch = readout(find('#terrain-3d-pitch-value'),
            v => `${Math.round(v)}°`, defaults.pitch, 0.1, applyPitch);
        const renderExaggeration = readout(find('#terrain-3d-exaggeration-value'),
            v => `${v.toFixed(1)}×`, defaults.exaggeration, 0.01, applyExaggeration);
        const renderBearing = readout(find('#terrain-3d-bearing-value'),
            v => `${Math.round(v)}°`, defaults.bearing, 0.1, v => this.setBearing(v));
        const renderFov = readout(find('#terrain-3d-fov-value'),
            v => `${(v * (180 / Math.PI)).toFixed(1)}°`, defaults.fov, 0.001, v => this.setFov(v));

        this._setPitchUI(this._pitch);
        this._setExaggerationUI(this._exaggeration);
        this._setBearingUI(this._bearing);
        this._setFovUI(this._fov);

        $pitchSlider.on('input', (e) => applyPitch(parseFloat(e.target.value)));
        $exaggerationSlider.on('input', (e) => applyExaggeration(parseFloat(e.target.value)));
        $bearingSlider.on('input', (e) => this.setBearing(parseFloat(e.target.value)));
        $fovSlider.on('input', (e) => this.setFov(parseFloat(e.target.value)));

        // Dragging the camera around its arc is the direct way to tilt; the
        // slider below is the same value by another route.
        const pitchFromPointer = (event) => {
            const rect = this._sceneEl.getBoundingClientRect();
            const x = ((event.clientX - rect.left) / rect.width) * SCENE.width;
            const y = ((event.clientY - rect.top) / rect.height) * SCENE.height;
            return Math.atan2(x - SCENE.originX, SCENE.originY - y) * (180 / Math.PI);
        };
        this._sceneEl.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            this._sceneEl.setPointerCapture(event.pointerId);
            applyPitch(pitchFromPointer(event));
        });
        this._sceneEl.addEventListener('pointermove', (event) => {
            if (this._sceneEl.hasPointerCapture(event.pointerId)) applyPitch(pitchFromPointer(event));
        });

        find('#terrain-3d-enabled').on('change', (e) => {
            this._enabled = e.target.checked;
            trackEvent('terrain_3d_toggle', { enabled: this._enabled });
            find('#terrain-3d-controls-container').css('display', this._enabled ? 'block' : 'none');
            this._updateTerrain();
        });

        find('#terrain-source-select').on('change', (e) => {
            this._terrainSource = e.target.value;
            this._updateTerrain();
            this._updateTerrainSourceURLParameter();
        });

        find('#terrain-3d-buildings').on('change', (e) => {
            this.setAtlasLayerVisible(this._buildingLayerId(), e.target.checked);
            find('.t3d-building-source').prop('hidden', !e.target.checked);
        });

        find('#terrain-3d-building-source').on('change', (e) => this.setBuildingSource(e.target.value));

        find('#terrain-3d-contours').on('change', (e) => this.setAtlasLayerVisible(CONTOURS_LAYER, e.target.checked));

        find('#terrain-3d-wireframe').on('change', (e) => this.setWireframe(e.target.checked));
        find('#terrain-3d-fog').on('change', (e) => this.setFog(e.target.checked));
        find('#terrain-3d-animate').on('change', (e) => this.setAnimate(e.target.checked));
        find('#terrain-3d-sound').on('change', (e) => this.setVisualizeSound(e.target.checked));

        find('#terrain-3d-reset').on('click', () => {
            this.setTerrainSource(defaults.source);
            this.setEnabled(true);
            this.setExaggeration(defaults.exaggeration);
            this.setWireframe(defaults.wireframe);
            this.setFov(defaults.fov);
            this.setBearing(defaults.bearing);
            applyPitch(defaults.pitch);
        });

        find('.t3d-close').on('click', () => this._hidePanel());

        // Close when clicking outside the panel or its toggle button
        $(document).on('click.terrain3d', (e) => {
            if (!$(e.target).closest('.terrain-3d-panel, .mapboxgl-ctrl-icon').length) {
                this._hidePanel();
            }
        });

        $(this._map.getContainer()).append(this._panel);
        this._renderScene();
    }

    // Redraws the side-elevation guide: the terrain silhouette's amplitude
    // tracks the vertical scale (square-rooted, since the useful range is
    // bunched at the low end) and the camera rides its arc at the map's pitch.
    _renderScene() {
        if (!this._sceneProfile) return;

        const amplitude = SCENE.maxAmplitude *
            Math.sqrt(Math.max(0, this._exaggeration) / this.options.maxExaggeration);
        const peaks = SCENE.profile
            .map(([x, height]) => ` L${x},${(SCENE.originY - height * amplitude).toFixed(1)}`)
            .join('');
        this._sceneProfile.setAttribute('d', `M8,${SCENE.originY}${peaks} L124,${SCENE.originY} Z`);

        const pitch = Math.max(0, Math.min(85, this._pitch));
        const radians = pitch * (Math.PI / 180);
        const x = SCENE.originX + SCENE.radius * Math.sin(radians);
        const y = SCENE.originY - SCENE.radius * Math.cos(radians);
        this._sceneCam.setAttribute('transform', `translate(${x.toFixed(2)},${y.toFixed(2)}) rotate(${pitch.toFixed(1)})`);
        this._sceneRay.setAttribute('x1', x.toFixed(2));
        this._sceneRay.setAttribute('y1', y.toFixed(2));
    }

    _buildingLayerId(source = this._buildingSource) {
        return BUILDING_SOURCES[source].layerId;
    }

    // Reads the map-layer chips back off the layer control, which is the
    // authority - any of them can also be switched from the layer browser, the
    // URL or the shortcut menu while this panel is closed. A visible buildings
    // layer also tells us which source is in play, so the select needs no state
    // of its own in the URL.
    _syncAtlasLayerChips() {
        if (!this._panel) return;

        const visibleSource = Object.keys(BUILDING_SOURCES)
            .find(source => isAtlasLayerVisible(this._buildingLayerId(source)));
        if (visibleSource) this._buildingSource = visibleSource;

        this._panel.find('#terrain-3d-buildings').prop('checked', !!visibleSource);
        this._panel.find('#terrain-3d-building-source').val(this._buildingSource);
        this._panel.find('.t3d-building-source').prop('hidden', !visibleSource);
        this._panel.find('#terrain-3d-contours').prop('checked', isAtlasLayerVisible(CONTOURS_LAYER));
    }

    _cancelAutoPitch() {
        if (this._autoPitchAnimationFrame) {
            cancelAnimationFrame(this._autoPitchAnimationFrame);
            this._autoPitchAnimationFrame = null;
        }
        this._autoPitchAnimating = false;
    }

    _togglePanel() {
        if (this._panel.css('display') === 'none') {
            this._showPanel();
        } else {
            this._hidePanel();
        }
    }

    _showPanel() {
        $(this._panel).show();
        this._closeAutoEnabledMessage();
        this._syncAtlasLayerChips();

        // Lazy load: enable terrain when panel is opened for the first time
        if (!this._enabled) {
            this.setEnabled(true);
        }

        // Auto-animate pitch to 50° if the map is flat. Read the pitch off the
        // map rather than this._pitch, which only tracks changes made through
        // this panel and goes stale the moment the map is tilted by a drag.
        const currentPitch = this._map ? this._map.getPitch() : this._pitch;
        if (Math.abs(currentPitch) < 0.5) {
            this._pitchBeforePanel = currentPitch;
            this._animatePitch(currentPitch, 50, 2000);
        } else {
            this._pitchBeforePanel = null;
            this._autoPitchLastSet = null;
            // Already tilted: show that tilt on the slider instead of whatever
            // this panel last set.
            this._pitch = currentPitch;
            this._setPitchUI?.(currentPitch);
        }
    }

    _hidePanel() {
        this._cancelAutoPitch();

        // Undo the tilt the panel introduced, but only while it is still the
        // tilt the panel set. Moving the slider, dragging the map or hitting
        // the camera Reset button all leave the pitch somewhere this control
        // didn't put it, and that choice is the user's to keep. Compare
        // against the map rather than this._pitch, since a drag on the map
        // never reaches this control's own copy.
        const currentPitch = this._map ? this._map.getPitch() : this._pitch;
        const stillOurs = this._autoPitchLastSet !== null
            && Math.abs(currentPitch - this._autoPitchLastSet) < 0.5;
        if (this._pitchBeforePanel !== null && stillOurs) {
            this._animatePitch(currentPitch, this._pitchBeforePanel, 2000);
        }
        this._pitchBeforePanel = null;

        $(this._panel).hide();
    }

    _animatePitch(from, to, duration) {
        this._cancelAutoPitch();

        const start = performance.now();
        const easeOut = t => 1 - Math.pow(1 - t, 3);

        const animate = (now) => {
            const t = Math.min((now - start) / duration, 1);
            const pitch = from + (to - from) * easeOut(t);

            this._pitch = pitch;
            this._autoPitchLastSet = pitch;
            this._setPitchUI?.(pitch);
            this._updatePitch();

            if (t < 1) {
                this._autoPitchAnimationFrame = requestAnimationFrame(animate);
            } else {
                this._autoPitchAnimationFrame = null;
                this._autoPitchAnimating = false;
            }
        };

        this._autoPitchAnimating = true;
        this._autoPitchAnimationFrame = requestAnimationFrame(animate);
    }

    _updateTerrain() {
        if (!this._map) return;

        // Skip terrain updates during initialization to prevent interference with layer creation
        if (this._initializing) {
            return;
        }

        if (this._enabled) {
            const terrainConfig = this._terrainSources[this._terrainSource];
            if (!terrainConfig) {
                console.warn(`Unknown terrain source: ${this._terrainSource}`);
                return;
            }

            // Check if we already have the correct terrain source active
            const currentTerrain = this._map.getTerrain();
            const targetSourceExists = this._map.getSource(terrainConfig.sourceId);

            if (currentTerrain && currentTerrain.source === terrainConfig.sourceId && targetSourceExists) {
                // Same source is already active, just update exaggeration
                this._map.setTerrain({
                    'source': terrainConfig.sourceId,
                    'exaggeration': this._exaggeration
                });
                this._updateURLParameter();
                this._notifySync();
                return;
            }

            // First, disable terrain if it's currently active to avoid conflicts
            if (currentTerrain) {
                this._map.setTerrain(null);
            }

            // Remove existing terrain sources and layers (now safe since terrain is disabled)
            this._removeExistingTerrainSources();

            // Add the selected terrain source
            if (!this._map.getSource(terrainConfig.sourceId)) {
                this._map.addSource(terrainConfig.sourceId, terrainConfig.sourceConfig);
            }

            // For CartoDEM, also add hillshade layer
            if (this._terrainSource === 'cartodem' && terrainConfig.hillshadeLayerId) {
                if (!this._map.getLayer(terrainConfig.hillshadeLayerId)) {
                    this._map.addLayer({
                        'id': terrainConfig.hillshadeLayerId,
                        'type': 'hillshade',
                        'source': terrainConfig.sourceId
                    });
                }
            }

            // Set terrain with the new source
            this._map.setTerrain({
                'source': terrainConfig.sourceId,
                'exaggeration': this._exaggeration
            });
        } else {
            // Disable terrain, remove sources
            this._map.setTerrain(null);
            this._removeExistingTerrainSources();
        }

        // Update fog separately based on fog setting
        this._updateFog();

        // Update URL parameter
        this._updateURLParameter();

        this._notifySync();
    }

    _removeExistingTerrainSources() {
        // Remove all terrain sources and associated layers
        Object.values(this._terrainSources).forEach(config => {
            try {
                // Remove hillshade layer if it exists
                if (config.hillshadeLayerId && this._map.getLayer(config.hillshadeLayerId)) {
                    this._map.removeLayer(config.hillshadeLayerId);
                }

                // Remove source if it exists
                if (this._map.getSource(config.sourceId)) {
                    this._map.removeSource(config.sourceId);
                }
            } catch (error) {
                console.warn(`Error removing terrain source ${config.sourceId}:`, error);
            }
        });
    }

    _updateURLParameter() {
        // Skip URL updates during initialization to prevent encoding issues
        if (this._initializing) {
            return;
        }

        // Use URL API if available, otherwise fall back to direct URL manipulation
        if (window.urlManager && window.urlManager.updateTerrainParam) {
            if (this._enabled) {
                window.urlManager.updateTerrainParam(this._exaggeration);
            } else {
                window.urlManager.updateTerrainParam(0);
            }
        } else {
            // Fallback to direct URL manipulation
            const url = new URL(window.location);
            if (this._enabled) {
                url.searchParams.set('terrain', this._exaggeration.toString());
            } else {
                url.searchParams.delete('terrain');
            }

            // Update URL without reloading the page
            window.history.replaceState({}, '', url);
        }
    }

    _updateAnimation() {
        if (this._animate) {
            this._startAnimation();
        } else {
            this._stopAnimation();
        }

        // Update URL parameter
        this._updateAnimationURLParameter();
    }

    _startAnimation() {
        if (!this._map || this._animationFrame) return;

        const rotateCamera = (timestamp) => {
            // clamp the rotation between 0 -360 degrees
            // Divide timestamp by 100 to slow rotation to ~10 degrees / sec
            this._map.rotateTo((timestamp / 100) % 360, {duration: 0});
            // Request the next frame of the animation.
            this._animationFrame = requestAnimationFrame(rotateCamera);
        };

        // Start the animation
        this._animationFrame = requestAnimationFrame(rotateCamera);
    }

    _stopAnimation() {
        if (this._animationFrame) {
            cancelAnimationFrame(this._animationFrame);
            this._animationFrame = null;
        }
    }

    _updateAnimationURLParameter() {
        // Skip URL updates during initialization to prevent encoding issues
        if (this._initializing) {
            return;
        }

        // Use URL API if available, otherwise fall back to direct URL manipulation
        if (window.urlManager && window.urlManager.updateAnimateParam) {
            window.urlManager.updateAnimateParam(this._animate);
        } else {
            // Fallback to direct URL manipulation
            const url = new URL(window.location);
            if (this._animate) {
                url.searchParams.set('animate', 'true');
            } else {
                url.searchParams.delete('animate');
            }

            // Update URL without reloading the page
            window.history.replaceState({}, '', url);
        }
    }

    _updateFog() {
        if (!this._map) return;

        if (this._enableFog) {
            // Set fog with the specified configuration
            this._map.setFog({
                'range': [-0.5, 10],
                'color': '#def',
                'high-color': '#def',
                'space-color': '#def'
            });
        } else {
            // Disable fog
            this._map.setFog(null);
        }

        // Update URL parameter
        this._updateFogURLParameter();

        this._notifySync();
    }

    _updateWireframe() {
        if (!this._map) return;

        // Toggle the terrain wireframe debug feature
        this._map.showTerrainWireframe = this._showWireframe;

        // Update URL parameter
        this._updateWireframeURLParameter();

        this._notifySync();
    }

    _updateFov() {
        if (!this._map) return;

        // Set the field of view using internal API
        this._map.transform._fov = this._fov;
        this._map.transform._calcMatrices();
        this._map.triggerRepaint();

        // Update URL parameter
        this._updateFovURLParameter();

        this._notifySync();
    }

    _updateBearing() {
        if (!this._map) return;

        this._map.setBearing(this._bearing);

        // Update URL parameter
        this._updateBearingURLParameter();
    }

    _updatePitch() {
        if (!this._map) return;

        this._map.setPitch(this._pitch);

        // Update URL parameter
        this._updatePitchURLParameter();
    }

    // Register a callback fired after any terrain/fog/fov/wireframe update so
    // external consumers (e.g. the compare/swipe after-map) can mirror state.
    // Pass null to clear.
    setSyncCallback(callback) {
        this._syncCallback = typeof callback === 'function' ? callback : null;
    }

    _notifySync() {
        if (this._syncCallback) {
            try {
                this._syncCallback();
            } catch (error) {
                console.warn('Error in terrain sync callback:', error);
            }
        }
    }

    _resetToDefaults() {
        // Reset all values to defaults
        this.setTerrainSource('mapbox');
        this.setAnimate(false);
        this.setFog(true);
        this.setEnabled(true);
        this.setExaggeration(this.options.initialExaggeration);
        this.setWireframe(false);
        this.setVisualizeSound(false);
        this.setFov(0.643);
        this.setBearing(0);
        this.setPitch(0);
    }

    _updateWireframeURLParameter() {
        // Skip URL updates during initialization to prevent encoding issues
        if (this._initializing) {
            return;
        }

        // Use URL API if available, otherwise fall back to direct URL manipulation
        if (window.urlManager && window.urlManager.updateWireframeParam) {
            window.urlManager.updateWireframeParam(this._showWireframe);
        } else {
            // Fallback to direct URL manipulation
            const url = new URL(window.location);
            if (this._showWireframe) {
                url.searchParams.set('wireframe', 'true');
            } else {
                url.searchParams.delete('wireframe');
            }

            // Update URL without reloading the page
            window.history.replaceState({}, '', url);
        }
    }

    _updateFovURLParameter() {
        // Skip URL updates during initialization to prevent encoding issues
        if (this._initializing) {
            return;
        }

        // Use URL API if available, otherwise fall back to direct URL manipulation
        if (window.urlManager && window.urlManager.updateFovParam) {
            window.urlManager.updateFovParam(this._fov);
        } else {
            // Fallback to direct URL manipulation
            const url = new URL(window.location);
            // Only set if not default (0.643 is default)
            if (Math.abs(this._fov - 0.643) > 0.001) {
                url.searchParams.set('fov', this._fov.toFixed(3));
            } else {
                url.searchParams.delete('fov');
            }

            // Update URL without reloading the page
            window.history.replaceState({}, '', url);
        }
    }

    _updateBearingURLParameter() {
        // Skip URL updates during initialization to prevent encoding issues
        if (this._initializing) {
            return;
        }

        // Use URL API if available, otherwise fall back to direct URL manipulation
        if (window.urlManager && window.urlManager.updateBearingParam) {
            window.urlManager.updateBearingParam(this._bearing);
        } else {
            // Fallback to direct URL manipulation
            const url = new URL(window.location);
            // Only set if not default (0 is default)
            if (Math.abs(this._bearing) > 0.1) {
                url.searchParams.set('bearing', this._bearing.toFixed(0));
            } else {
                url.searchParams.delete('bearing');
            }

            // Update URL without reloading the page
            window.history.replaceState({}, '', url);
        }
    }

    _updatePitchURLParameter() {
        // Skip URL updates during initialization to prevent encoding issues
        if (this._initializing) {
            return;
        }

        // Use URL API if available, otherwise fall back to direct URL manipulation
        if (window.urlManager && window.urlManager.updatePitchParam) {
            window.urlManager.updatePitchParam(this._pitch);
        } else {
            // Fallback to direct URL manipulation
            const url = new URL(window.location);
            // Only set if not default (0 is default)
            if (Math.abs(this._pitch) > 0.1) {
                url.searchParams.set('pitch', this._pitch.toFixed(0));
            } else {
                url.searchParams.delete('pitch');
            }

            // Update URL without reloading the page
            window.history.replaceState({}, '', url);
        }
    }

    _updateFogURLParameter() {
        // Skip URL updates during initialization to prevent encoding issues
        if (this._initializing) {
            return;
        }

        // Use URL API if available, otherwise fall back to direct URL manipulation
        if (window.urlManager && window.urlManager.updateFogParam) {
            window.urlManager.updateFogParam(this._enableFog);
        } else {
            // Fallback to direct URL manipulation
            const url = new URL(window.location);
            if (!this._enableFog) { // Only set if not default (default is true)
                url.searchParams.set('fog', 'false');
            } else {
                url.searchParams.delete('fog');
            }

            // Update URL without reloading the page
            window.history.replaceState({}, '', url);
        }
    }

    _updateTerrainSourceURLParameter() {
        // Skip URL updates during initialization to prevent encoding issues
        if (this._initializing) {
            return;
        }

        // Use URL API if available, otherwise fall back to direct URL manipulation
        if (window.urlManager && window.urlManager.updateTerrainSourceParam) {
            window.urlManager.updateTerrainSourceParam(this._terrainSource);
        } else {
            // Fallback to direct URL manipulation
            const url = new URL(window.location);
            if (this._terrainSource !== 'mapbox') { // Only set if not default
                url.searchParams.set('terrainSource', this._terrainSource);
            } else {
                url.searchParams.delete('terrainSource');
            }

            // Update URL without reloading the page
            window.history.replaceState({}, '', url);
        }
    }

    // Public methods for external control

    // Opens the 3D Controls panel, e.g. from the auto-enable context message's
    // "Vertical Scale" link. Pass focusExaggeration to scroll/focus that slider.
    showPanel(focusExaggeration = false) {
        this._showPanel();
        if (focusExaggeration) {
            const slider = document.getElementById('terrain-3d-exaggeration-slider');
            slider?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            slider?.focus();
        }
    }

    // Shows or hides one of the map layers behind the panel's chips. The atlas
    // that defines it is loaded on demand, since it may not be the one in view.
    async setAtlasLayerVisible(layerId, visible) {
        await window.layerRegistry?.ensureAtlasLoaded?.(layerId.split('-')[0]);
        await window.browserControl?._handleLayerToggle(layerId, visible);
    }

    // Switches which vendor's building tiles the Buildings chip draws. Carries
    // the layer over live when it is already on, so the map swaps sources
    // rather than going blank.
    async setBuildingSource(source) {
        if (!BUILDING_SOURCES[source] || source === this._buildingSource) return;

        const previousLayerId = this._buildingLayerId();
        const wasVisible = isAtlasLayerVisible(previousLayerId);
        this._buildingSource = source;
        this._panel?.find('#terrain-3d-building-source').val(source);

        if (!wasVisible) return;
        await this.setAtlasLayerVisible(previousLayerId, false);
        await this.setAtlasLayerVisible(this._buildingLayerId(), true);
    }

    getBuildingSource() {
        return this._buildingSource;
    }

    setEnabled(enabled) {
        this._closeAutoEnabledMessage();
        this._enabled = enabled;
        $('#terrain-3d-enabled').prop('checked', enabled);
        // Show/hide terrain controls container based on enabled state
        $('#terrain-3d-controls-container').css('display', enabled ? 'block' : 'none');
        this._updateTerrain();
    }

    setExaggeration(exaggeration) {
        this._exaggeration = Math.max(this.options.minExaggeration,
            Math.min(this.options.maxExaggeration, exaggeration));
        this._setExaggerationUI?.(this._exaggeration);
        if (this._enabled) {
            this._updateTerrain();
        }
    }

    getEnabled() {
        return this._enabled;
    }

    getExaggeration() {
        return this._exaggeration;
    }

    setAnimate(animate) {
        this._animate = animate;
        $('#terrain-3d-animate').prop('checked', animate);
        this._updateAnimation();
    }

    getAnimate() {
        return this._animate;
    }

    setWireframe(wireframe) {
        this._showWireframe = wireframe;
        $('#terrain-3d-wireframe').prop('checked', wireframe);
        this._updateWireframe();
    }

    getWireframe() {
        return this._showWireframe;
    }

    setTerrainSource(source) {
        if (this._terrainSources[source]) {
            this._terrainSource = source;
            $('#terrain-source-select').val(source);
            this._updateTerrain();
            this._updateTerrainSourceURLParameter();
        }
    }

    getTerrainSource() {
        return this._terrainSource;
    }

    setFog(enableFog) {
        this._enableFog = enableFog;
        $('#terrain-3d-fog').prop('checked', enableFog);
        this._updateFog();
    }

    getFog() {
        return this._enableFog;
    }

    setVisualizeSound(visualizeSound) {
        this._visualizeSound = visualizeSound;
        $('#terrain-3d-sound').prop('checked', visualizeSound);
        this._updateAudioVisualization();
    }

    getVisualizeSound() {
        return this._visualizeSound;
    }

    setFov(fov) {
        this._fov = Math.max(0.1, Math.min(1.5, fov));
        this._setFovUI?.(this._fov);
        this._updateFov();
    }

    getFov() {
        return this._fov;
    }

    setBearing(bearing) {
        this._bearing = bearing % 360;
        if (this._bearing < 0) this._bearing += 360;
        this._setBearingUI?.(this._bearing);
        this._updateBearing();
    }

    getBearing() {
        return this._bearing;
    }

    setPitch(pitch) {
        this._pitch = Math.max(0, Math.min(85, pitch));
        this._setPitchUI?.(this._pitch);
        this._updatePitch();
    }

    getPitch() {
        return this._pitch;
    }

    async _updateAudioVisualization() {
        if (this._visualizeSound) {
            await this._startAudioVisualization();
        } else {
            this._stopAudioVisualization();
        }

        // Update URL parameter
        this._updateSoundURLParameter();
    }

    async _startAudioVisualization() {
        if (this._audioContext) return; // Already running

        try {
            // Request microphone access
            this._audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Create audio context and analyser
            this._audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this._analyser = this._audioContext.createAnalyser();
            this._analyser.fftSize = 256;

            // Connect microphone to analyser
            this._microphone = this._audioContext.createMediaStreamSource(this._audioStream);
            this._microphone.connect(this._analyser);

            // Store the current exaggeration as base
            this._baseExaggeration = this._exaggeration;

            // Start visualization loop
            const visualize = () => {
                if (!this._visualizeSound) return;

                const bufferLength = this._analyser.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);
                this._analyser.getByteFrequencyData(dataArray);

                // Calculate average volume (0-255)
                const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;

                // Map volume to exaggeration multiplier (0.5x to 3x of base)
                // Normalize average from 0-255 to 0-1, then scale
                const normalizedVolume = average / 255;
                const multiplier = 0.5 + (normalizedVolume * 2.5);
                const newExaggeration = Math.max(
                    this.options.minExaggeration,
                    Math.min(this.options.maxExaggeration, this._baseExaggeration * multiplier)
                );

                // Update terrain exaggeration
                this._exaggeration = newExaggeration;
                this._setExaggerationUI?.(this._exaggeration);

                if (this._enabled && this._map) {
                    const terrainConfig = this._terrainSources[this._terrainSource];
                    if (terrainConfig && this._map.getSource(terrainConfig.sourceId)) {
                        this._map.setTerrain({
                            'source': terrainConfig.sourceId,
                            'exaggeration': this._exaggeration
                        });
                    }
                }

                // Continue animation
                this._audioAnimationFrame = requestAnimationFrame(visualize);
            };

            visualize();
        } catch (error) {
            console.error('Error accessing microphone:', error);
            alert('Unable to access microphone. Please grant microphone permissions and try again.');
            this._visualizeSound = false;
            $('#terrain-3d-sound').prop('checked', false);
        }
    }

    _stopAudioVisualization() {
        // Stop animation loop
        if (this._audioAnimationFrame) {
            cancelAnimationFrame(this._audioAnimationFrame);
            this._audioAnimationFrame = null;
        }

        // Disconnect and close audio nodes
        if (this._microphone) {
            this._microphone.disconnect();
            this._microphone = null;
        }

        if (this._analyser) {
            this._analyser = null;
        }

        if (this._audioContext) {
            this._audioContext.close();
            this._audioContext = null;
        }

        // Stop audio stream
        if (this._audioStream) {
            this._audioStream.getTracks().forEach(track => track.stop());
            this._audioStream = null;
        }

        // Restore base exaggeration
        if (this._baseExaggeration !== undefined) {
            this.setExaggeration(this._baseExaggeration);
        }
    }

    _updateSoundURLParameter() {
        // Skip URL updates during initialization to prevent encoding issues
        if (this._initializing) {
            return;
        }

        // Use URL API if available, otherwise fall back to direct URL manipulation
        if (window.urlManager && window.urlManager.updateSoundParam) {
            window.urlManager.updateSoundParam(this._visualizeSound);
        } else {
            // Fallback to direct URL manipulation
            const url = new URL(window.location);
            if (this._visualizeSound) {
                url.searchParams.set('sound', 'true');
            } else {
                url.searchParams.delete('sound');
            }

            // Update URL without reloading the page
            window.history.replaceState({}, '', url);
        }
    }

    // Method to initialize from URL parameter
    initializeFromURL() {
        // Set initialization flag to prevent URL updates during initialization
        this._initializing = true;

        const urlParams = new URLSearchParams(window.location.search);
        const terrainParam = urlParams.get('terrain');
        const animateParam = urlParams.get('animate');
        const wireframeParam = urlParams.get('wireframe');
        const terrainSourceParam = urlParams.get('terrainSource');
        const fogParam = urlParams.get('fog');
        const soundParam = urlParams.get('sound');
        const fovParam = urlParams.get('fov');
        const bearingParam = urlParams.get('bearing');
        const pitchParam = urlParams.get('pitch');

        // Handle terrain source parameter first
        if (terrainSourceParam && this._terrainSources[terrainSourceParam]) {
            this.setTerrainSource(terrainSourceParam);
        } else {
            this.setTerrainSource('mapbox');
        }

        if (terrainParam) {
            const exaggeration = parseFloat(terrainParam);
            if (!isNaN(exaggeration)) {
                if (exaggeration === 0) {
                    // Explicitly disabled
                    this.setEnabled(false);
                } else if (exaggeration >= this.options.minExaggeration &&
                    exaggeration <= this.options.maxExaggeration) {
                    // Valid exaggeration value
                    this.setExaggeration(exaggeration);
                    this.setEnabled(true);
                }
            }
        } else {
            // No terrain parameter in URL - keep terrain disabled
            this.setEnabled(false);
        }

        // Handle animate parameter
        if (animateParam === 'true') {
            this.setAnimate(true);
        } else {
            this.setAnimate(false);
        }

        // Handle wireframe parameter
        if (wireframeParam === 'true') {
            this.setWireframe(true);
        } else {
            this.setWireframe(false);
        }

        // Handle fog parameter
        if (fogParam === 'false') {
            this.setFog(false);
        } else {
            this.setFog(true);
        }

        // Handle sound parameter
        if (soundParam === 'true') {
            this.setVisualizeSound(true);
        } else {
            this.setVisualizeSound(false);
        }

        // Handle fov parameter
        if (fovParam) {
            const fov = parseFloat(fovParam);
            if (!isNaN(fov) && fov >= 0.1 && fov <= 1.5) {
                this.setFov(fov);
            }
        }

        // Handle bearing parameter
        if (bearingParam) {
            const bearing = parseFloat(bearingParam);
            if (!isNaN(bearing)) {
                this.setBearing(bearing);
            }
        } else if (this._map) {
            this._bearing = this._map.getBearing();
            this._setBearingUI?.(this._bearing);
        }

        // Handle pitch parameter
        if (pitchParam) {
            const pitch = parseFloat(pitchParam);
            if (!isNaN(pitch) && pitch >= 0 && pitch <= 85) {
                this.setPitch(pitch);
            }
        } else if (this._map) {
            this._pitch = this._map.getPitch();
            this._setPitchUI?.(this._pitch);
        }

        // Clear initialization flag to allow normal URL updates
        this._initializing = false;
    }

    setupPitchListener() {
        if (!this._map || this._pitchListener) return;

        const setupTime = Date.now();
        const initialLoadGracePeriod = 6000;

        this._pitchListener = () => {
            const timeSinceSetup = Date.now() - setupTime;
            if (timeSinceSetup < initialLoadGracePeriod) {
                return;
            }

            const pitch = this._map.getPitch();
            if (pitch > 0 && !this._enabled) {
                this.setEnabled(true);
                this._showAutoEnabledMessage();
            }
        };

        this._map.on('pitch', this._pitchListener);
    }

    removePitchListener() {
        if (this._map && this._pitchListener) {
            this._map.off('pitch', this._pitchListener);
            this._pitchListener = null;
        }
    }

    // Shown when terrain auto-enables from a camera tilt gesture (rather than
    // the user explicitly opening the 3D panel), so they know why the terrain
    // changed and can quickly tune or undo it.
    _showAutoEnabledMessage() {
        this._closeAutoEnabledMessage();
        this._autoEnableMessageId = MapContextMessagesControl.show(
            '3D terrain enabled. Change <a href="#" onclick="window.terrain3DControl?.showPanel(true);return false;">Vertical Scale</a> ' +
            'to enhance terrain or <a href="#" onclick="window.terrain3DControl?.setEnabled(false);return false;">Disable</a> to improve performance',
            { id: 'terrain-3d-auto-enabled' }
        );
        this._autoEnableMessageTimer = setTimeout(() => this._closeAutoEnabledMessage(), 10000);
    }

    _closeAutoEnabledMessage() {
        clearTimeout(this._autoEnableMessageTimer);
        this._autoEnableMessageTimer = null;
        if (this._autoEnableMessageId) {
            MapContextMessagesControl.close(this._autoEnableMessageId);
            this._autoEnableMessageId = null;
        }
    }
}
