import { describe, it, expect } from 'vitest';
import { parseAttribution, formatAttribution, impliedLicense, sourceKey } from '../attribution.js';

const tidy = (html) => {
    const { parts, license } = parseAttribution(html);
    return { text: formatAttribution(parts), license };
};

describe('parseAttribution', () => {
    it('puts the original source first, the derived work after, and takes the license out', () => {
        const { text, license } = tidy("<a href='https://commons.wikimedia.org/wiki/File:Goa_Bus_Network_Map_2025.png'>CC-BY Wikipedia/user:Planemad</a>, CC-by <a href='https://ktclgoa.com/gtfs/'>Kadamba Transport Corporation Limited GTFS updated Jan 2025</a>");
        expect(text).toBe("<a href='https://ktclgoa.com/gtfs/'>Kadamba Transport Corporation Limited GTFS updated Jan 2025</a>, <a href='https://commons.wikimedia.org/wiki/File:Goa_Bus_Network_Map_2025.png'>CC-BY Wikipedia/user:Planemad</a>");
        expect(license).toBe('CC-BY');
    });

    it('drops the connecting words between source and intermediary', () => {
        expect(tidy("Source: <a href='https://parivesh.nic.in/'>Parivesh</a> &mdash; Collected by <a href='https://datameet.org'>Datameet Community</a>").text)
            .toBe("<a href='https://parivesh.nic.in/'>Parivesh</a>, <a href='https://datameet.org'>Datameet Community</a>");
        expect(tidy("<a href='https://tcp.goa.gov.in/'>Outline Development Plan 2011, TCP Goa</a>. Georeferenced using <a href='https://mapwarper.net/layers/2151'>Mapwarper</a>").text)
            .toBe("<a href='https://tcp.goa.gov.in/'>Outline Development Plan 2011, TCP Goa</a>, <a href='https://mapwarper.net/layers/2151'>Mapwarper</a>");
    });

    it('keeps © credits and unlinked names', () => {
        expect(tidy("© OpenStreetMap contributors via <a href='https://openinframap.org/'>OpenInfraMap</a>").text)
            .toBe("© OpenStreetMap contributors, <a href='https://openinframap.org/'>OpenInfraMap</a>");
        expect(tidy('Goa Foundation via RTI via <a href="https://mapwarper.net/maps/104836">MapWarper</a>').text)
            .toBe("Goa Foundation, RTI, <a href='https://mapwarper.net/maps/104836'>MapWarper</a>");
    });

    it('names a link that only says "View Original" or shows a URL by its site', () => {
        expect(tidy('Forest Survey of India - <a href="https://mapwarper.net/maps/95901#Rectify_tab">View Original</a>').text)
            .toBe("Forest Survey of India, <a href='https://mapwarper.net/maps/95901#Rectify_tab'>MapWarper</a>");
        expect(tidy("<a href='https://drive.google.com/x'>https://drive.google.com/x</a> via <a href='https://mapwarper.net/maps/1'>MapWarper</a>").text)
            .toBe("<a href='https://drive.google.com/x'>Google Drive</a>, <a href='https://mapwarper.net/maps/1'>MapWarper</a>");
    });

    it('reads license wording anywhere in the attribution', () => {
        expect(tidy("<a href='https://commons.wikimedia.org/wiki/X'>Wikimedia Commons: X</a> via <a href='https://warper.wmflabs.org/maps/1'>Wikimaps Warper</a> released in public domain").license).toBe('Public Domain');
        expect(tidy("CC-0 <a href='https://gebco.net'>GEBCO Bathymetry</a>").license).toBe('CC0');
        expect(tidy("<a href='https://commons.wikimedia.org/wiki/M'>CC-by-sa-2.0 Rapid transit map</a>").license).toBe('CC-BY-SA-2.0');
    });
});

describe('impliedLicense', () => {
    it('knows the license of OpenStreetMap data', () => {
        expect(impliedLicense(parseAttribution("<a href='https://www.openstreetmap.org/'>© OpenStreetMap contributors</a>").parts)).toBe('ODbL');
    });
});

describe('sourceKey', () => {
    it('groups file names under their site and drops a label suffix', () => {
        expect(sourceKey({ text: 'File:Madras_1733.jpg', href: 'https://commons.wikimedia.org/wiki/File:Madras_1733.jpg' })).toBe('Wikimedia Commons');
        expect(sourceKey({ text: 'Datameet Community:LGD_Districts', href: 'https://github.com/ramSeraph' })).toBe('Datameet Community');
        expect(sourceKey({ text: '© OpenStreetMap contributors', href: null })).toBe('OpenStreetMap contributors');
    });
});
