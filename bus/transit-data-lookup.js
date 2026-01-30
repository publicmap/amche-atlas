export const TRANSIT_DATA_LOOKUP = [
    {
        name: 'Mumbai',
        agency: 'BEST',
        description: 'Brihanmumbai Electric Supply and Transport',
        bounds: {
            north: 19.3,
            south: 18.9,
            east: 72.98,
            west: 72.77
        },
        center: [72.88, 19.08],
        zoom: 11,
        chaloApiCity: 'mumbai',
        useIframe: false
    },
    {
        name: 'Kerala',
        agency: 'KSRTC',
        description: 'Kerala State Road Transport Corporation',
        bounds: {
            north: 12.8,
            south: 8.3,
            east: 77.4,
            west: 74.9
        },
        center: [76.27, 10.85],
        zoom: 8,
        chaloApiCity: null,
        useIframe: false
    },
    {
        name: 'Goa',
        agency: 'KTC',
        description: 'Kadamba Transport Corporation',
        bounds: {
            north: 15.8,
            south: 14.9,
            east: 74.4,
            west: 73.7
        },
        center: [73.83, 15.49],
        zoom: 10,
        chaloApiCity: null,
        useIframe: true,
        iframeUrl: 'https://ashishgaude.github.io/kadamba-transport/'
    }
];
