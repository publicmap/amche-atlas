#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {glob} = require('glob');

/**
 * JSON Linter for config files
 * Validates JSON syntax and structure for all config/*.atlas.json files
 */

let hasErrors = false;

function logError(message) {
    console.error(`❌ ${message}`);
    hasErrors = true;
}

function logSuccess(message) {
    console.log(`✅ ${message}`);
}

function logInfo(message) {
    console.log(`ℹ️  ${message}`);
}

/**
 * Validate JSON syntax
 */
function validateJsonSyntax(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        JSON.parse(content);
        return true;
    } catch (error) {
        logError(`Invalid JSON syntax in ${filePath}: ${error.message}`);
        return false;
    }
}

/**
 * Validate that required fields exist in config files
 */
function validateConfigStructure(filePath, data) {
    const fileName = path.basename(filePath);

    // Skip validation for _map-layer-presets.json as it has a different structure
    if (fileName === '_map-layer-presets.json') {
        if (!data.layers || !Array.isArray(data.layers)) {
            logError(`${filePath}: Missing or invalid 'layers' array`);
            return false;
        }

        // Validate each layer has required fields
        for (let i = 0; i < data.layers.length; i++) {
            const layer = data.layers[i];
            if (!layer.id) {
                logError(`${filePath}: Layer at index ${i} missing required 'id' field`);
                return false;
            }
            if (!layer.title) {
                logError(`${filePath}: Layer '${layer.id}' missing required 'title' field`);
                return false;
            }
        }
        return true;
    }

    // For other config files, validate they have layers array with id references
    if (fileName !== '_defaults.json' && fileName !== 'README.md') {
        if (!data.layers || !Array.isArray(data.layers)) {
            logError(`${filePath}: Missing or invalid 'layers' array`);
            return false;
        }

        // Validate each layer reference has an id
        for (let i = 0; i < data.layers.length; i++) {
            const layer = data.layers[i];
            if (!layer.id) {
                logError(`${filePath}: Layer at index ${i} missing required 'id' field`);
                return false;
            }
        }
    }

    return true;
}

/**
 * Main linting function
 */
async function lintJsonFiles() {
    logInfo('Starting JSON linting for config files...');

    try {
        // Find all atlas JSON files in config directory
        const jsonFiles = await glob('config/*.atlas.json', {cwd: process.cwd()});

        if (jsonFiles.length === 0) {
            logError('No atlas JSON files found in config directory');
            return;
        }

        logInfo(`Found ${jsonFiles.length} atlas JSON files to validate`);

        for (const filePath of jsonFiles) {
            const fullPath = path.resolve(filePath);

            // Validate JSON syntax
            if (!validateJsonSyntax(fullPath)) {
                continue; // Skip structure validation if syntax is invalid
            }

            // Parse and validate structure
            const content = fs.readFileSync(fullPath, 'utf8');
            const data = JSON.parse(content);

            if (validateConfigStructure(fullPath, data)) {
                logSuccess(`${filePath} - Valid JSON structure`);
            }
        }

        if (hasErrors) {
            logError('JSON linting completed with errors');
            process.exit(1);
        } else {
            logSuccess('All atlas JSON files passed validation');
        }

    } catch (error) {
        logError(`Error during JSON linting: ${error.message}`);
        process.exit(1);
    }
}

// Run the linter
if (require.main === module) {
    lintJsonFiles();
}

module.exports = {lintJsonFiles, validateJsonSyntax, validateConfigStructure};