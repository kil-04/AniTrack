const fs = require('fs');

const json = JSON.parse(fs.readFileSync('scratch/servers_ajax.json', 'utf8'));
const html = json.result;

// Let's parse the types
const types = [];
const typeRe = /<div class="type"[^>]*>([\s\S]*?)<\/ul>\s*<\/div>/g;
let match;
while ((match = typeRe.exec(html)) !== null) {
  const typeHtml = match[1];
  const labelM = /<label[^>]*>([\s\S]*?)<\/label>/.exec(typeHtml);
  const label = labelM ? labelM[1].replace(/<[^>]+>/g, '').trim() : '';
  
  // Find all li elements inside this type
  const liRe = /<li[^>]+data-link-id="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g;
  let liMatch;
  const items = [];
  while ((liMatch = liRe.exec(typeHtml)) !== null) {
    items.push({
      linkId: liMatch[1],
      name: liMatch[2].replace(/<[^>]+>/g, '').trim()
    });
  }
  
  types.push({
    label,
    items
  });
}

console.log('Parsed types:', JSON.stringify(types, null, 2));

// Test finding target server for "soft" (SUB but not H-SUB) and "hard" (H-SUB)
function getLinkIdForSubtype(subType) {
  const targetType = types.find(t => {
    const labelText = t.label.toUpperCase();
    return subType === "hard" ? labelText.includes("H-SUB") : (labelText.includes("SUB") && !labelText.includes("H-SUB"));
  });
  
  if (targetType && targetType.items.length > 0) {
    return targetType.items[0].linkId;
  }
  return null;
}

console.log('Soft sub linkId:', getLinkIdForSubtype('soft'));
console.log('Hard sub linkId:', getLinkIdForSubtype('hard'));
