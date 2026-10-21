/**
 * The other map services a view can be opened in, each link built for a
 * point and zoom: {id, name, url, icon, lightIcon (a white logo, shown on a
 * dark tile), category: 'india' | 'global', description, tags, groups}.
 * `groups` are the LINK_GROUPS a service is listed under - often more than
 * one. Listed in the Share panel's "Open With" section
 * (js/share-external-links.js) and used by the shortcut menu's "Open With"
 * items (js/shortcut-menu-base.js).
 */
export const LINK_GROUPS = [
    ['basemap', 'Basemaps'],
    ['satellite', 'Satellite Archive'],
    ['street', 'Street View Photos'],
    ['weather', 'Weather'],
    ['other', 'Others']
];

export function externalMapLinks(lat, lng, zoom) {
    // Calculate mercator coordinates for One Map Goa
    const mercatorCoords = latLngToMercator(lat, lng);
    const oneMapGoaLayerList = "&cl=goa_village%2Cgoa_taluka%2Cgoa_district%2Cgoa_collectorate%2Cgoa_constituency%2Cgoa_panchayat%2Cgoa_cadastral_survey_settlement%2Cgoa_mining_lease%2Cgoa_ecologically_sensitive_area%2Cgoa_forest_land%2Cgoa_road%2Cgoa_landmark%2Cgoa_railway%2Cgoa_water_body&l=goa_village%2Cgoa_taluka%2Cgoa_district%2Cgoa_collectorate%2Cgoa_constituency%2Cgoa_panchayat%2Cgoa_cadastral_survey_settlement%2Cgoa_mining_lease%2Cgoa_ecologically_sensitive_area%2Cgoa_forest_land%2Cgoa_road%2Cgoa_landmark%2Cgoa_railway%2Cgoa_water_body";

    return [
        {
            id: 'onemapgoa',
            name: 'One Map Goa GIS',
            url: `https://onemapgoagis.goa.gov.in/map/?ct=LayerTree${oneMapGoaLayerList}&bl=mmi_hybrid&t=goa_default&c=${mercatorCoords.x}%2C${mercatorCoords.y}&s=500`,
            icon: './assets/img/icon-onemapgoa.png',
            category: 'india',
            description: 'Official geoportal of the Government of Goa providing comprehensive spatial data including cadastral surveys, administrative boundaries, mining leases, forest lands, water bodies, and infrastructure. Features high-resolution satellite imagery and detailed vector layers for planning and governance.',
            tags: ['State Geoportal', 'Cadastral', 'Administration'],
            groups: ['basemap', 'other']
        },
        {
            id: 'bharatmaps',
            icon: 'https://bharatmaps.gov.in/BharatMapsMVC/Assets/img/logo/logo-white.png',
            lightIcon: true,
            name: 'NIC Bharatmaps',
            url: `https://bharatmaps.gov.in/BharatMaps/Home/Map?long=${lat}&lat=${lng}`,
            category: 'india',
            description: 'National Informatics Centre\'s pan-India mapping platform offering administrative boundaries, topographic maps, and infrastructure data. Provides access to Survey of India base maps and government geospatial datasets for public use.',
            tags: ['Basemap', 'Government'],
            groups: ['basemap']
        },
        {
            id: 'bhuvan',
            name: 'ISRO Bhuvan',
            url: `https://bhuvanmaps.nrsc.gov.in/?mode=Hybrid#${zoom}/${lat}/${lng}`,
            icon: './assets/img/icon-bhuvan.png',
            category: 'india',
            description: 'Indian Space Research Organisation\'s geoportal providing satellite imagery, thematic maps, and spatial analysis tools. Features multi-temporal satellite data from Indian Remote Sensing satellites with hybrid visualization combining optical and vector layers.',
            tags: ['Basemap', 'Government'],
            groups: ['basemap', 'satellite']
        },
        {
            id: 'bhuvan-datahub',
            name: 'Bhuvan Satellite Archive',
            url: `https://bhuvanmaps.nrsc.gov.in/science?dataHubTab=0&mode=Satellite#${zoom}/${lat}/${lng}`,
            icon: './assets/img/icon-bhuvan.png',
            category: 'india',
            description: 'Advanced data discovery and download portal for ISRO satellite products. Access to scientific datasets including multispectral imagery, derived products, and thematic layers for research and analysis. Supports bulk downloads and API access.',
            tags: ['Satellite', 'Archive', 'Government'],
            groups: ['satellite']
        },
        {
            id: 'osm',
            name: 'OpenStreetMap',
            url: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${zoom}/${lat}/${lng}&layers=D`,
            icon: 'https://upload.wikimedia.org/wikipedia/commons/b/b0/Openstreetmap_logo.svg',
            category: 'global',
            description: 'Community-driven global map database built by millions of contributors worldwide. Free and open data covering roads, buildings, amenities, natural features, and land use. Editable by anyone and used as the foundation for countless mapping applications.',
            tags: ['Basemap', 'Navigation', 'Open Data'],
            groups: ['basemap']
        },
        {
            id: 'urbanistmap',
            name: 'UrbanistMap',
            url: `https://urbanistmap.org/#map=${zoom}/${lat}/${lng}`,
            icon: 'https://urbanistmap.org/favicon.svg',
            category: 'global',
            description: 'Minimalist basemap focused on urban form, transit networks, and the built environment. Clean cartography highlighting streets, rail, and density patterns for urban planning and analysis.',
            tags: ['Basemap', 'Urban', 'Transit'],
            groups: ['basemap']
        },
        {
            id: 'osm-spyglass',
            icon: 'https://spyglass.jochentopf.com/img/spyglass.svg',
            name: 'OSM SpyGlass',
            url: `https://spyglass.jochentopf.com/#p=${zoom}/${lat}/${lng}`,
            category: 'global',
            description: 'Experimental OpenStreetMap viewer showcasing advanced rendering techniques and real-time data visualization. Useful for examining OSM data structure, testing map styles, and exploring vector tile performance.',
            tags: ['Open Data', 'Visualization'],
            groups: ['other']
        },
        {
            id: 'sentinel-search',
            name: 'Sentinel-2 Viewer',
            url: `https://sentinel.spatialty.io/#${zoom}/${lat}/${lng}`,
            icon: 'https://spatialty.io/favicon.ico',
            category: 'global',
            description: 'Cloud-optimized search and preview interface for Sentinel-2 satellite imagery from the European Space Agency. Browse and compare recent high-resolution optical imagery (10m resolution) with filtering by cloud coverage and acquisition date.',
            tags: ['Satellite', 'Archive'],
            groups: ['satellite']
        },
        {
            id: 'geohack',
            name: 'Wikipedia GeoHack',
            url: `https://geohack.toolforge.org/geohack.php?params=${Math.abs(lat).toFixed(5)}_${lat >= 0 ? 'N' : 'S'}_${Math.abs(lng).toFixed(5)}_${lng >= 0 ? 'E' : 'W'}`,
            icon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/Wikipedia-logo-v2.svg/120px-Wikipedia-logo-v2.svg.png',
            category: 'global',
            description: 'Wikipedia\'s map sources page for a coordinate: links to dozens of map services, nearby Wikipedia articles and geographic tools for the point.',
            tags: ['Reference', 'Open Data'],
            groups: ['other']
        },
        {
            id: 'mapillary',
            name: 'Mapillary',
            url: `https://www.mapillary.com/app/?lat=${lat}&lng=${lng}&z=${zoom}`,
            icon: 'https://www.google.com/s2/favicons?domain=mapillary.com&sz=64',
            category: 'global',
            description: 'Crowdsourced street-level imagery from contributors around the world, browsable on a map. Also used to map features for OpenStreetMap.',
            tags: ['Street View', 'Open Data'],
            groups: ['street']
        },
        {
            id: 'panoramax',
            name: 'Panoramax',
            url: `https://explore.panoramax.fr/en/index?focus=map&map=${zoom}/${lat}/${lng}`,
            icon: 'https://explore.panoramax.fr/favicon.ico',
            category: 'global',
            description: 'Open, federated street-level imagery shared under open licences, the commons alternative to commercial street view.',
            tags: ['Street View', 'Open Data'],
            groups: ['street']
        },
        {
            id: 'google-maps',
            name: 'Google Maps',
            url: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
            icon: 'https://upload.wikimedia.org/wikipedia/commons/a/aa/Google_Maps_icon_%282020%29.svg',
            category: 'global',
            description: 'The world\'s most popular navigation and mapping service with comprehensive global coverage. Features Street View photography, real-time traffic, transit information, business listings, and route planning for driving, walking, cycling, and public transport.',
            tags: ['Basemap', 'Navigation', 'Satellite', 'Street View'],
            groups: ['basemap', 'street']
        },
        {
            id: 'apple-maps',
            name: 'Apple Maps',
            url: `https://maps.apple.com/?ll=${lat},${lng}&z=${zoom}`,
            icon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Apple_Maps_logo.svg/120px-Apple_Maps_logo.svg.png',
            category: 'global',
            description: 'Apple\'s mapping service with satellite imagery, Look Around street-level views, and turn-by-turn navigation. Features detailed 3D city maps, indoor maps for major venues, and business listings.',
            tags: ['Basemap', 'Navigation', 'Satellite', 'Street View'],
            groups: ['basemap', 'street']
        },
        {
            id: 'here-maps',
            name: 'HERE Maps',
            url: `https://maps.here.com/?map=${lat}%2C${lng}%2C${zoom}`,
            icon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/Here_WeGo_logo.svg/120px-Here_WeGo_logo.svg.png',
            category: 'global',
            description: 'HERE\'s mapping and navigation service with global coverage of roads, traffic, and points of interest. Features satellite imagery, public transit routing, and detailed venue maps.',
            tags: ['Basemap', 'Navigation', 'Satellite'],
            groups: ['basemap']
        },
        {
            id: 'google-earth',
            icon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Google_Earth_Icon.png/120px-Google_Earth_Icon.png',
            name: 'Google Earth',
            url: `https://earth.google.com/web/@${lat},${lng},67.01062587a,1688.30584472d,35y,-0h,0t,0r/data=CgwqBggBEgAYAUICCAFCAggASg0I____________ARAA`,
            text: 'GE',
            category: 'global',
            description: '3D globe viewer with high-resolution satellite imagery, aerial photography, and terrain data. Access historical imagery dating back decades, explore 3D buildings in major cities, and visualize geographic features with elevation profiles.',
            tags: ['Satellite', 'Archive', '3D'],
            groups: ['satellite']
        },
        {
            id: 'esri-landcover',
            name: 'ESRI Sentinel-2 Land Cover Explorer',
            url: `https://livingatlas.arcgis.com/landcoverexplorer/#mapCenter=${lng}%2C${lat}%2C${zoom}.79&mode=step&timeExtent=2017%2C2023&year=2023`,
            icon: 'https://upload.wikimedia.org/wikipedia/en/thumb/6/6e/Esri_logo.svg/120px-Esri_logo.svg.png',
            category: 'global',
            description: 'ESRI Living Atlas land cover classification viewer showing global land use patterns at 10m resolution. Explore change over time with annual updates from 2017-2023, comparing urban growth, deforestation, and agricultural expansion across regions.',
            tags: ['Thematic', 'LULC', 'Archive'],
            groups: ['satellite', 'other']
        },
        {
            id: 'google-timelapse',
            icon: 'https://earthengine.google.com/static/images/earth_engine_logo.png',
            name: 'Google Timelapse (1984-2022)',
            url: `https://earthengine.google.com/timelapse#v=${lat},${lng},15,latLng&t=0.41&ps=50&bt=19840101&et=20221231`,
            text: 'TL',
            category: 'global',
            description: 'Google Earth Engine Timelapse showing 40+ years of planetary change from 1984 to present. Animated satellite imagery reveals urban expansion, deforestation, coastal erosion, glacier retreat, and agricultural development over four decades of Landsat observations. Low Resolution',
            tags: ['Satellite', 'Archive'],
            groups: ['satellite']
        },
        {
            id: 'fire-info',
            icon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/NASA_logo.svg/250px-NASA_logo.svg.png?_=20181013191516',
            name: 'NASA FIRMS Fire Monitoring',
            url: `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${lng},${lat},14.00z`,
            text: 'FR',
            category: 'global',
            description: 'NASA FIRMS (Fire Information for Resource Management System) providing near real-time active fire detection from MODIS and VIIRS satellites. Track wildfires, agricultural burning, and thermal anomalies with 3-6 hour update frequency and historical archive.',
            tags: ['Live', 'Fire', 'Monitoring'],
            groups: ['weather', 'other']
        },
        {
            id: 'copernicus',
            name: 'Copernicus',
            icon: '<div style="background: rgba(235, 235, 235, 1);"><img src="https://upload.wikimedia.org/wikipedia/commons/thumb/a/af/ESA_logo.png/100px-ESA_logo.png" style="max-width: 100%; max-height: 100%; object-fit: contain;"></div>',
            url: `https://browser.dataspace.copernicus.eu/?zoom=${zoom}&lat=${lat}&lng=${lng}&themeId=DEFAULT-THEME&visualizationUrl=U2FsdGVkX18d3QCo8ly51mKnde%2FbnPTNY3M%2Bvkw2HJS5PZYTtLYG6ZjWVDYuz%2Bszj9bzKcR5Th1mcWjsfJneWz3DM1gd75vRaH%2BioFw2j3mQa79Yj8F7TkWwvb2ow0kh&datasetId=3c662330-108b-4378-8899-525fd5a225cb&fromTime=2024-12-01T00%3A00%3A00.000Z&toTime=2024-12-01T23%3A59%3A59.999Z&layerId=0-RGB-RATIO&demSource3D=%22MAPZEN%22&cloudCoverage=30&dateMode=SINGLE`,
            category: 'global',
            description: 'European Space Agency\'s data browser for Sentinel satellites offering free access to petabytes of Earth observation data. Features Sentinel-1 radar, Sentinel-2 optical imagery, and Sentinel-3 land/ocean products with custom band combinations and time series analysis.',
            tags: ['Satellite', 'Archive'],
            groups: ['satellite']
        },
        {
            id: 'landsat',
            name: 'ESRI Landsat Explorer',
            url: `https://livingatlas.arcgis.com/landsatexplorer/#mapCenter=${lng}%2C${lat}%2C${zoom}&mode=dynamic&mainScene=%7CColor+Infrared+for+Visualization%7C`,
            icon: 'https://upload.wikimedia.org/wikipedia/en/thumb/6/6e/Esri_logo.svg/120px-Esri_logo.svg.png',
            category: 'global',
            description: 'USGS/NASA Landsat program explorer with 50+ years of continuous Earth observation imagery at 30m resolution. Access multispectral data from Landsat 1-9, create custom band combinations, analyze vegetation health, and track land cover changes since 1972.',
            tags: ['Satellite', 'Archive'],
            groups: ['satellite']
        },
        {
            id: 'wayback',
            name: 'ESRI Wayback',
            url: `https://livingatlas.arcgis.com/wayback/#mapCenter=${lng}%2C${lat}%2C${zoom}&mode=explore&active=15084`,
            icon: 'https://upload.wikimedia.org/wikipedia/en/thumb/6/6e/Esri_logo.svg/120px-Esri_logo.svg.png',
            category: 'global',
            description: 'ESRI Living Atlas archive of historical World Imagery basemap releases, letting you compare satellite imagery captures over time at the same location. Browse and swipe between hundreds of dated imagery versions to spot changes.',
            tags: ['Satellite', 'Archive', 'Time series'],
            groups: ['satellite']
        },
        {
            id: 'shademap',
            icon: 'https://shademap.app/favicon-32x32.png',
            name: 'ShadeMap',
            url: `https://shademap.app/@${lat},${lng},${zoom}z,${Date.now()}t,0b,0p,0m`,
            category: 'global',
            description: 'Sun and shadow simulator that visualizes how shadows from terrain and buildings move across the landscape throughout the day and year. Useful for solar exposure analysis, planning, and understanding sunlight patterns at any location and time.',
            tags: ['Sun', 'Shadow', 'Analysis'],
            groups: ['weather', 'other']
        },
        {
            id: 'zoom-earth',
            icon: 'https://zoom.earth/assets/images/icon-100.7.jpg',
            name: 'ZoomEarth Weather Monitor',
            url: `https://zoom.earth/maps/temperature/#view=${lat},${lng},11z/place=${lat},${lng}/model=icon/overlays=wind`,
            category: 'global',
            description: 'Real-time weather visualization platform showing temperature, precipitation, wind patterns, storms, and atmospheric conditions. Animated satellite imagery and weather models updated hourly, with historical storm tracking and forecast animations.',
            tags: ['Live', 'Weather'],
            groups: ['weather']
        },
        {
            id: 'nasa-worldview',
            icon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/NASA_logo.svg/250px-NASA_logo.svg.png?_=20181013191516',
            name: 'NASA Worldview',
            url: (() => {
                const bbox = calculateBbox(lng, lat, zoom);
                return `https://worldview.earthdata.nasa.gov/?v=${bbox.west},${bbox.south},${bbox.east},${bbox.north}&l=Reference_Labels_15m(hidden),Reference_Features_15m(hidden),Coastlines_15m(hidden),VIIRS_SNPP_DayNightBand_At_Sensor_Radiance,VIIRS_Black_Marble,VIIRS_SNPP_CorrectedReflectance_TrueColor(hidden),MODIS_Aqua_CorrectedReflectance_TrueColor(hidden),MODIS_Terra_CorrectedReflectance_TrueColor(hidden)&lg=false&t=2021-01-10-T19%3A18%3A03Z`;
            })(),
            category: 'global',
            description: 'NASA\'s near real-time satellite imagery viewer featuring MODIS, VIIRS, and other sensors with same-day coverage. Visualize natural events like wildfires, storms, dust plumes, and volcanic eruptions with corrected reflectance imagery and nighttime lights.',
            tags: ['Satellite', 'Archive', 'Live'],
            groups: ['satellite', 'weather']
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
            tags: ['Live', 'Archive', 'Deforestation'],
            groups: ['satellite', 'other']
        }
    ];
}

function latLngToMercator(lat, lng) {
    const x = lng * 20037508.34 / 180;
    let y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180);
    y = y * 20037508.34 / 180;
    return { x, y };
}

function calculateBbox(centerLng, centerLat, zoom) {
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
