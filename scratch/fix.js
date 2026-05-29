const fs = require('fs');
const file = 'electron/services/providers/animepahe.ts';
let content = fs.readFileSync(file, 'utf8');

const key = 'export async function findByExternalId';
const idx1 = content.indexOf(key);
const idx2 = content.indexOf(key, idx1 + 1);

if (idx2 !== -1) {
  const endKey = '// ─── Kwik resolver';
  const endIdx = content.indexOf(endKey, idx2);
  if (endIdx !== -1) {
    // Cut from idx2 all the way to endIdx
    // Also remove any preceding comments for the duplicate block
    const commentKey = '// ── 2. AnimePahe page meta tags';
    const cutStart = content.lastIndexOf(commentKey, idx2);
    const finalCutStart = cutStart !== -1 ? cutStart : idx2;
    
    content = content.slice(0, finalCutStart) + content.slice(endIdx);
    
    // Also, make sure there's no dangling 'try {' that was left unclosed before the cut.
    // We can just rely on TS to tell us if there are syntax errors.
    fs.writeFileSync(file, content);
    console.log('Fixed dupes!');
  } else {
    console.log('Could not find end of dupe block');
  }
} else {
  console.log('No dupe found');
}
