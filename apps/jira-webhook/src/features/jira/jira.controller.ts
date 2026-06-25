import type { Request, Response } from 'express';
import { extractJiraWebhookFields } from '@git-auto-fix/shared';
import { generateTestsForJiraIssue } from './test-generator.service.js';

/**
 * Webhook handler to receive notifications when a JIRA issue/ticket is created.
 * Extracts details to log to the console and kicks off the background AI test generator pipeline.
 */
export const handleJiraWebhook = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const payload = req.body;

  const webhookEvent = payload?.webhookEvent;
  const issueKey = payload?.issue?.key;

  console.log(
    `\n=================== JIRA WEBHOOK RECEIVED ===================`,
  );
  console.log(`Event Type: ${webhookEvent || 'Unknown'}`);
  console.log(`Issue Key: ${issueKey || 'Unknown'}`);

  if (payload?.issue) {
    const summary = payload.issue.fields?.summary || 'No Summary';
    const { description, acceptanceCriteria, repository } =
      await extractJiraWebhookFields(payload);

    console.log(`Summary: ${summary}`);
    console.log(`------------------------------------------------------------`);
    console.log(`Description:\n${description}`);
    console.log(`------------------------------------------------------------`);
    console.log(`Acceptance Criteria:\n${acceptanceCriteria}`);
    console.log(`------------------------------------------------------------`);
    console.log(`Repository:\n${repository}`);
    console.log(
      `============================================================\n`,
    );

    // Trigger test generation asynchronously if the webhook is for issue creation/update and it is NOT a subtask
    const isSubtask = payload?.issue?.fields?.issuetype?.subtask || false;
    if (['jira:issue_created', 'jira:issue_updated'].includes(webhookEvent) && !isSubtask) {
      console.log(
        `[Jira Webhook] Triggering background AI test generation for issue: ${issueKey}`,
      );
      generateTestsForJiraIssue(payload).catch((error) => {
        console.error(
          `[Jira Webhook] Error running background test generation for ${issueKey}:`,
          error,
        );
      });
    }
  } else {
    console.log('No issue details found in payload.');
    console.log(
      `============================================================\n`,
    );
  }

  res.status(200).json({
    success: true,
    message: 'JIRA webhook processed successfully.',
  });
};
