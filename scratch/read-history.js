const fs = require('fs');
const path = require('path');

const logPath = 'C:\\Users\\sanja\\.gemini\\antigravity-cli\\brain\\74619758-5cbc-4dcb-8022-d80e7f59f20b\\.system_generated\\logs\\transcript.jsonl';

console.log('Reading transcript:', logPath);
try {
  const content = fs.readFileSync(logPath, 'utf8');
  const lines = content.split('\n');
  const userMessages = [];
  const resolves = [];
  
  lines.forEach(line => {
    if (!line.trim()) return;
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'USER_INPUT') {
        userMessages.push(obj.content);
      }
      // Check for resolveStream logs or parameters in tool calls
      if (obj.tool_calls) {
        obj.tool_calls.forEach(tc => {
          if (tc.name === 'run_command' || tc.name === 'replace_file_content' || tc.name === 'write_to_file') {
            const str = JSON.stringify(tc.arguments);
            if (str.includes('watch') || str.includes('anikoto') || str.includes('anime')) {
              resolves.push(str.substring(0, 300));
            }
          }
        });
      }
    } catch (e) {}
  });

  console.log('\n--- Past User Messages ---');
  console.log(userMessages.slice(-30));

  console.log('\n--- Interesting tool logs ---');
  console.log(resolves.slice(-15));
} catch (err) {
  console.error(err);
}
