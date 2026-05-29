const fs = require('fs');

function unpackJs(packed) {
  try {
    const match = packed.match(/}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/);
    if (!match) return "NO MATCH";
    let [, encoded, radixStr, , keysStr] = match;
    
    encoded = encoded.replace(/\\\\/g, "\\x00ESC\\x00").replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\//g, "/").replace(/\\x00ESC\\x00/g, "\\\\");
    
    const radix = parseInt(radixStr, 10);
    const keys = keysStr.split("|");
    function baseN(n) {
      const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      if (n === 0) return "0"; let r = "";
      while (n > 0) { r = chars[n % radix] + r; n = Math.floor(n / radix); } return r;
    }
    const lookup = {};
    keys.forEach((w, i) => { if (w) lookup[baseN(i)] = w; });
    
    // Dump lookup
    return "LOOKUP:\n" + Object.entries(lookup).map(([k,v])=>`${k}=${v}`).join(", ") + "\n\nKEYS:\n" + keys.join("|") + "\n\nENCODED:\n" + encoded;
  } catch(e) { return e.toString(); }
}

const input = fs.readFileSync('scratch/kwik.log', 'utf8');
console.log(unpackJs(input));
