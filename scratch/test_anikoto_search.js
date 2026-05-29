const { app } = require("electron");
const { AnikotoProvider } = require("../dist-electron/electron/services/providers/anikoto.js");

app.whenReady().then(async () => {
  const provider = new AnikotoProvider();
  console.log("Testing Anikoto search for 'Classroom of the Elite'...");
  try {
    const res = await provider.search("Classroom of the Elite");
    console.log("Search result size:", res.length);
    if (res.length > 0) {
      console.log("First search result:", res[0]);
      
      console.log("Testing Anikoto getEpisodes for:", res[0].id);
      const eps = await provider.getEpisodes(res[0].id, 1);
      console.log("Episodes result length:", eps.data?.length);
      if (eps.data?.length > 0) {
        console.log("First episode:", eps.data[0]);
        console.log("Testing Anikoto getStreamLinks for:", eps.data[0].id);
        const links = await provider.getStreamLinks(eps.data[0].id, res[0].id);
        console.log("Links:", links);
        if (links.length > 0) {
          console.log("Testing Anikoto resolveStream for:", links[0].id);
          const data = await provider.resolveStream(links[0].id);
          console.log("Stream data:", data);
        }
      }
    }
  } catch (err) {
    console.error("Anikoto test failed:", err);
  }
  app.quit();
});
