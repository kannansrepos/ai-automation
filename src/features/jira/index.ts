import { Router } from 'express';
import { handleJiraWebhook } from './jira.controller.js';

const router: Router = Router();

// Define the webhook route for JIRA notifications
router.post('/jira/webhook', handleJiraWebhook);

export { router as jiraWebhookRouter };
