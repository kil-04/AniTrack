const cp = require('child_process');
try {
  console.log("Running Electron script synchronously...");
  const out = cp.execSync(`.\\node_modules\\electron\\dist\\electron.exe C:\\Users\\sanja\\.gemini\\antigravity-cli\\brain\\d8b50e46-2613-480d-ab1e-08de11b21795\\scratch\\test_anikoto_ordering.js`, { encoding: 'utf8' });
  console.log("Output:", out);
} catch (e) {
  console.error("Execution failed!");
  console.error("stdout:", e.stdout);
  console.error("stderr:", e.stderr);
}
