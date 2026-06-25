import app from './app.js';

const PORT = process.env.GITHUB_PORT || process.env.PORT || 3002;

app.listen(PORT, () => {
  console.log(`⚡️ [github-webhook-app]: Server is running at http://localhost:${PORT}`);
});
