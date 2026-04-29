import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const files = [
  join('node_modules', '@electron', 'osx-sign', 'dist', 'cjs', 'sign.js'),
  join('node_modules', '@electron', 'osx-sign', 'dist', 'esm', 'sign.js')
];

const cjsNeedle = `        if (perFileOptions.timestamp) {
            perFileArgs.push('--timestamp=' + perFileOptions.timestamp);
        }
        else {
            perFileArgs.push('--timestamp');
        }`;

const cjsReplacement = `        if (perFileOptions.timestamp) {
            perFileArgs.push('--timestamp=' + perFileOptions.timestamp);
        }`;

const esmNeedle = `        if (perFileOptions.timestamp) {
            perFileArgs.push('--timestamp=' + perFileOptions.timestamp);
        }
        else {
            perFileArgs.push('--timestamp');
        }`;

for (const file of files) {
  let source = await readFile(file, 'utf8');
  if (source.includes(cjsNeedle)) {
    source = source.replace(cjsNeedle, cjsReplacement);
    await writeFile(file, source);
    console.log(`patched ${file}`);
    continue;
  }
  if (source.includes(esmNeedle)) {
    source = source.replace(esmNeedle, cjsReplacement);
    await writeFile(file, source);
    console.log(`patched ${file}`);
    continue;
  }
  if (source.includes("perFileArgs.push('--timestamp=' + perFileOptions.timestamp)")) {
    console.log(`already patched ${file}`);
    continue;
  }
  throw new Error(`Unable to patch timestamp behavior in ${file}`);
}

const macPackagerFile = join('node_modules', 'app-builder-lib', 'out', 'macPackager.js');
const identityNameNeedle =
  'return customSign ? Promise.resolve(customSign(opts, this)) : (0, macCodeSign_1.sign)({ ...opts, identity: identity ? identity.name : undefined });';
const identityHashReplacement =
  'return customSign ? Promise.resolve(customSign(opts, this)) : (0, macCodeSign_1.sign)({ ...opts, identity: identity ? identity.hash || identity.name : undefined });';

let macPackagerSource = await readFile(macPackagerFile, 'utf8');
if (macPackagerSource.includes(identityNameNeedle)) {
  macPackagerSource = macPackagerSource.replace(identityNameNeedle, identityHashReplacement);
  await writeFile(macPackagerFile, macPackagerSource);
  console.log(`patched ${macPackagerFile}`);
} else if (macPackagerSource.includes(identityHashReplacement)) {
  console.log(`already patched ${macPackagerFile}`);
} else {
  throw new Error(`Unable to patch macOS signing identity behavior in ${macPackagerFile}`);
}
