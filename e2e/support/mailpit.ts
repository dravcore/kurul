import { expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { MAILPIT_URL } from '../stack-env';

/**
 * Reading the application's outgoing mail out of Mailpit.
 *
 * The alternative — flipping `emailVerified` in the database and taking the invitation id
 * straight from the `POST /invitations` response — would make the invitation scenario pass
 * without a single byte of mail ever being produced. That is precisely the part with no other
 * coverage: `WEB_URL` is what builds the accept link, and a wrong `WEB_URL` yields an
 * invitation nobody outside the developer's laptop can act on. The API's own tests assert on
 * the DTO, never on the message body.
 *
 * Mailpit is shared with the developer's `docker-compose.dev.yml` stack, so nothing here ever
 * deletes messages — every lookup is scoped to a recipient address the suite generated and
 * nobody else can have used.
 */

type MailpitSummary = {
  ID: string;
  Subject: string;
};

type MailpitMessage = {
  ID: string;
  Subject: string;
  Text: string;
  HTML: string;
};

export type Mailbox = {
  /**
   * Waits for a message to <address> whose subject contains <subjectContains>, and returns
   * its plain-text body.
   */
  waitForMessage(address: string, subjectContains: string): Promise<string>;
  dispose(): Promise<void>;
};

export async function openMailbox(): Promise<Mailbox> {
  const client = await playwrightRequest.newContext({ baseURL: MAILPIT_URL });

  return {
    async waitForMessage(address: string, subjectContains: string): Promise<string> {
      const id = await waitForMessageId(client, address, subjectContains);
      const response = await client.get(`/api/v1/message/${id}`);
      expect(response.ok(), `Mailpit returned ${response.status()} for message ${id}`).toBe(true);
      const message = (await response.json()) as MailpitMessage;
      return message.Text;
    },
    async dispose(): Promise<void> {
      await client.dispose();
    },
  };
}

async function waitForMessageId(
  client: APIRequestContext,
  address: string,
  subjectContains: string,
): Promise<string> {
  // `expect.poll` and not a sleep: SMTP delivery to a local Mailpit is normally sub-100ms,
  // but it is a second process reached over a socket, and the one thing a fixed wait
  // guarantees is that it will be too short on the machine that is busiest.
  let found = '';
  await expect
    .poll(
      async () => {
        // Mailpit's own search syntax. Scoping the query to the recipient is what makes this
        // safe against a shared inbox: the address was minted for this test.
        const query = encodeURIComponent(`to:"${address}"`);
        const response = await client.get(`/api/v1/search?query=${query}&limit=50`);
        if (!response.ok()) {
          return '';
        }
        const body = (await response.json()) as { messages?: MailpitSummary[] };
        const match = body.messages?.find((message) => message.Subject.includes(subjectContains));
        found = match?.ID ?? '';
        return found;
      },
      {
        message: `Mailpit never received a message to ${address} with "${subjectContains}" in the subject`,
        timeout: 15_000,
        intervals: [100, 200, 300, 500],
      },
    )
    .not.toBe('');

  return found;
}

/**
 * Pulls the one URL out of a mail body that points at <pathPrefix>.
 *
 * Both templates put the actionable link on its own line in the text part
 * (`apps/api/src/mail/mail-templates.ts`), which is why the text part is what the suite reads:
 * the HTML part carries the same URL entity-escaped (`&amp;`), and un-escaping it here would
 * mean the test could pass against a link no mail client could follow.
 */
export function extractLink(body: string, pathPrefix: string): string {
  const match = body.match(
    new RegExp(`https?://[^\\s"<>]*${escapeForRegExp(pathPrefix)}[^\\s"<>]*`),
  );
  if (!match) {
    throw new Error(`No ${pathPrefix} link in the mail body. Body was:\n${body}`);
  }
  return match[0];
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
