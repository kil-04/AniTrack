const fs = require('fs');
const path = require('path');
const os = require('os');

const appData = path.join(os.homedir(), 'AppData/Roaming');
const lowercaseDir = path.join(appData, 'anitrack');
const uppercaseDir = path.join(appData, 'AniTrack');

console.log("Lowercase dir exists:", fs.existsSync(lowercaseDir));
if (fs.existsSync(lowercaseDir)) {
  console.log("  anitrack.db exists:", fs.existsSync(path.join(lowercaseDir, 'anitrack.db')));
}

console.log("Uppercase dir exists:", fs.existsSync(uppercaseDir));
if (fs.existsSync(uppercaseDir)) {
  console.log("  anitrack.db exists:", fs.existsSync(path.join(uppercaseDir, 'anitrack.db')));
}
