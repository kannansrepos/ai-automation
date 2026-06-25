import app from './app.js';

const PORT = process.env.JIRA_PORT || process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`⚡️ [jira-webhook-app]: Server is running at http://localhost:${PORT}`);
});
