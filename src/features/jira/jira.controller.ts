import type { Request, Response } from 'express';
import { extractJiraWebhookFields } from '../../core/jira/jira.service.js';

/**
 * Webhook handler to receive notifications when a JIRA issue/ticket is created.
 * Extracts the description and acceptance criteria from the payload and logs them to the console.
 */
export const handleJiraWebhook = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const payload = req.body;

  // Verify that it is a JIRA event
  const webhookEvent = payload?.webhookEvent;
  const issueKey = payload?.issue?.key;

  console.log(`\n=================== JIRA WEBHOOK RECEIVED ===================`);
  console.log(`Event Type: ${webhookEvent || 'Unknown'}`);
  console.log(`Issue Key: ${issueKey || 'Unknown'}`);

  if (payload?.issue) {
    const summary = payload.issue.fields?.summary || 'No Summary';
    const { description, acceptanceCriteria, repository } = await extractJiraWebhookFields(payload);

    console.log(`Summary: ${summary}`);
    console.log(`------------------------------------------------------------`);
    console.log(`Description:\n${description}`);
    console.log(`------------------------------------------------------------`);
    console.log(`Acceptance Criteria:\n${acceptanceCriteria}`);
    console.log(`------------------------------------------------------------`);
    console.log(`Repository:\n${repository}`);
    console.log(`============================================================\n`);
  } else {
    console.log('No issue details found in payload.');
    console.log(`============================================================\n`);
  }

  res.status(200).json({
    success: true,
    message: 'JIRA webhook processed successfully.',
  });
};
