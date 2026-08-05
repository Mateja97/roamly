// ESLint loads flat configs as CommonJS by default (package.json has no "type": "module");
// switching to `import` would need an .mjs rename or a package-wide module-type change, both
// out of scope here.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- see comment above
const js = require('@eslint/js');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- see comment above
const tseslint = require('typescript-eslint');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- see comment above
const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...expoConfig,
  {
    ignores: ['dist/*'],
  },
];
