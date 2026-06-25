import { Router } from 'express';
import { handleBuildFailureCallbackRouter } from './features/auto-fix-build-failure/index.js';

const apiRouter: Router = Router();

// Health Check
apiRouter.get('/health', (req, res) => {
  res.status(200).json({
    status: 'GitHub-webhook-UP',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

apiRouter.use(handleBuildFailureCallbackRouter);

export default apiRouter;
