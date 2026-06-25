import { Router } from 'express';
import { jiraWebhookRouter } from './features/jira/index.js';

const apiRouter: Router = Router();

// Health Check
apiRouter.get('/health', (req, res) => {
  res.status(200).json({
    status: 'Jira-webhook-UP',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

apiRouter.use(jiraWebhookRouter);

export default apiRouter;
