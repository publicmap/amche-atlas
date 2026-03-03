const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const fs = require('fs');
const CleanCSS = require('clean-css');

module.exports = {
    mode: 'production',
    entry: {
        main: './js/index.js',
    },
    output: {
        filename: 'js/[name].bundle.js',
        path: path.resolve(__dirname, 'dist'),
        clean: true,
    },
    plugins: [
        new HtmlWebpackPlugin({
            // We use templateContent to modify the HTML before webpack processes it
            templateContent: () => {
                const html = fs.readFileSync('./index.html', 'utf8');
                // Remove the original script tags to avoid duplication
                return html
                    .replace('<script defer type="module" src="js/index.js"></script>', '');
            },
            filename: 'index.html',
            chunks: ['main'], // Only inject main bundle automatically
            scriptLoading: 'defer',
            inject: 'head', // Inject into head as per original
        }),
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: 'css',
                    to: 'css',
                    transform(content, path) {
                        if (path.endsWith('.css')) {
                            return new CleanCSS({}).minify(content).styles;
                        }
                        return content;
                    }
                },
                { from: 'docs', to: 'docs' },
                { from: 'assets', to: 'assets' },
                { from: 'config', to: 'config' },
                {
                    from: 'js',
                    to: 'js',
                    globOptions: {
                        ignore: ['**/index.js', '**/tests/**']
                    }
                },
                { from: 'map-browser.html', to: 'map-browser.html' },
                { from: 'map-creator.html', to: 'map-creator.html' },
                { from: 'map-export.html', to: 'map-export.html' },
                { from: 'map-inspector.html', to: 'map-inspector.html' },
                { from: 'map-information.html', to: 'map-information.html' },
                { from: 'map-export-layout.html', to: 'map-export-layout.html' },
                { from: 'offline.html', to: 'offline.html' },
                { from: 'privacy.html', to: 'privacy.html' },
                { from: 'manifest.json', to: 'manifest.json' },
                { from: 'service-worker.js', to: 'service-worker.js' },
                { from: '.nojekyll', to: '.nojekyll' },
                { from: 'bus', to: 'bus' },
                { from: 'game', to: 'game' },
                { from: 'warper', to: 'warper' },
                { from: 'sound', to: 'sound' },
                { from: 'pages', to: 'pages' },
            ],
        }),
    ],
};
