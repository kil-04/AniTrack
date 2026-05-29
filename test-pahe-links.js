const { app } = require("electron");
const { getEpisodes, getStreamLinks } = require("./dist-electron/electron/services/providers/animepahe.js");

app.whenReady().then(async () => {
  const session = "8231b3de-1a93-bac3-7e5b-4469b83eb1f6";
  try {
    console.log("Fetching episodes for session:", session);
    const eps = await getEpisodes(session, 1);
    console.log("Episodes parsed:", JSON.stringify(eps.data, null, 2));
    
    // Find the last episode in the list
    if (eps.data.length > 0) {
      const lastEp = eps.data[eps.data.length - 1];
      console.log(`Fetching stream links for last episode (Ep ${lastEp.episodeNumber})...`);
      const links = await getStreamLinks(lastEp.session, session);
      console.log("Stream links:", JSON.stringify(links, null, 2));
    }
  } catch (err) {
    console.error("Failed:", err);
  }
  app.quit();
});
