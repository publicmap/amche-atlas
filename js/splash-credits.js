/**
 * Credits shown on the splash card (js/splash-screen-manager.js), in the
 * manner of an old application splash screen: a dedication, a paragraph
 * naming the data sources (Goa, then India, then global), then one naming the
 * tools used and those thanked.
 *
 * `tools` - the tools it is built with. `thanks` - the community, partners
 * and supporters. `data` - where the map data comes from.
 * The "More Atlases" list of other instances lives in
 * config/splash-projects.json. `goals` - the UN Sustainable Development Goals the project works towards,
 * shown as badges in the goal's official colour.
 */
export const SPLASH_CREDITS = {
    dedication: 'Dedicated to all those who shared their knowledge knowingly or unknowingly for training AI LLM models. May it be used to build a better world.',
    tools: [
        { name: 'Claude', url: 'https://claude.com/claude-code' },
        { name: 'Cursor', url: 'https://cursor.com' },
        { name: 'Mapbox', url: 'https://www.mapbox.com' },
        { name: 'MapLibre', url: 'https://maplibre.org' }
    ],
    thanks: [
        { name: 'OpenStreetMap India Contributors', url: 'https://openstreetmap.in/' },
        { name: 'Goa Foundation', url: 'https://goafoundation.org' },
        { name: 'Vivekanand Environment Awareness Brigade', url: 'https://veabgoa.com/' },
        { name: 'Nagarathna Memorial Grant 2026', url: 'https://thejeshgn.com/2026/04/22/nagarathna-memorial-grant-2026-results/#additional-notes' },
        { name: 'Shweta Taneja', url: 'https://shwetawrites.com/' },
        { name: 'Ashwani Sharma' },
        { name: 'Anubhava Mantapa Servants Of Knowledge Association', url: 'https://research.servantsofknowledge.in' }
    ],
    data: [
        { name: 'Government of Goa', url: 'https://www.goa.gov.in' },
        { name: 'Government of India', url: 'https://www.india.gov.in' },
        { name: 'Survey Of India', url: 'https://surveyofindia.gov.in' },
        { name: 'ISRO', url: 'https://www.isro.gov.in' },
        { name: 'NIC', url: 'https://www.nic.in' },
        { name: 'OpenStreetMap Contributors', url: 'https://www.openstreetmap.org/copyright' },
        { name: 'Mapbox', url: 'https://www.mapbox.com/about/maps' },
        { name: 'Maxar', url: 'https://www.maxar.com' },
        { name: 'NASA', url: 'https://www.nasa.gov' }
    ],
    goals: [
        { number: 6, name: 'Clean Water and Sanitation', color: '#26BDE2' },
        { number: 11, name: 'Sustainable Cities and Communities', color: '#FD9D24' },
        { number: 13, name: 'Climate Action', color: '#3F7E44' },
        { number: 14, name: 'Life Below Water', color: '#0A97D9' },
        { number: 15, name: 'Life on Land', color: '#56C02B' },
        { number: 16, name: 'Peace, Justice and Strong Institutions', color: '#00689D' },
        { number: 17, name: 'Partnerships for the Goals', color: '#19486A' }
    ]
};
