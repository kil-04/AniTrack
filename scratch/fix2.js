const fs = require('fs');
const file = 'electron/services/providers/animepahe.ts';
let content = fs.readFileSync(file, 'utf8');

// I am just going to grab the exact clean state from animepahe-head.ts!
const headContent = fs.readFileSync('scratch/animepahe-head.ts', 'utf8');

// The original file ends with `prewarm()` at line 710.
// Let's extract everything from the current file starting from `export class AnimePaheProvider` to the end.
const providerStart = content.indexOf('export class AnimePaheProvider');
if (providerStart !== -1) {
  const providerClass = content.slice(providerStart);
  // Just concatenate the two
  const finalContent = headContent + "\n" + providerClass;
  fs.writeFileSync(file, finalContent);
  console.log("Reconstructed cleanly!");
} else {
  console.log("Could not find provider class in the messed up file!");
}
