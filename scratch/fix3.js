const fs = require('fs');
const file = 'electron/services/providers/animepahe.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace('import { SimpleStore } from "./store";', 'import { SimpleStore } from "../store";\nimport { StreamProvider, AnimeInfo, EpisodeInfo, StreamLink, StreamData } from "./types";');

fs.writeFileSync(file, content);
console.log("Imports fixed!");
