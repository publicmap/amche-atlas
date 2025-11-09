/**
 * MapLinks Plugin
 * A reusable plugin for displaying map navigation links in a full-screen modal
 */
export class MapLinks {
    constructor(options) {
        this.buttonId = options.buttonId;
        this.map = options.map;
        this.modalId = `${this.buttonId}-modal`;

        this._init();
    }

    _init() {
        this._createModal();
        this._attachEventListeners();
    }

    _createModal() {
        // Create modal HTML
        const modalHTML = `
            <sl-dialog id="${this.modalId}" label="Map Navigation Links" class="map-links-modal">
                <div class="map-links-grid">
                    <!-- Links will be populated here -->
                </div>
                <sl-button slot="footer" variant="neutral" id="${this.modalId}-close" class="map-links-btn">Close</sl-button>
            </sl-dialog>
        `;

        // Append to body
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    _attachEventListeners() {
        const button = document.getElementById(this.buttonId);
        const modal = document.getElementById(this.modalId);
        const closeButton = document.getElementById(`${this.modalId}-close`);

        if (button) {
            button.addEventListener('click', () => {
                this._showModal();
            });
        }

        if (closeButton) {
            closeButton.addEventListener('click', () => {
                modal.hide();
            });
        }
    }

    _showModal() {
        const modal = document.getElementById(this.modalId);
        const grid = modal.querySelector('.map-links-grid');

        // Get current map context
        const center = this.map.getCenter();
        const zoom = Math.round(this.map.getZoom());
        const lat = center.lat;
        const lng = center.lng;

        // Generate links
        const links = this._generateNavigationLinks(lat, lng, zoom);

        // Populate grid
        grid.innerHTML = links.map(link => this._createLinkCard(link)).join('');

        // Show modal
        modal.show();
    }

    _createLinkCard(link) {
        const iconHTML = link.icon
            ? `<img src="${link.icon}" alt="${link.name}" class="map-link-icon" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">`
            : '';

        const textIconHTML = `<div class="map-link-text-icon" ${link.icon ? 'style="display:none;"' : ''}>${link.text || link.name.substring(0, 2).toUpperCase()}</div>`;

        return `
            <a href="${link.url}" target="_blank" rel="noopener noreferrer" class="map-link-card">
                ${iconHTML}
                ${textIconHTML}
                <div class="map-link-name">${link.name}</div>
            </a>
        `;
    }

    _generateNavigationLinks(lat, lng, zoom) {
        // Calculate mercator coordinates for One Map Goa
        const mercatorCoords = this._latLngToMercator(lat, lng);
        const oneMapGoaLayerList = "&cl=goa_village%2Cgoa_taluka%2Cgoa_district%2Cgoa_collectorate%2Cgoa_constituency%2Cgoa_panchayat%2Cgoa_cadastral_survey_settlement%2Cgoa_mining_lease%2Cgoa_ecologically_sensitive_area%2Cgoa_forest_land%2Cgoa_road%2Cgoa_landmark%2Cgoa_railway%2Cgoa_water_body&l=goa_village%2Cgoa_taluka%2Cgoa_district%2Cgoa_collectorate%2Cgoa_constituency%2Cgoa_panchayat%2Cgoa_cadastral_survey_settlement%2Cgoa_mining_lease%2Cgoa_ecologically_sensitive_area%2Cgoa_forest_land%2Cgoa_road%2Cgoa_landmark%2Cgoa_railway%2Cgoa_water_body";

        return [
            {
                name: 'OpenStreetMap',
                url: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${zoom}/${lat}/${lng}&layers=D`,
                icon: 'https://upload.wikimedia.org/wikipedia/commons/b/b0/Openstreetmap_logo.svg'
            },
            {
                name: 'Google Maps',
                url: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
                icon: 'https://upload.wikimedia.org/wikipedia/commons/a/aa/Google_Maps_icon_%282020%29.svg'
            },
            {
                name: 'Google Earth Studio',
                url: `https://earth.google.com/web/@${lat},${lng},67.01062587a,1688.30584472d,35y,-0h,0t,0r/data=CgwqBggBEgAYAUICCAFCAggASg0I____________ARAA`,
                text: 'GE'
            },
            {
                name: 'ISRO Bhuvan',
                url: `https://bhuvanmaps.nrsc.gov.in/?mode=Hybrid#${zoom}/${lat}/${lng}`,
                icon: './assets/img/icon-bhuvan.png'
            },
            {
                name: 'Bhuvan Data Hub',
                url: `https://bhuvanmaps.nrsc.gov.in/science?dataHubTab=0&mode=Satellite#${zoom}/${lat}/${lng}`,
                icon: './assets/img/icon-bhuvan.png'
            },
            {
                name: 'NIC Bharatmaps',
                url: `https://bharatmaps.gov.in/BharatMaps/Home/Map?long=${lat}&lat=${lng}`,
                text: 'BM'
            },
            {
                name: 'One Map Goa GIS',
                url: `https://onemapgoagis.goa.gov.in/map/?ct=LayerTree${oneMapGoaLayerList}&bl=mmi_hybrid&t=goa_default&c=${mercatorCoords.x}%2C${mercatorCoords.y}&s=500`,
                icon: './assets/img/icon-onemapgoa.png'
            },
            {
                name: 'ESRI Living Atlas Landcover',
                url: `https://livingatlas.arcgis.com/landcoverexplorer/#mapCenter=${lng}%2C${lat}%2C${zoom}.79&mode=step&timeExtent=2017%2C2023&year=2023`,
                text: 'LC'
            },
            {
                name: 'Google Earth Engine Timelapse',
                url: `https://earthengine.google.com/timelapse#v=${lat},${lng},15,latLng&t=0.41&ps=50&bt=19840101&et=20221231`,
                text: 'TL'
            },
            {
                name: 'FIRMS Fire Information',
                url: `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${lng},${lat},14.00z`,
                text: 'FR'
            },
            {
                name: 'ESA Copernicus Browser',
                url: `https://browser.dataspace.copernicus.eu/?zoom=${zoom}&lat=${lat}&lng=${lng}&themeId=DEFAULT-THEME&visualizationUrl=U2FsdGVkX18d3QCo8ly51mKnde%2FbnPTNY3M%2Bvkw2HJS5PZYTtLYG6ZjWVDYuz%2Bszj9bzKcR5Th1mcWjsfJneWz3DM1gd75vRaH%2BioFw2j3mQa79Yj8F7TkWwvb2ow0kh&datasetId=3c662330-108b-4378-8899-525fd5a225cb&fromTime=2024-12-01T00%3A00%3A00.000Z&toTime=2024-12-01T23%3A59%3A59.999Z&layerId=0-RGB-RATIO&demSource3D=%22MAPZEN%22&cloudCoverage=30&dateMode=SINGLE`,
                text: 'CO'
            },
            {
                name: 'ESRI Landsat Explorer',
                url: `https://livingatlas.arcgis.com/landsatexplorer/#mapCenter=${lng}%2C${lat}%2C${zoom}&mode=dynamic&mainScene=%7CColor+Infrared+for+Visualization%7C`,
                text: 'LS'
            },
            {
                name: 'Zoom Earth Live Weather',
                url: `https://zoom.earth/maps/temperature/#view=${lat},${lng},11z`,
                text: 'ZE'
            },
            {
                name: 'NASA Worldview Explorer',
                url: (() => {
                    const bbox = this._calculateBbox(lng, lat, zoom);
                    return `https://worldview.earthdata.nasa.gov/?v=${bbox.west},${bbox.south},${bbox.east},${bbox.north}&l=Reference_Labels_15m(hidden),Reference_Features_15m(hidden),Coastlines_15m(hidden),VIIRS_SNPP_DayNightBand_At_Sensor_Radiance,VIIRS_Black_Marble,VIIRS_SNPP_CorrectedReflectance_TrueColor(hidden),MODIS_Aqua_CorrectedReflectance_TrueColor(hidden),MODIS_Terra_CorrectedReflectance_TrueColor(hidden)&lg=false&t=2021-01-10-T19%3A18%3A03Z`;
                })(),
                text: 'WV'
            },
            {
                name: 'Global Forest Watch',
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
                text: 'FW'
            }
        ];
    }

    _latLngToMercator(lat, lng) {
        const x = lng * 20037508.34 / 180;
        let y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180);
        y = y * 20037508.34 / 180;
        return {x, y};
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

    destroy() {
        const modal = document.getElementById(this.modalId);
        if (modal) {
            modal.remove();
        }
    }
} 