import { Router } from 'express';
import { getHealthStatusRouter } from './features/get-health-status/index.js';
import { handleBuildFailureCallbackRouter } from './features/auto-fix-build-failure/index.js';
import { jiraWebhookRouter } from './features/jira/index.js';

const apiRouter: Router = Router();

apiRouter.use(getHealthStatusRouter);
apiRouter.use(handleBuildFailureCallbackRouter);
apiRouter.use(jiraWebhookRouter);

export default apiRouter;
