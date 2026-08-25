/**
 * MapLinks Control - A Mapbox GL JS control for displaying map navigation links
 */
export class ButtonExternalMapLinks {
    constructor(options = {}) {
        this._map = null;
        this._container = null;
        this._button = null;
        this.modalId = 'map-links-modal';
        this._modal = null;
        this._closeButton = null;
        this._searchInput = null;
        this._clearSearchButton = null;
        this._tagsBar = null;
        this._activeTag = null;

        this._pinnedLat = null;
        this._pinnedLng = null;

        this._handleButtonClick = this._handleButtonClick.bind(this);
        this._handleCloseClick = this._handleCloseClick.bind(this);
    }

    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';

        this._button = document.createElement('button');
        this._button.className = 'mapboxgl-ctrl-icon';
        this._button.type = 'button';
        this._button.setAttribute('aria-label', 'Open map in external services');
        this._button.innerHTML = `<sl-icon name="box-arrow-up-right" style="font-size: 20px;"></sl-icon>`;

        this._button.addEventListener('click', this._handleButtonClick);
        this._container.appendChild(this._button);

        this._createModal();

        return this._container;
    }

    onRemove() {
        if (this._button) {
            this._button.removeEventListener('click', this._handleButtonClick);
        }

        if (this._closeButton) {
            this._closeButton.removeEventListener('click', this._handleCloseClick);
        }

        if (this._searchInput) {
            this._searchInput.removeEventListener('input', this._handleSearchInput);
        }

        if (this._clearSearchButton) {
            this._clearSearchButton.removeEventListener('click', this._handleSearchInput);
        }

        if (this._modal && this._modal.parentNode) {
            this._modal.parentNode.removeChild(this._modal);
        }

        if (this._container && this._container.parentNode) {
            this._container.parentNode.removeChild(this._container);
        }

        this._map = null;
        this._container = null;
        this._button = null;
        this._modal = null;
        this._closeButton = null;
        this._searchInput = null;
        this._clearSearchButton = null;
        this._tagsBar = null;
    }

    _createModal() {
        const styleHTML = `
            <style>
                .map-links-modal::part(panel) {
                    background: #111827;
                    border: 1px solid #374151;
                    max-width: 900px;
                }
                .map-links-modal::part(header) {
                    background: #111827;
                    border-bottom: 1px solid #374151;
                    color: #f3f4f6;
                }
                .map-links-modal::part(title) {
                    color: #f3f4f6;
                    font-weight: 600;
                }
                .map-links-modal::part(body) {
                    background: #111827;
                    padding: 20px;
                }
                .map-links-modal::part(footer) {
                    background: #111827;
                    border-top: 1px solid #374151;
                }
                .map-links-section {
                    margin-bottom: 24px;
                }
                .map-links-section-title {
                    color: #f3f4f6;
                    font-size: 15px;
                    font-weight: 600;
                    margin-bottom: 12px;
                    padding-left: 4px;
                }
                .map-links-tags-bar {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 6px;
                    padding: 0 0 14px 0;
                }
                .map-links-tag-chip {
                    font-size: 11px;
                    font-weight: 600;
                    color: #9ca3af;
                    background: #1f2937;
                    border: 1px solid #374151;
                    border-radius: 999px;
                    padding: 4px 12px;
                    cursor: pointer;
                    transition: all 0.15s ease;
                    white-space: nowrap;
                }
                .map-links-tag-chip:hover {
                    color: #f3f4f6;
                    border-color: #4b5563;
                }
                .map-links-tag-chip.active {
                    color: #ffffff;
                    background: #3b82f6;
                    border-color: #3b82f6;
                }
                .map-links-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
                    gap: 8px;
                }
                .map-link-card {
                    position: relative;
                    background: #1f2937;
                    border: 1px solid #374151;
                    border-radius: 8px;
                    padding: 12px 8px;
                    cursor: pointer;
                    transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 8px;
                    text-align: center;
                    text-decoration: none;
                    min-height: 96px;
                }
                .map-link-card:hover {
                    background: #374151;
                    border-color: #4b5563;
                    transform: translateY(-1px);
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
                }
                .map-link-icon, .map-link-text-icon {
                    width: 40px;
                    height: 40px;
                    border-radius: 8px;
                    object-fit: contain;
                    flex-shrink: 0;
                }
                .map-link-text-icon {
                    background: rgba(235, 235, 235, 1);
                    color: #1f2937;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: 700;
                    text-align: center;
                    padding: 4px;
                    word-wrap: break-word;
                    line-height: 1.1;
                }
                .map-link-name {
                    color: #f3f4f6;
                    font-weight: 500;
                    font-size: 12px;
                    line-height: 1.3;
                    display: -webkit-box;
                    -webkit-line-clamp: 2;
                    -webkit-box-orient: vertical;
                    overflow: hidden;
                }
                .map-link-open-hint {
                    position: absolute;
                    top: 6px;
                    right: 6px;
                    color: #9ca3af;
                    opacity: 0;
                    transition: opacity 0.15s ease;
                }
                .map-link-card:hover .map-link-open-hint {
                    opacity: 1;
                }
                .map-link-tooltip {
                    position: absolute;
                    bottom: calc(100% + 8px);
                    left: 50%;
                    transform: translateX(-50%);
                    width: 240px;
                    max-width: 70vw;
                    background: #0b1220;
                    border: 1px solid #374151;
                    border-radius: 8px;
                    padding: 10px 12px;
                    color: #d1d5db;
                    font-size: 11px;
                    font-weight: 400;
                    line-height: 1.55;
                    text-align: left;
                    opacity: 0;
                    visibility: hidden;
                    pointer-events: none;
                    transition: opacity 0.15s ease, visibility 0.15s ease;
                    z-index: 60;
                    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
                }
                .map-link-tooltip::after {
                    content: '';
                    position: absolute;
                    top: 100%;
                    left: 50%;
                    transform: translateX(-50%);
                    border: 6px solid transparent;
                    border-top-color: #0b1220;
                }
                .map-link-card:hover .map-link-tooltip {
                    opacity: 1;
                    visibility: visible;
                }
            </style>
        `;

        const modalHTML = `
            <sl-dialog id="${this.modalId}" label="Map Services" class="map-links-modal">
                <div style="padding: 0 0 16px 0;">
                    <p style="color: #9ca3af; font-size: 13px; line-height: 1.5; margin: 0 0 12px 0;">
                        Open the current map location in any of these services to access additional data, imagery, and analysis tools.
                    </p>
                    <div style="position: relative;">
                        <input type="text"
                               id="${this.modalId}-search"
                               placeholder="Search services..."
                               style="width: 100%;
                                      padding: 8px 32px 8px 12px;
                                      border: 1px solid #374151;
                                      border-radius: 6px;
                                      background: #1f2937;
                                      color: #f3f4f6;
                                      font-size: 13px;
                                      outline: none;
                                      transition: border-color 0.2s;">
                        <button id="${this.modalId}-clear-search"
                                style="position: absolute;
                                       right: 8px;
                                       top: 50%;
                                       transform: translateY(-50%);
                                       background: transparent;
                                       border: none;
                                       color: #9ca3af;
                                       cursor: pointer;
                                       font-size: 16px;
                                       padding: 4px 8px;
                                       display: none;
                                       transition: color 0.2s;"
                                onmouseover="this.style.color='#f3f4f6'"
                                onmouseout="this.style.color='#9ca3af'">✕</button>
                    </div>
                </div>
                <div class="map-links-tags-bar"></div>
                <div class="map-links-coords-bar" style="display:flex;align-items:center;gap:8px;padding:4px 0 12px 0;"></div>
                <div class="map-links-container"></div>
                <sl-button slot="footer" variant="neutral" id="${this.modalId}-close" class="map-links-btn">Close</sl-button>
            </sl-dialog>
        `;

        document.head.insertAdjacentHTML('beforeend', styleHTML);
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        this._modal = document.getElementById(this.modalId);
        this._closeButton = document.getElementById(`${this.modalId}-close`);
        this._searchInput = document.getElementById(`${this.modalId}-search`);
        this._clearSearchButton = document.getElementById(`${this.modalId}-clear-search`);
        this._tagsBar = this._modal.querySelector('.map-links-tags-bar');

        if (this._tagsBar) {
            this._tagsBar.addEventListener('click', (e) => {
                const chip = e.target.closest('[data-tag]');
                if (!chip) return;
                const tag = chip.dataset.tag;
                this._activeTag = (tag === '__all__') ? null : tag;
                this._showModal();
            });
        }

        if (this._closeButton) {
            this._closeButton.addEventListener('click', this._handleCloseClick);
        }

        if (this._searchInput) {
            this._searchInput.addEventListener('input', () => this._handleSearchInput());
            this._searchInput.addEventListener('focus', (e) => {
                e.target.style.borderColor = '#3b82f6';
            });
            this._searchInput.addEventListener('blur', (e) => {
                e.target.style.borderColor = '#374151';
            });
        }

        if (this._clearSearchButton) {
            this._clearSearchButton.addEventListener('click', () => {
                this._searchInput.value = '';
                this._handleSearchInput();
            });
        }
    }

    _handleButtonClick() {
        this._showModal();
    }

    _handleCloseClick() {
        if (this._modal) {
            this._modal.hide();
        }
        this._pinnedLat = null;
        this._pinnedLng = null;
    }

    _handleSearchInput() {
        const searchTerm = this._searchInput.value.toLowerCase().trim();

        if (searchTerm) {
            this._clearSearchButton.style.display = 'block';
        } else {
            this._clearSearchButton.style.display = 'none';
        }

        this._showModal();
    }

    showAtCoordinates(lat, lng) {
        this._pinnedLat = lat;
        this._pinnedLng = lng;
        this._showModal();
    }

    _showModal() {
        if (!this._modal || !this._map) return;

        const container = this._modal.querySelector('.map-links-container');

        const center = this._map.getCenter();
        const zoom = Math.round(this._map.getZoom());
        const lat = this._pinnedLat ?? center.lat;
        const lng = this._pinnedLng ?? center.lng;

        const coordsBar = this._modal.querySelector('.map-links-coords-bar');
        if (coordsBar) {
            coordsBar.innerHTML = `
                <span style="font-size:12px;color:#94a3b8;">
                    ${lat.toFixed(6)}, ${lng.toFixed(6)}
                </span>
                <button class="coords-copy-btn" style="
                    background:#1e293b;border:1px solid #334155;color:#e2e8f0;
                    padding:2px 8px;border-radius:3px;cursor:pointer;font-size:11px;
                ">Copy</button>
            `;
            coordsBar.querySelector('.coords-copy-btn')?.addEventListener('click', () => {
                const btn = coordsBar.querySelector('.coords-copy-btn');
                navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
                btn.textContent = 'Copied!';
                setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
            });
        }

        const links = this._generateNavigationLinks(lat, lng, zoom);
        const searchTerm = this._searchInput ? this._searchInput.value.toLowerCase().trim() : '';

        this._renderTagChips(links);

        let filteredLinks = links;
        if (this._activeTag) {
            filteredLinks = filteredLinks.filter(link => (link.tags || []).includes(this._activeTag));
        }
        if (searchTerm) {
            filteredLinks = filteredLinks.filter(link => this._matchesSearch(link, searchTerm))
                .sort((a, b) => this._getSearchPriority(a, searchTerm) - this._getSearchPriority(b, searchTerm));
        }

        const goaLinks = filteredLinks.filter(link => link.category === 'india');
        const globalLinks = filteredLinks.filter(link => link.category === 'global');

        if (filteredLinks.length === 0) {
            const reason = searchTerm ? `matching "${searchTerm}"` : `tagged "${this._activeTag}"`;
            container.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: #9ca3af;">
                    <p style="font-size: 14px;">No services found ${reason}</p>
                </div>
            `;
        } else {
            const renderSection = (sectionLinks, title) => `
                <div class="map-links-section">
                    <h3 class="map-links-section-title">${title}</h3>
                    <div class="map-links-grid">
                        ${sectionLinks.map(link => this._createLinkCard(link)).join('')}
                    </div>
                </div>
            `;

            container.innerHTML = `
                ${goaLinks.length > 0 ? renderSection(goaLinks, 'India') : ''}
                ${globalLinks.length > 0 ? renderSection(globalLinks, 'Global') : ''}
            `;
        }

        this._modal.show();
    }

    _renderTagChips(links) {
        if (!this._tagsBar) return;

        const tags = [...new Set(links.flatMap(link => link.tags || []))].sort();
        const chip = (tag, label) =>
            `<button class="map-links-tag-chip${(this._activeTag === tag || (tag === null && !this._activeTag)) ? ' active' : ''}" data-tag="${tag ?? '__all__'}">${label}</button>`;

        this._tagsBar.innerHTML = [
            chip(null, 'All'),
            ...tags.map(tag => chip(tag, tag))
        ].join('');
    }

    _matchesSearch(link, term) {
        const name = (link.name || '').toLowerCase();
        const description = (link.description || '').toLowerCase();
        const tags = (link.tags || []).map(t => t.toLowerCase()).join(' ');

        return name.includes(term) || tags.includes(term) || description.includes(term);
    }

    _getSearchPriority(link, term) {
        const name = (link.name || '').toLowerCase();
        const tags = (link.tags || []).map(t => t.toLowerCase()).join(' ');
        const description = (link.description || '').toLowerCase();

        if (name.includes(term)) return 1;
        if (tags.includes(term)) return 2;
        if (description.includes(term)) return 3;
        return 4;
    }

    _createLinkCard(link) {
        let thumbnailHTML;
        if (link.icon) {
            // Check if icon is HTML or image URL
            if (link.icon.trim().startsWith('<')) {
                // Icon is HTML - render directly
                thumbnailHTML = `<div class="map-link-text-icon">${link.icon}</div>`;
            } else {
                // Icon is image URL
                const defaultText = link.name.substring(0, 2).toUpperCase();
                const fontSize = defaultText.length > 3 ? '10px' : defaultText.length > 2 ? '14px' : '18px';
                thumbnailHTML = `
                    <img src="${link.icon}" alt="${link.name}" class="map-link-icon" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    <div class="map-link-text-icon" style="display:none; font-size: ${fontSize};">${defaultText}</div>
                `;
            }
        } else {
            // No icon, use default text
            const defaultText = link.name.substring(0, 2).toUpperCase();
            const fontSize = defaultText.length > 3 ? '10px' : defaultText.length > 2 ? '14px' : '18px';
            thumbnailHTML = `<div class="map-link-text-icon" style="font-size: ${fontSize};">${defaultText}</div>`;
        }

        return `
            <a href="${link.url}" target="_blank" rel="noopener noreferrer" class="map-link-card" data-link-id="${link.id}" title="${link.name}">
                <sl-icon name="box-arrow-up-right" class="map-link-open-hint" style="font-size: 13px;"></sl-icon>
                ${thumbnailHTML}
                <div class="map-link-name">${link.name}</div>
                ${link.description ? `<div class="map-link-tooltip">${link.description}</div>` : ''}
            </a>
        `;
    }

    _generateNavigationLinks(lat, lng, zoom) {
        // Calculate mercator coordinates for One Map Goa
        const mercatorCoords = this._latLngToMercator(lat, lng);
        const oneMapGoaLayerList = "&cl=goa_village%2Cgoa_taluka%2Cgoa_district%2Cgoa_collectorate%2Cgoa_constituency%2Cgoa_panchayat%2Cgoa_cadastral_survey_settlement%2Cgoa_mining_lease%2Cgoa_ecologically_sensitive_area%2Cgoa_forest_land%2Cgoa_road%2Cgoa_landmark%2Cgoa_railway%2Cgoa_water_body&l=goa_village%2Cgoa_taluka%2Cgoa_district%2Cgoa_collectorate%2Cgoa_constituency%2Cgoa_panchayat%2Cgoa_cadastral_survey_settlement%2Cgoa_mining_lease%2Cgoa_ecologically_sensitive_area%2Cgoa_forest_land%2Cgoa_road%2Cgoa_landmark%2Cgoa_railway%2Cgoa_water_body";

        return [
            {
                id: 'onemapgoa',
                name: 'One Map Goa GIS',
                url: `https://onemapgoagis.goa.gov.in/map/?ct=LayerTree${oneMapGoaLayerList}&bl=mmi_hybrid&t=goa_default&c=${mercatorCoords.x}%2C${mercatorCoords.y}&s=500`,
                icon: './assets/img/icon-onemapgoa.png',
                category: 'india',
                description: 'Official geoportal of the Government of Goa providing comprehensive spatial data including cadastral surveys, administrative boundaries, mining leases, forest lands, water bodies, and infrastructure. Features high-resolution satellite imagery and detailed vector layers for planning and governance.',
                tags: ['State Geoportal', 'Cadastral', 'Administration']
            },
            {
                id: 'bharatmaps',
                icon: 'https://bharatmaps.gov.in/BharatMapsMVC/Assets/img/logo/logo-white.png',
                name: 'NIC Bharatmaps',
                url: `https://bharatmaps.gov.in/BharatMaps/Home/Map?long=${lat}&lat=${lng}`,
                category: 'india',
                description: 'National Informatics Centre\'s pan-India mapping platform offering administrative boundaries, topographic maps, and infrastructure data. Provides access to Survey of India base maps and government geospatial datasets for public use.',
                tags: ['Basemap', 'Government']
            },
            {
                id: 'bhuvan',
                name: 'ISRO Bhuvan',
                url: `https://bhuvanmaps.nrsc.gov.in/?mode=Hybrid#${zoom}/${lat}/${lng}`,
                icon: './assets/img/icon-bhuvan.png',
                category: 'india',
                description: 'Indian Space Research Organisation\'s geoportal providing satellite imagery, thematic maps, and spatial analysis tools. Features multi-temporal satellite data from Indian Remote Sensing satellites with hybrid visualization combining optical and vector layers.',
                tags: ['Basemap', 'Government']
            },
            {
                id: 'bhuvan-datahub',
                name: 'Bhuvan Satellite Archive',
                url: `https://bhuvanmaps.nrsc.gov.in/science?dataHubTab=0&mode=Satellite#${zoom}/${lat}/${lng}`,
                icon: './assets/img/icon-bhuvan.png',
                category: 'india',
                description: 'Advanced data discovery and download portal for ISRO satellite products. Access to scientific datasets including multispectral imagery, derived products, and thematic layers for research and analysis. Supports bulk downloads and API access.',
                tags: ['Satellite', 'Archive', 'Government']
            },
            {
                id: 'osm',
                name: 'OpenStreetMap',
                url: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${zoom}/${lat}/${lng}&layers=D`,
                icon: 'https://upload.wikimedia.org/wikipedia/commons/b/b0/Openstreetmap_logo.svg',
                category: 'global',
                description: 'Community-driven global map database built by millions of contributors worldwide. Free and open data covering roads, buildings, amenities, natural features, and land use. Editable by anyone and used as the foundation for countless mapping applications.',
                tags: ['Basemap', 'Navigation', 'Open Data']
            },
            {
                id: 'urbanistmap',
                name: 'UrbanistMap',
                url: `https://urbanistmap.org/#map=${zoom}/${lat}/${lng}`,
                icon: 'https://urbanistmap.org/favicon.svg',
                category: 'global',
                description: 'Minimalist basemap focused on urban form, transit networks, and the built environment. Clean cartography highlighting streets, rail, and density patterns for urban planning and analysis.',
                tags: ['Basemap', 'Urban', 'Transit']
            },
            {
                id: 'osm-spyglass',
                icon: 'https://spyglass.jochentopf.com/img/spyglass.svg',
                name: 'OSM SpyGlass',
                url: `https://spyglass.jochentopf.com/#p=${zoom}/${lat}/${lng}`,
                category: 'global',
                description: 'Experimental OpenStreetMap viewer showcasing advanced rendering techniques and real-time data visualization. Useful for examining OSM data structure, testing map styles, and exploring vector tile performance.',
                tags: ['Open Data', 'Visualization']
            },
            {
                id: 'sentinel-search',
                name: 'Sentinel-2 Viewer',
                url: `https://sentinel.spatialty.io/#${zoom}/${lat}/${lng}`,
                icon: 'https://spatialty.io/favicon.ico',
                category: 'global',
                description: 'Cloud-optimized search and preview interface for Sentinel-2 satellite imagery from the European Space Agency. Browse and compare recent high-resolution optical imagery (10m resolution) with filtering by cloud coverage and acquisition date.',
                tags: ['Satellite', 'Archive']
            },
            {
                id: 'google-maps',
                name: 'Google Maps',
                url: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
                icon: 'https://upload.wikimedia.org/wikipedia/commons/a/aa/Google_Maps_icon_%282020%29.svg',
                category: 'global',
                description: 'The world\'s most popular navigation and mapping service with comprehensive global coverage. Features Street View photography, real-time traffic, transit information, business listings, and route planning for driving, walking, cycling, and public transport.',
                tags: ['Basemap', 'Navigation', 'Satellite', 'Street View']
            },
            {
                id: 'apple-maps',
                name: 'Apple Maps',
                url: `https://maps.apple.com/?ll=${lat},${lng}&z=${zoom}`,
                icon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Apple_Maps_logo.svg/120px-Apple_Maps_logo.svg.png',
                category: 'global',
                description: 'Apple\'s mapping service with satellite imagery, Look Around street-level views, and turn-by-turn navigation. Features detailed 3D city maps, indoor maps for major venues, and business listings.',
                tags: ['Basemap', 'Navigation', 'Satellite', 'Street View']
            },
            {
                id: 'here-maps',
                name: 'HERE Maps',
                url: `https://maps.here.com/?map=${lat}%2C${lng}%2C${zoom}`,
                icon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/Here_WeGo_logo.svg/120px-Here_WeGo_logo.svg.png',
                category: 'global',
                description: 'HERE\'s mapping and navigation service with global coverage of roads, traffic, and points of interest. Features satellite imagery, public transit routing, and detailed venue maps.',
                tags: ['Basemap', 'Navigation', 'Satellite']
            },
            {
                id: 'google-earth',
                icon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Google_Earth_Icon.png/120px-Google_Earth_Icon.png',
                name: 'Google Earth',
                url: `https://earth.google.com/web/@${lat},${lng},67.01062587a,1688.30584472d,35y,-0h,0t,0r/data=CgwqBggBEgAYAUICCAFCAggASg0I____________ARAA`,
                text: 'GE',
                category: 'global',
                description: '3D globe viewer with high-resolution satellite imagery, aerial photography, and terrain data. Access historical imagery dating back decades, explore 3D buildings in major cities, and visualize geographic features with elevation profiles.',
                tags: ['Satellite', 'Archive', '3D']
            },
            {
                id: 'esri-landcover',
                name: 'ESRI Sentinel-2 Land Cover Explorer',
                url: `https://livingatlas.arcgis.com/landcoverexplorer/#mapCenter=${lng}%2C${lat}%2C${zoom}.79&mode=step&timeExtent=2017%2C2023&year=2023`,
                icon: 'https://upload.wikimedia.org/wikipedia/en/thumb/6/6e/Esri_logo.svg/120px-Esri_logo.svg.png',
                category: 'global',
                description: 'ESRI Living Atlas land cover classification viewer showing global land use patterns at 10m resolution. Explore change over time with annual updates from 2017-2023, comparing urban growth, deforestation, and agricultural expansion across regions.',
                tags: ['Thematic', 'LULC', 'Archive']
            },
            {
                id: 'google-timelapse',
                icon: 'https://earthengine.google.com/static/images/earth_engine_logo.png',
                name: 'Google Timelapse (1984-2022)',
                url: `https://earthengine.google.com/timelapse#v=${lat},${lng},15,latLng&t=0.41&ps=50&bt=19840101&et=20221231`,
                text: 'TL',
                category: 'global',
                description: 'Google Earth Engine Timelapse showing 40+ years of planetary change from 1984 to present. Animated satellite imagery reveals urban expansion, deforestation, coastal erosion, glacier retreat, and agricultural development over four decades of Landsat observations. Low Resolution',
                tags: ['Satellite', 'Archive']
            },
            {
                id: 'fire-info',
                icon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/NASA_logo.svg/250px-NASA_logo.svg.png?_=20181013191516',
                name: 'NASA FIRMS Fire Monitoring',
                url: `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${lng},${lat},14.00z`,
                text: 'FR',
                category: 'global',
                description: 'NASA FIRMS (Fire Information for Resource Management System) providing near real-time active fire detection from MODIS and VIIRS satellites. Track wildfires, agricultural burning, and thermal anomalies with 3-6 hour update frequency and historical archive.',
                tags: ['Live', 'Fire', 'Monitoring']
            },
            {
                id: 'copernicus',
                name: 'Copernicus',
                icon: '<div style="background: rgba(235, 235, 235, 1);"><img src="https://upload.wikimedia.org/wikipedia/commons/thumb/a/af/ESA_logo.png/100px-ESA_logo.png" style="max-width: 100%; max-height: 100%; object-fit: contain;"></div>',
                url: `https://browser.dataspace.copernicus.eu/?zoom=${zoom}&lat=${lat}&lng=${lng}&themeId=DEFAULT-THEME&visualizationUrl=U2FsdGVkX18d3QCo8ly51mKnde%2FbnPTNY3M%2Bvkw2HJS5PZYTtLYG6ZjWVDYuz%2Bszj9bzKcR5Th1mcWjsfJneWz3DM1gd75vRaH%2BioFw2j3mQa79Yj8F7TkWwvb2ow0kh&datasetId=3c662330-108b-4378-8899-525fd5a225cb&fromTime=2024-12-01T00%3A00%3A00.000Z&toTime=2024-12-01T23%3A59%3A59.999Z&layerId=0-RGB-RATIO&demSource3D=%22MAPZEN%22&cloudCoverage=30&dateMode=SINGLE`,
                category: 'global',
                description: 'European Space Agency\'s data browser for Sentinel satellites offering free access to petabytes of Earth observation data. Features Sentinel-1 radar, Sentinel-2 optical imagery, and Sentinel-3 land/ocean products with custom band combinations and time series analysis.',
                tags: ['Satellite', 'Archive']
            },
            {
                id: 'landsat',
                name: 'ESRI Landsat Explorer',
                url: `https://livingatlas.arcgis.com/landsatexplorer/#mapCenter=${lng}%2C${lat}%2C${zoom}&mode=dynamic&mainScene=%7CColor+Infrared+for+Visualization%7C`,
                icon: 'https://upload.wikimedia.org/wikipedia/en/thumb/6/6e/Esri_logo.svg/120px-Esri_logo.svg.png',
                category: 'global',
                description: 'USGS/NASA Landsat program explorer with 50+ years of continuous Earth observation imagery at 30m resolution. Access multispectral data from Landsat 1-9, create custom band combinations, analyze vegetation health, and track land cover changes since 1972.',
                tags: ['Satellite', 'Archive']
            },
            {
                id: 'wayback',
                name: 'ESRI Wayback',
                url: `https://livingatlas.arcgis.com/wayback/#mapCenter=${lng}%2C${lat}%2C${zoom}&mode=explore&active=15084`,
                icon: 'https://upload.wikimedia.org/wikipedia/en/thumb/6/6e/Esri_logo.svg/120px-Esri_logo.svg.png',
                category: 'global',
                description: 'ESRI Living Atlas archive of historical World Imagery basemap releases, letting you compare satellite imagery captures over time at the same location. Browse and swipe between hundreds of dated imagery versions to spot changes.',
                tags: ['Satellite', 'Archive', 'Time series']
            },
            {
                id: 'shademap',
                icon: 'https://shademap.app/favicon-32x32.png',
                name: 'ShadeMap',
                url: `https://shademap.app/@${lat},${lng},${zoom}z,${Date.now()}t,0b,0p,0m`,
                category: 'global',
                description: 'Sun and shadow simulator that visualizes how shadows from terrain and buildings move across the landscape throughout the day and year. Useful for solar exposure analysis, planning, and understanding sunlight patterns at any location and time.',
                tags: ['Sun', 'Shadow', 'Analysis']
            },
            {
                id: 'zoom-earth',
                icon: 'https://zoom.earth/assets/images/icon-100.7.jpg',
                name: 'ZoomEarth Weather Monitor',
                url: `https://zoom.earth/maps/temperature/#view=${lat},${lng},11z/place=${lat},${lng}/model=icon/overlays=wind`,
                category: 'global',
                description: 'Real-time weather visualization platform showing temperature, precipitation, wind patterns, storms, and atmospheric conditions. Animated satellite imagery and weather models updated hourly, with historical storm tracking and forecast animations.',
                tags: ['Live', 'Weather']
            },
            {
                id: 'nasa-worldview',
                icon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/NASA_logo.svg/250px-NASA_logo.svg.png?_=20181013191516',
                name: 'NASA Worldview',
                url: (() => {
                    const bbox = this._calculateBbox(lng, lat, zoom);
                    return `https://worldview.earthdata.nasa.gov/?v=${bbox.west},${bbox.south},${bbox.east},${bbox.north}&l=Reference_Labels_15m(hidden),Reference_Features_15m(hidden),Coastlines_15m(hidden),VIIRS_SNPP_DayNightBand_At_Sensor_Radiance,VIIRS_Black_Marble,VIIRS_SNPP_CorrectedReflectance_TrueColor(hidden),MODIS_Aqua_CorrectedReflectance_TrueColor(hidden),MODIS_Terra_CorrectedReflectance_TrueColor(hidden)&lg=false&t=2021-01-10-T19%3A18%3A03Z`;
                })(),
                category: 'global',
                description: 'NASA\'s near real-time satellite imagery viewer featuring MODIS, VIIRS, and other sensors with same-day coverage. Visualize natural events like wildfires, storms, dust plumes, and volcanic eruptions with corrected reflectance imagery and nighttime lights.',
                tags: ['Satellite', 'Archvive', 'Live']
            },
            {
                id: 'forest-watch',
                icon: 'data:image/png;base64,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',
                name: 'Forest Watch',
                url: `https://www.globalforestwatch.org/map/?map=${encodeURIComponent(JSON.stringify({
                    center: {
                        lat: lat,
                        lng: lng
                    },
                    zoom: zoom,
                    basemap: {
                        value: "satellite",
                        color: "",
                        name: "planet_medres_visual_2025-02_mosaic",
                        imageType: "analytic"
                    },
                    datasets: [
                        {
                            dataset: "political-boundaries",
                            layers: ["disputed-political-boundaries", "political-boundaries"],
                            boundary: true,
                            opacity: 1,
                            visibility: true
                        },
                        {
                            dataset: "DIST_alerts",
                            opacity: 1,
                            visibility: true,
                            layers: ["DIST_alerts_all"]
                        },
                        {
                            dataset: "tree-cover-loss",
                            layers: ["tree-cover-loss"],
                            opacity: 1,
                            visibility: true,
                            timelineParams: {
                                startDate: "2002-01-01",
                                endDate: "2023-12-31",
                                trimEndDate: "2023-12-31"
                            },
                            params: {
                                threshold: 30,
                                visibility: true,
                                adm_level: "adm0"
                            }
                        },
                        {
                            opacity: 0.7,
                            visibility: true,
                            dataset: "primary-forests",
                            layers: ["primary-forests-2001"]
                        },
                        {
                            dataset: "umd-tree-height",
                            opacity: 0.58,
                            visibility: true,
                            layers: ["umd-tree-height-2020"]
                        }
                    ]
                }))}&mapMenu=${encodeURIComponent(JSON.stringify({
                    datasetCategory: "landCover"
                }))}`,
                category: 'global',
                description: 'World Resources Institute\'s platform for monitoring global forests using satellite data. Track deforestation, fire alerts, tree cover loss, and biodiversity with weekly updated GLAD alerts. Features tree height maps, primary forest extent, and carbon density estimates.',
                tags: ['Live', 'Archive', 'Deforestation']
            }
        ];
    }

    _latLngToMercator(lat, lng) {
        const x = lng * 20037508.34 / 180;
        let y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180);
        y = y * 20037508.34 / 180;
        return { x, y };
    }

    _calculateBbox(centerLng, centerLat, zoom) {
        const earthRadius = 6378137;
        const tileSize = 256;
        const resolution = 2 * Math.PI * earthRadius / (tileSize * Math.pow(2, zoom));
        const halfWidth = resolution * tileSize / 2;
        const halfHeight = resolution * tileSize / 2;

        return {
            west: centerLng - halfWidth / (earthRadius * Math.cos(centerLat * Math.PI / 180)) * 180 / Math.PI,
            south: centerLat - halfHeight / earthRadius * 180 / Math.PI,
            east: centerLng + halfWidth / (earthRadius * Math.cos(centerLat * Math.PI / 180)) * 180 / Math.PI,
            north: centerLat + halfHeight / earthRadius * 180 / Math.PI
        };
    }

} 