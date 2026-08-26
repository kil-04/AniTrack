const { app } = require("electron");
const { AnikotoProvider } = require("./dist-electron/electron/services/providers/anikoto.js");

app.whenReady().then(async () => {
  const provider = new AnikotoProvider();
  try {
    console.log("Searching for 'I Want to End This Love Game'...");
    const results = await provider.search("I Want to End This Love Game");
    console.log("Search results:", JSON.stringify(results, null, 2));
    
    if (results.length === 0) {
      console.log("No anime found!");
      app.quit();
      return;
    }
    
    const target = results[0];
    const animeId = target.id; // e.g. the slug
    console.log("Fetching episodes for:", animeId);
    
    const eps = await provider.getEpisodes(animeId);
    console.log(`Found ${eps.data.length} episodes.`);
    
    const ep2 = eps.data.find(e => e.episodeNumber === 2);
    const ep7 = eps.data.find(e => e.episodeNumber === 7);
    
    if (ep2) {
      console.log("Episode 2 ID:", ep2.id);
      const links2 = await provider.getStreamLinks(ep2.id, animeId);
      console.log("Episode 2 links:", links2);
      
      // Resolve soft sub and hard sub
      for (const link of links2) {
        console.log(`Resolving Ep 2 (${link.quality})...`);
        try {
          const resolved = await provider.resolveStream(link.id);
          console.log(`Ep 2 Resolved URL:`, resolved.url);
          console.log(`Ep 2 Resolved Subtitles count:`, resolved.subtitles ? resolved.subtitles.length : 0);
          if (resolved.subtitles && resolved.subtitles.length > 0) {
            console.log("Ep 2 Subtitle example:", resolved.subtitles[0]);
          }
        } catch (err) {
          console.error(`Failed to resolve Ep 2 (${link.quality}):`, err.message);
        }
      }
    } else {
      console.log("Episode 2 not found!");
    }
    
    if (ep7) {
      console.log("Episode 7 ID:", ep7.id);
      const links7 = await provider.getStreamLinks(ep7.id, animeId);
      console.log("Episode 7 links:", links7);
      
      // Resolve soft sub and hard sub
      for (const link of links7) {
        console.log(`Resolving Ep 7 (${link.quality})...`);
        try {
          const resolved = await provider.resolveStream(link.id);
          console.log(`Ep 7 Resolved URL:`, resolved.url);
          console.log(`Ep 7 Resolved Subtitles count:`, resolved.subtitles ? resolved.subtitles.length : 0);
          if (resolved.subtitles && resolved.subtitles.length > 0) {
            console.log("Ep 7 Subtitle example:", resolved.subtitles[0]);
          }
        } catch (err) {
          console.error(`Failed to resolve Ep 7 (${link.quality}):`, err.message);
        }
      }
    } else {
      console.log("Episode 7 not found!");
    }
    
  } catch (err) {
    console.error("Test failed:", err);
  }
  app.quit();
});
