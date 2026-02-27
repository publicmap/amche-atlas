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
        this._expandedCards = new Set();

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
        this._button.innerHTML = `<sl-icon name="geo" style="font-size: 20px;"></sl-icon>`;

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
    }

    _createModal() {
        const modalHTML = `
            <sl-dialog id="${this.modalId}" label="Map Navigation Links" class="map-links-modal">
                <div class="map-links-container">
                </div>
                <sl-button slot="footer" variant="neutral" id="${this.modalId}-close" class="map-links-btn">Close</sl-button>
            </sl-dialog>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        this._modal = document.getElementById(this.modalId);
        this._closeButton = document.getElementById(`${this.modalId}-close`);

        if (this._closeButton) {
            this._closeButton.addEventListener('click', this._handleCloseClick);
        }
    }

    _handleButtonClick() {
        this._showModal();
    }

    _handleCloseClick() {
        if (this._modal) {
            this._modal.hide();
        }
    }

    _showModal() {
        if (!this._modal || !this._map) return;

        const container = this._modal.querySelector('.map-links-container');

        const center = this._map.getCenter();
        const zoom = Math.round(this._map.getZoom());
        const lat = center.lat;
        const lng = center.lng;

        const links = this._generateNavigationLinks(lat, lng, zoom);

        const goaLinks = links.filter(link => link.category === 'goa');
        const globalLinks = links.filter(link => link.category === 'global');

        container.innerHTML = `
            <div class="map-links-section">
                <h3 class="map-links-section-title">Goa</h3>
                <div class="map-links-grid">
                    ${goaLinks.map(link => this._createLinkCard(link)).join('')}
                </div>
            </div>
            <div class="map-links-section">
                <h3 class="map-links-section-title">Global</h3>
                <div class="map-links-grid">
                    ${globalLinks.map(link => this._createLinkCard(link)).join('')}
                </div>
            </div>
        `;

        container.addEventListener('click', (e) => {
            const expandTarget = e.target.closest('[data-action="expand"]');
            const collapseTarget = e.target.closest('[data-action="collapse"]');

            if (expandTarget) {
                const linkId = expandTarget.dataset.linkId;
                if (linkId) {
                    this._expandedCards.clear();
                    this._expandedCards.add(linkId);
                    this._showModal();
                }
            } else if (collapseTarget) {
                const card = e.target.closest('[data-link-id]');
                if (card) {
                    const linkId = card.dataset.linkId;
                    this._expandedCards.delete(linkId);
                    this._showModal();
                }
            }
        });

        this._modal.show();
    }

    _createLinkCard(link) {
        const isExpanded = this._expandedCards.has(link.id);
        const iconHTML = link.icon
            ? `<img src="${link.icon}" alt="${link.name}" class="map-link-icon" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">`
            : '';

        const textIconHTML = `<div class="map-link-text-icon" ${link.icon ? 'style="display:none;"' : ''}>${link.text || link.name.substring(0, 2).toUpperCase()}</div>`;

        const tagsHTML = link.tags && link.tags.length > 0
            ? `<div class="map-link-tags">${link.tags.map(tag => `<span class="map-link-tag">${tag}</span>`).join('')}</div>`
            : '';

        if (isExpanded) {
            return `
                <div class="map-link-card-expanded" data-link-id="${link.id}">
                    <div class="map-link-card-expanded-header" data-action="collapse">
                        ${iconHTML}
                        ${textIconHTML}
                        <div class="map-link-expanded-title">
                            <div class="map-link-name">${link.name}</div>
                            ${tagsHTML}
                        </div>
                        <button class="map-link-collapse-btn" data-action="collapse" title="Collapse">▼</button>
                    </div>
                    <div class="map-link-expanded-content">
                        <p class="map-link-description">${link.description || ''}</p>
                        <a href="${link.url}" target="_blank" rel="noopener noreferrer" class="map-link-visit-btn">
                            Visit ${link.name}
                        </a>
                    </div>
                </div>
            `;
        } else {
            return `
                <div class="map-link-card" data-link-id="${link.id}" data-action="expand">
                    ${iconHTML}
                    ${textIconHTML}
                    <div class="map-link-content">
                        <div class="map-link-name">${link.name}</div>
                        ${tagsHTML}
                    </div>
                </div>
            `;
        }
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
                category: 'goa',
                description: 'Official geoportal of the Government of Goa providing comprehensive spatial data including cadastral surveys, administrative boundaries, mining leases, forest lands, water bodies, and infrastructure. Features high-resolution satellite imagery and detailed vector layers for planning and governance.',
                tags: ['State Geoportal', 'Cadastral', 'Administration']
            },
            {
                id: 'bharatmaps',
                name: 'NIC Bharatmaps',
                url: `https://bharatmaps.gov.in/BharatMaps/Home/Map?long=${lat}&lat=${lng}`,
                text: 'BM',
                category: 'goa',
                description: 'National Informatics Centre\'s pan-India mapping platform offering administrative boundaries, topographic maps, and infrastructure data. Provides access to Survey of India base maps and government geospatial datasets for public use.',
                tags: ['Basemap', 'Administration', 'Topographic']
            },
            {
                id: 'bhuvan',
                name: 'ISRO Bhuvan',
                url: `https://bhuvanmaps.nrsc.gov.in/?mode=Hybrid#${zoom}/${lat}/${lng}`,
                icon: './assets/img/icon-bhuvan.png',
                category: 'goa',
                description: 'Indian Space Research Organisation\'s geoportal providing satellite imagery, thematic maps, and spatial analysis tools. Features multi-temporal satellite data from Indian Remote Sensing satellites with hybrid visualization combining optical and vector layers.',
                tags: ['Satellite Archive', 'Basemap', 'Thematic Maps']
            },
            {
                id: 'bhuvan-datahub',
                name: 'Bhuvan Data Hub',
                url: `https://bhuvanmaps.nrsc.gov.in/science?dataHubTab=0&mode=Satellite#${zoom}/${lat}/${lng}`,
                icon: './assets/img/icon-bhuvan.png',
                category: 'goa',
                description: 'Advanced data discovery and download portal for ISRO satellite products. Access to scientific datasets including multispectral imagery, derived products, and thematic layers for research and analysis. Supports bulk downloads and API access.',
                tags: ['Satellite Archive', 'Data Download', 'Research']
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
                id: 'osm-spyglass',
                name: 'OSM SpyGlass',
                url: `https://spyglass.jochentopf.com/#p=${zoom}/${lat}/${lng}`,
                icon: 'https://spyglass.jochentopf.com/mg/spyglass.svg',
                category: 'global',
                description: 'Experimental OpenStreetMap viewer showcasing advanced rendering techniques and real-time data visualization. Useful for examining OSM data structure, testing map styles, and exploring vector tile performance.',
                tags: ['Open Data', 'Visualization']
            },
            {
                id: 'sentinel-search',
                name: 'Sentinel-2 Search',
                url: `https://sentinel.spatialty.io/#${zoom}/${lat}/${lng}`,
                category: 'global',
                description: 'Cloud-optimized search and preview interface for Sentinel-2 satellite imagery from the European Space Agency. Browse and compare recent high-resolution optical imagery (10m resolution) with filtering by cloud coverage and acquisition date.',
                tags: ['Satellite Archive', 'Data Download']
            },
            {
                id: 'google-maps',
                name: 'Google Maps',
                url: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
                icon: 'https://upload.wikimedia.org/wikipedia/commons/a/aa/Google_Maps_icon_%282020%29.svg',
                category: 'global',
                description: 'The world\'s most popular navigation and mapping service with comprehensive global coverage. Features Street View photography, real-time traffic, transit information, business listings, and route planning for driving, walking, cycling, and public transport.',
                tags: ['Navigation', 'Basemap', 'Street View']
            },
            {
                id: 'google-earth',
                name: 'Google Earth',
                url: `https://earth.google.com/web/@${lat},${lng},67.01062587a,1688.30584472d,35y,-0h,0t,0r/data=CgwqBggBEgAYAUICCAFCAggASg0I____________ARAA`,
                text: 'GE',
                category: 'global',
                description: '3D globe viewer with high-resolution satellite imagery, aerial photography, and terrain data. Access historical imagery dating back decades, explore 3D buildings in major cities, and visualize geographic features with elevation profiles.',
                tags: ['Satellite Archive', '3D Visualization', 'Historical Imagery']
            },
            {
                id: 'landcover',
                name: 'Landcover',
                url: `https://livingatlas.arcgis.com/landcoverexplorer/#mapCenter=${lng}%2C${lat}%2C${zoom}.79&mode=step&timeExtent=2017%2C2023&year=2023`,
                text: 'LC',
                category: 'global',
                description: 'ESRI Living Atlas land cover classification viewer showing global land use patterns at 10m resolution. Explore change over time with annual updates from 2017-2023, comparing urban growth, deforestation, and agricultural expansion across regions.',
                tags: ['Thematic Maps', 'Land Use', 'Time Series']
            },
            {
                id: 'timelapse',
                name: 'Timelapse',
                url: `https://earthengine.google.com/timelapse#v=${lat},${lng},15,latLng&t=0.41&ps=50&bt=19840101&et=20221231`,
                text: 'TL',
                category: 'global',
                description: 'Google Earth Engine Timelapse showing 40+ years of planetary change from 1984 to present. Animated satellite imagery reveals urban expansion, deforestation, coastal erosion, glacier retreat, and agricultural development over four decades of Landsat observations.',
                tags: ['Satellite Archive', 'Historical Imagery', 'Time Series']
            },
            {
                id: 'fire-info',
                name: 'Fire Info',
                url: `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${lng},${lat},14.00z`,
                text: 'FR',
                category: 'global',
                description: 'NASA FIRMS (Fire Information for Resource Management System) providing near real-time active fire detection from MODIS and VIIRS satellites. Track wildfires, agricultural burning, and thermal anomalies with 3-6 hour update frequency and historical archive.',
                tags: ['Monitoring', 'Environmental', 'Real-time']
            },
            {
                id: 'copernicus',
                name: 'Copernicus',
                url: `https://browser.dataspace.copernicus.eu/?zoom=${zoom}&lat=${lat}&lng=${lng}&themeId=DEFAULT-THEME&visualizationUrl=U2FsdGVkX18d3QCo8ly51mKnde%2FbnPTNY3M%2Bvkw2HJS5PZYTtLYG6ZjWVDYuz%2Bszj9bzKcR5Th1mcWjsfJneWz3DM1gd75vRaH%2BioFw2j3mQa79Yj8F7TkWwvb2ow0kh&datasetId=3c662330-108b-4378-8899-525fd5a225cb&fromTime=2024-12-01T00%3A00%3A00.000Z&toTime=2024-12-01T23%3A59%3A59.999Z&layerId=0-RGB-RATIO&demSource3D=%22MAPZEN%22&cloudCoverage=30&dateMode=SINGLE`,
                text: 'CO',
                category: 'global',
                description: 'European Space Agency\'s data browser for Sentinel satellites offering free access to petabytes of Earth observation data. Features Sentinel-1 radar, Sentinel-2 optical imagery, and Sentinel-3 land/ocean products with custom band combinations and time series analysis.',
                tags: ['Satellite Archive', 'Data Download', 'Research']
            },
            {
                id: 'landsat',
                name: 'Landsat',
                url: `https://livingatlas.arcgis.com/landsatexplorer/#mapCenter=${lng}%2C${lat}%2C${zoom}&mode=dynamic&mainScene=%7CColor+Infrared+for+Visualization%7C`,
                text: 'LS',
                category: 'global',
                description: 'USGS/NASA Landsat program explorer with 50+ years of continuous Earth observation imagery at 30m resolution. Access multispectral data from Landsat 1-9, create custom band combinations, analyze vegetation health, and track land cover changes since 1972.',
                tags: ['Satellite Archive', 'Historical Imagery', 'Time Series']
            },
            {
                id: 'weather',
                name: 'Weather',
                url: `https://zoom.earth/maps/temperature/#view=${lat},${lng},11z`,
                text: 'ZE',
                category: 'global',
                description: 'Real-time weather visualization platform showing temperature, precipitation, wind patterns, storms, and atmospheric conditions. Animated satellite imagery and weather models updated hourly, with historical storm tracking and forecast animations.',
                tags: ['Monitoring', 'Real-time', 'Environmental']
            },
            {
                id: 'worldview',
                name: 'Worldview',
                url: (() => {
                    const bbox = this._calculateBbox(lng, lat, zoom);
                    return `https://worldview.earthdata.nasa.gov/?v=${bbox.west},${bbox.south},${bbox.east},${bbox.north}&l=Reference_Labels_15m(hidden),Reference_Features_15m(hidden),Coastlines_15m(hidden),VIIRS_SNPP_DayNightBand_At_Sensor_Radiance,VIIRS_Black_Marble,VIIRS_SNPP_CorrectedReflectance_TrueColor(hidden),MODIS_Aqua_CorrectedReflectance_TrueColor(hidden),MODIS_Terra_CorrectedReflectance_TrueColor(hidden)&lg=false&t=2021-01-10-T19%3A18%3A03Z`;
                })(),
                text: 'WV',
                category: 'global',
                description: 'NASA\'s near real-time satellite imagery viewer featuring MODIS, VIIRS, and other sensors with same-day coverage. Visualize natural events like wildfires, storms, dust plumes, and volcanic eruptions with corrected reflectance imagery and nighttime lights.',
                tags: ['Satellite Archive', 'Real-time', 'Monitoring']
            },
            {
                id: 'forest-watch',
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
                text: 'FW',
                category: 'global',
                description: 'World Resources Institute\'s platform for monitoring global forests using satellite data. Track deforestation, fire alerts, tree cover loss, and biodiversity with weekly updated GLAD alerts. Features tree height maps, primary forest extent, and carbon density estimates.',
                tags: ['Monitoring', 'Environmental', 'Time Series']
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