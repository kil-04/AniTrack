const { app } = require("electron");
const { AnikotoProvider } = require("../dist-electron/electron/services/providers/anikoto.js");

app.whenReady().then(async () => {
  const provider = new AnikotoProvider();
  const animeId = "one-piece-odmau";
  const epNumber = 1045;

  try {
    console.log(`Fetching episodes for: ${animeId}`);
    const eps = await provider.getEpisodes(animeId, 1);
    console.log("Total parsed episodes:", eps.data?.length);
    
    const ep = eps.data.find(e => e.episodeNumber === epNumber);
    if (!ep) {
      console.error(`Episode ${epNumber} not found!`);
      app.quit();
      return;
    }
    
    console.log(`Found episode in list:`, ep);
    
    console.log(`Getting stream links...`);
    const links = await provider.getStreamLinks(ep.id, animeId);
    console.log(`Available links:`, links);
    
    // Test resolving the "soft" link (which is typically quality 0)
    console.log(`Resolving soft stream link:`, links[0].id);
    const softData = await provider.resolveStream(links[0].id);
    console.log(`Soft sub stream data:`, softData);

    // Test resolving the "hard" link (quality 1)
    console.log(`Resolving hard stream link:`, links[1].id);
    const hardData = await provider.resolveStream(links[1].id);
    console.log(`Hard sub stream data:`, hardData);

  } catch (err) {
    console.error("Test failed:", err);
  } finally {
    app.quit();
  }
});
