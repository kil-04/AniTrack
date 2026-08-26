const { app } = require("electron");
const { search, getPaheBaseUrl } = require("./dist-electron/electron/services/providers/animepahe.js");

app.whenReady().then(async () => {
  console.log("Current Base URL:", getPaheBaseUrl());
  try {
    console.log("Testing search for 'love game'...");
    const res = await search("love game");
    console.log("Search result size:", res.length);
    if (res.length > 0) {
      console.log("First search result:", res[0]);
    }
  } catch (err) {
    console.error("AnimePahe search failed:", err);
  }
  app.quit();
});
