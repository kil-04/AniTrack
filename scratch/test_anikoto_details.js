const { app } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  try {
    const { providerManager } = require(path.join(__dirname, '../dist-electron/electron/services/providers/index.js'));

    console.log("Fetching details for Anikoto ID 'city-hunter-u0627'...");
    const ep1 = await providerManager.getEpisodes('anikoto', 'city-hunter-u0627', 1);
    console.log("city-hunter-u0627 episodes count:", ep1.data.length);
    console.log("First episode details:", ep1.data[0]);

    console.log("\nFetching details for Anikoto ID 'city-hunter-hndzd'...");
    const ep2 = await providerManager.getEpisodes('anikoto', 'city-hunter-hndzd', 1);
    console.log("city-hunter-hndzd episodes count:", ep2.data.length);
    console.log("First episode details:", ep2.data[0]);

  } catch (e) {
    console.error("Error during test:", e);
  }
  app.quit();
});
