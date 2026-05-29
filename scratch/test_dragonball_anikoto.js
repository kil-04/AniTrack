const { app } = require('electron');
const { AnikotoProvider } = require('../dist-electron/electron/services/providers/anikoto');

app.whenReady().then(async () => {
  try {
    const provider = new AnikotoProvider();
    console.log("Searching for 'Dragon Ball' on Anikoto...");
    const results = await provider.search('Dragon Ball');
    console.log("Found results:", results.length);
    console.log(JSON.stringify(results.map(r => ({ id: r.id, title: r.title, episodes: r.episodes, year: r.year })), null, 2));
    
    // Find the main "Dragon Ball" (153 eps) or similar
    const mainDb = results.find(r => r.title === "Dragon Ball" || r.id === "dragon-ball");
    if (mainDb) {
      console.log("Found main Dragon Ball series:", mainDb);
      console.log("Fetching episodes for main series...");
      const eps = await provider.getEpisodes(mainDb.id);
      console.log("Total episodes parsed:", eps.total);
      if (eps.data.length > 0) {
        console.log("First episode:", eps.data[0]);
        console.log("Last episode:", eps.data[eps.data.length - 1]);
        
        console.log("Resolving first episode stream...");
        const links = await provider.getStreamLinks(eps.data[0].id, mainDb.id);
        console.log("Stream links:", links);
        if (links.length > 0) {
          const resolved = await provider.resolveStream(links[0].id);
          console.log("Resolved stream info:", {
            url: resolved.url ? resolved.url.substring(0, 100) + "..." : null,
            subtitles: resolved.subtitles
          });
        }
      }
    } else {
      console.log("Main Dragon Ball series not found in results!");
    }
  } catch (err) {
    console.error("Test failed:", err);
  }
  app.quit();
});
