/**
 * Save to GitHub gist in the layer editor (map-creator.html, beside Shareable).
 *
 * Data the editor holds (uploaded, drawn, copied) that can't ride in the map
 * link is kept in this browser only. This saves it as a secret gist under the
 * user's GitHub account - named and described from the layer's title,
 * description and attribution - and makes the gist's raw file the layer's
 * data source, so the layer can be shared like any linked layer.
 */

import { githubToken, signInGithub, signOutGithub } from './github-auth.js';
import { LayerConfigGenerator } from './layer-creator-ui.js';

const LABEL = 'Save to GitHub gist';

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'layer';

async function createSecretGist(token, { filename, description, content }) {
    const response = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ description, public: false, files: { [filename]: { content } } })
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
        signOutGithub();
        throw new Error('Your GitHub sign-in has expired. Click Save to GitHub gist again to sign in.');
    }
    if (!response.ok) throw new Error(data.message || `GitHub returned ${response.status}`);
    return { rawUrl: data.files[filename].raw_url, htmlUrl: data.html_url };
}

function gistDetails() {
    const title = $('#layer-title').val().trim() || 'Custom Layer';
    const description = $('#layer-description').val().trim();
    const attribution = $('#layer-attribution').val().trim();
    return {
        filename: `${slug(title)}.geojson`,
        description: [title, description, attribution && `Source: ${attribution}`].filter(Boolean).join(' · ')
    };
}

/** Make the gist's raw file the layer's data source, and drop the copy kept in this browser. */
function useGistSource(creator, url) {
    const stored = creator._storedLocal?.id;
    creator.currentDataSource = url;
    creator._loadedInput = url;
    $('#url-input').val(url);
    $('#clear-url-btn').removeClass('hidden');
    if (creator.edit.active) {
        creator.edit.source = { kind: 'url', value: url };
        creator.edit.sourceChanged = true;
    }
    creator.keepStoredData();
    creator.updateConfigPreview();
    creator.dataCard.refresh();
    if (stored && stored !== creator.edit.originalId) {
        setTimeout(() => LayerConfigGenerator.deleteGeoJSONData(stored), 2000);
    }
}

export async function saveDataToGist(creator) {
    if (creator.currentLayerType !== 'geojson' || !creator.currentData?.features) {
        alert('Only GeoJSON layers can be saved to a gist for now.');
        return;
    }
    const $btn = $('#save-to-gist-btn');
    const token = githubToken();
    const signingIn = token ? null : signInGithub();
    $btn.prop('disabled', true).find('span').text(token ? 'Saving to GitHub…' : 'Signing in to GitHub…');
    try {
        const auth = token || await signingIn;
        $btn.find('span').text('Saving to GitHub…');
        const gist = await createSecretGist(auth, { ...gistDetails(), content: JSON.stringify(creator.currentData) });
        useGistSource(creator, gist.rawUrl);
        creator.layerPage?.refresh?.();
        console.info('[creator-gist] Saved to', gist.htmlUrl);
    } catch (error) {
        alert(`Could not save to GitHub: ${error.message}`);
    } finally {
        $btn.prop('disabled', false).find('span').text(LABEL);
    }
}
