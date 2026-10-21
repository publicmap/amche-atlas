// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { splitAddress, buildAddressBlock, linkOsmObjects, activePart, nearestOnLine } from '../location-address.js';
import { osmContextLinks } from '../location-osm.js';

const PANAJI = {
    house_number: '12',
    road: 'Rua de Ourem',
    neighbourhood: 'Fontainhas',
    quarter: 'Sao Tome',
    city: 'Panaji',
    county: 'Tiswadi',
    state_district: 'North Goa',
    state: 'Goa',
    'ISO3166-2-lvl4': 'IN-GA',
    postcode: '403001',
    country: 'India',
    country_code: 'in'
};

describe('location-address', () => {
    it('splits a Nominatim address into admin crumbs, other parts and the postcode', () => {
        const { crumbs, settlement, details, postcode } = splitAddress(PANAJI);
        expect(crumbs.map(c => c.value)).toEqual(['India', 'Goa', 'North Goa', 'Tiswadi']);
        expect(settlement.map(c => c.value)).toEqual(['Panaji']);
        expect(details.map(d => d.value)).toEqual(['12', 'Rua de Ourem', 'Fontainhas', 'Sao Tome']);
        expect(details[1].query).toBe('Rua de Ourem, Panaji, Tiswadi, North Goa, Goa, India');
        expect(details.map(d => d.zoom)).toEqual([16, 16, 15, 15]);
        expect(postcode).toMatchObject({ value: '403001', query: '403001, India' });
    });

    it('ranks parts from the country inwards', () => {
        const { crumbs, settlement, details, postcode } = splitAddress(PANAJI);
        expect(crumbs.map(c => c.rank)).toEqual([0, 1, 2, 3]);
        expect(settlement.map(c => c.rank)).toEqual([4]);
        expect(postcode.rank).toBe(4.5);
        expect(details.map(d => d.rank)).toEqual([9, 8, 7, 6]);
    });

    it('drops an admin area named like its parent', () => {
        const { crumbs, settlement } = splitAddress({ city: 'Delhi', state: 'Delhi', country: 'India' });
        expect(crumbs.map(c => c.value)).toEqual(['India', 'Delhi']);
        expect(settlement).toEqual([]);
    });

    it('returns nothing for a missing address', () => {
        expect(splitAddress(null)).toEqual({ crumbs: [], settlement: [], details: [], postcode: null });
    });

    it('groups the levels into compartments, most specific first, each named', () => {
        const { el } = buildAddressBlock({ ...PANAJI, suburb: 'Altinho' }, null);
        const compartments = Object.fromEntries([...el.querySelectorAll('.place-compartment')].map(box => [
            box.querySelector('.place-compartment-title').textContent,
            [...box.querySelectorAll('.place-level')].map(row =>
                `${row.querySelector('.place-level-name').textContent}: ${row.querySelector('.place-part-btn').textContent}`)
        ]));
        expect(compartments).toEqual({
            Street: ['house number: 12', 'street: Rua de Ourem', 'postcode: 403001'],
            Locality: ['neighbourhood: Fontainhas', 'quarter: Sao Tome', 'suburb: Altinho', 'city: Panaji'],
            Administrative: ['county: Tiswadi', 'state district: North Goa', 'state: Goa', 'country: India']
        });
    });

    it('makes every part a button and links the ones with an OSM object', () => {
        const { el, parts } = buildAddressBlock(PANAJI, null);
        expect(el.querySelectorAll('.place-part-btn')).toHaveLength(10);
        expect([...el.querySelectorAll('.place-part-btn')].slice(-3).map(b => b.title))
            .toEqual(['View state district center: North Goa', 'View state center: Goa', 'View country center: India']);
        linkOsmObjects(parts, [
            { name: 'Goa', osmType: 'R', osmId: '1997192' },
            { name: 'Rua de Ourem', osmType: 'W', osmId: '42' },
            { name: '403001', osmType: null, osmId: null }
        ]);
        const links = [...el.querySelectorAll('.place-osm-link')].map(a => a.href);
        expect(links).toEqual(['https://www.openstreetmap.org/way/42', 'https://www.openstreetmap.org/relation/1997192']);
        expect(parts.find(p => p.value === 'Goa').osm).toEqual({ osmType: 'R', osmId: '1997192' });
    });
});

describe('location-address levels', () => {
    const ASSAGAO = { neighbourhood: 'Munang Waddo', village: 'Assagao', county: 'Bardez', state_district: 'North Goa', state: 'Goa', postcode: '403517', country: 'India' };
    const ROAD = { osmType: 'way', osmId: '317924166', name: null, category: 'highway', type: 'unclassified' };

    it('names an unnamed road the view is on, linked to its OSM way', () => {
        const { details } = splitAddress(ASSAGAO, ROAD);
        expect(details.map(p => p.value)).toEqual(['Unnamed road', 'Munang Waddo']);
        expect(details[0].osm).toEqual({ osmType: 'way', osmId: '317924166' });
        expect(splitAddress(ASSAGAO, { ...ROAD, type: 'footway' }).details[0].value).toBe('Unnamed path');
        expect(splitAddress(ASSAGAO, { ...ROAD, name: 'NH66' }).details.map(p => p.value)).toEqual(['Munang Waddo']);
        expect(splitAddress(ASSAGAO, { ...ROAD, category: 'building' }).details.map(p => p.value)).toEqual(['Munang Waddo']);
    });

    it('places a house number at the matched object', () => {
        const house = { osmType: 'node', osmId: '14152836404', name: 'Heritage Floresta', category: 'place', type: 'house' };
        const { details } = splitAddress({ ...ASSAGAO, place: 'Heritage Floresta', house_number: 'C101-C406', road: 'Siolim Marna Road' }, house);
        expect(details.find(p => p.key === 'house_number').osm).toEqual({ osmType: 'node', osmId: '14152836404' });
        expect(details.find(p => p.key === 'road').osm).toBeUndefined();
    });

    it('snaps a point to the nearest point of a line', () => {
        const line = { type: 'LineString', coordinates: [[73.80, 15.60], [73.81, 15.60], [73.81, 15.61]] };
        expect(nearestOnLine(line, [73.805, 15.601])).toEqual([73.805, 15.6]);
        expect(nearestOnLine(line, [73.82, 15.62])).toEqual([73.81, 15.61]);
        expect(nearestOnLine({ type: 'MultiLineString', coordinates: [line.coordinates] }, [73.79, 15.59])).toEqual([73.8, 15.6]);
        expect(nearestOnLine({ type: 'Point', coordinates: [73.8, 15.6] }, [73.8, 15.6])).toBeNull();
    });

    it('names street-level parts and gives them icons', () => {
        const house = { osmType: 'node', osmId: '14152836404', name: 'Heritage Floresta', category: 'place', type: 'house' };
        const { parts } = buildAddressBlock({ ...ASSAGAO, place: 'Heritage Floresta', house_number: 'C101-C406', road: 'Siolim Marna Road' }, null, {}, house);
        const shown = Object.fromEntries(parts.map(p => {
            const btn = p.el.querySelector('.place-part-btn');
            return [p.value, [btn.title, btn.querySelector('.place-part-icon')?.getAttribute('name') || null]];
        }));
        expect(shown['Heritage Floresta']).toEqual(['View house name center: Heritage Floresta', 'house']);
        expect(shown['C101-C406']).toEqual(['View house number center: C101-C406', 'hash']);
        expect(shown['Siolim Marna Road']).toEqual(['View street center: Siolim Marna Road', 'signpost-2']);
        expect(shown['403517']).toEqual(['View postcode center: 403517', 'envelope']);
        expect(shown['Assagao']).toEqual(['View village center: Assagao', null]);
    });

    it('picks the most specific part the zoom has reached', () => {
        const { parts } = buildAddressBlock(ASSAGAO, null, {}, ROAD);
        expect(activePart(parts, 4).value).toBe('India');
        expect(activePart(parts, 9.4).value).toBe('North Goa');
        expect(activePart(parts, 12).value).toBe('Assagao');
        expect(activePart(parts, 15).value).toBe('Munang Waddo');
        expect(activePart(parts, 18).value).toBe('Unnamed road');
    });
});

describe('location-osm', () => {
    it('links the place, the editor, the wiki and the community for the view', () => {
        const links = osmContextLinks({ lat: 21.455481, lng: 95.893221, zoom: 4.41 }, { osmType: 'node', osmId: '7', name: 'Mandalay' }, 'Myanmar');
        expect(links.map(l => l.href)).toEqual([
            'https://www.openstreetmap.org/node/7',
            'https://www.openstreetmap.org/edit#map=16/21.45548/95.89322',
            'https://wiki.openstreetmap.org/w/index.php?search=Myanmar',
            'https://openstreetmap.community/?map=21.45548,95.89322&zoom=4.41'
        ]);
    });
});
