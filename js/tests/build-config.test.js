import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

describe('Build Configuration', () => {
  it('should include all root-level HTML files in vite.config.js', async () => {
    const viteConfig = fs.readFileSync(path.join(rootDir, 'vite.config.js'), 'utf8');

    const excludedFiles = [
      'offline.html',
      'privacy.html'
    ];
    const htmlFiles = fs.readdirSync(rootDir)
      .filter(file => file.endsWith('.html') && !file.startsWith('.'))
      .filter(file => !excludedFiles.includes(file));

    const missingFiles = [];
    for (const file of htmlFiles) {
      if (!viteConfig.includes(`'${file}'`)) {
        missingFiles.push(file);
      }
    }

    expect(missingFiles,
      `Missing HTML files in vite.config.js: ${missingFiles.join(', ')}\n` +
      'Add them to build.rollupOptions.input object'
    ).toEqual([]);
  });

  it('should include all root-level HTML files in webpack.config.js', async () => {
    const webpackConfig = fs.readFileSync(path.join(rootDir, 'webpack.config.js'), 'utf8');

    const excludedFiles = [
      'index.html',
      'offline.html',
      'privacy.html'
    ];
    const htmlFiles = fs.readdirSync(rootDir)
      .filter(file => file.endsWith('.html') && !file.startsWith('.'))
      .filter(file => !excludedFiles.includes(file));

    const missingFiles = [];
    for (const file of htmlFiles) {
      if (!webpackConfig.includes(`'${file}'`)) {
        missingFiles.push(file);
      }
    }

    expect(missingFiles,
      `Missing HTML files in webpack.config.js: ${missingFiles.join(', ')}\n` +
      'Add them to CopyWebpackPlugin patterns array'
    ).toEqual([]);
  });

  it('should include special purpose directories in webpack.config.js', async () => {
    const webpackConfig = fs.readFileSync(path.join(rootDir, 'webpack.config.js'), 'utf8');

    const specialDirs = ['bus', 'game', 'warper', 'sound', 'pages'];

    const missingDirs = specialDirs.filter(dir => {
      const dirPath = path.join(rootDir, dir);
      return fs.existsSync(dirPath) && !webpackConfig.includes(`'${dir}'`);
    });

    expect(missingDirs,
      `Missing directories in webpack.config.js: ${missingDirs.join(', ')}\n` +
      'Add them to CopyWebpackPlugin patterns array'
    ).toEqual([]);
  });

  it('should have matching HTML files between vite and webpack configs', async () => {
    const viteConfig = fs.readFileSync(path.join(rootDir, 'vite.config.js'), 'utf8');
    const webpackConfig = fs.readFileSync(path.join(rootDir, 'webpack.config.js'), 'utf8');

    const viteInputMatch = viteConfig.match(/input:\s*{([^}]+)}/s);
    if (!viteInputMatch) {
      throw new Error('Could not parse vite.config.js input object');
    }

    const viteHtmlFiles = [...viteInputMatch[1].matchAll(/'([^']+\.html)'/g)]
      .map(m => m[1])
      .filter(f => f !== 'index.html');

    const missingInWebpack = [];
    for (const file of viteHtmlFiles) {
      if (!webpackConfig.includes(`'${file}'`)) {
        missingInWebpack.push(file);
      }
    }

    expect(missingInWebpack,
      `HTML files in vite.config.js but missing in webpack.config.js: ${missingInWebpack.join(', ')}`
    ).toEqual([]);
  });
});
