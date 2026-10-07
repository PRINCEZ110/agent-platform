import { readFile, writeFile, mkdir, readdir, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { Message } from './messages.js';
import { ResultOrError, ok, err } from '@core/types.js';
import { CommunicationError } from '@core/errors.js';

const COMM_DIR = resolve(process.cwd(), '.ai', 'communication');

async function ensureDir(): Promise<void> {
  await mkdir(COMM_DIR, { recursive: true });
}

function getAgentDir(agentId: string): string {
  return join(COMM_DIR, agentId);
}

function getMessageFile(agentId: string, messageId: string): string {
  return join(getAgentDir(agentId), `${messageId}.json`);
}

function getInboxFile(agentId: string): string {
  return join(getAgentDir(agentId), 'inbox.json');
}

export const persistence = {
  async saveMessage(agentId: string, message: Message): Promise<ResultOrError<void>> {
    try {
      await ensureDir();
      await mkdir(getAgentDir(agentId), { recursive: true });

      const file = getMessageFile(agentId, message.id);
      await writeFile(file, JSON.stringify(message, null, 2), 'utf-8');

      const inboxFile = getInboxFile(agentId);
      let inbox: string[] = [];
      try {
        const content = await readFile(inboxFile, 'utf-8');
        inbox = JSON.parse(content);
      } catch {
        // Inbox doesn't exist yet
      }
      inbox.push(message.id);
      await writeFile(inboxFile, JSON.stringify(inbox, null, 2), 'utf-8');

      return ok(undefined);
    } catch (e) {
      return err(new CommunicationError(`Failed to save message: ${e instanceof Error ? e.message : 'Unknown error'}`, 'saveMessage', e instanceof Error ? e : undefined));
    }
  },

  async loadMessage(agentId: string, messageId: string): Promise<ResultOrError<Message>> {
    try {
      const file = getMessageFile(agentId, messageId);
      const content = await readFile(file, 'utf-8');
      return ok(JSON.parse(content) as Message);
    } catch (e) {
      return err(new CommunicationError(`Failed to load message: ${e instanceof Error ? e.message : 'Unknown error'}`, 'loadMessage', e instanceof Error ? e : undefined));
    }
  },

  async loadMessages(agentId: string, limit = 1000): Promise<Message[]> {
    try {
      const dir = getAgentDir(agentId);
      const files = await readdir(dir);
      const messageFiles = files.filter(f => f.endsWith('.json') && f !== 'inbox.json').sort().reverse().slice(0, limit);

      const messages: Message[] = [];
      for (const file of messageFiles) {
        const content = await readFile(join(dir, file), 'utf-8');
        messages.push(JSON.parse(content));
      }
      return messages;
    } catch {
      return [];
    }
  },

  async loadInbox(agentId: string): Promise<string[]> {
    try {
      const content = await readFile(getInboxFile(agentId), 'utf-8');
      return JSON.parse(content);
    } catch {
      return [];
    }
  },

  async markRead(agentId: string, messageId: string): Promise<ResultOrError<void>> {
    try {
      const inbox = await this.loadInbox(agentId);
      const filtered = inbox.filter(id => id !== messageId);
      await writeFile(getInboxFile(agentId), JSON.stringify(filtered, null, 2), 'utf-8');
      return ok(undefined);
    } catch (e) {
      return err(new CommunicationError(`Failed to mark read: ${e instanceof Error ? e.message : 'Unknown error'}`, 'markRead', e instanceof Error ? e : undefined));
    }
  },

  async clearInbox(agentId: string): Promise<ResultOrError<void>> {
    try {
      await writeFile(getInboxFile(agentId), '[]', 'utf-8');
      return ok(undefined);
    } catch (e) {
      return err(new CommunicationError(`Failed to clear inbox: ${e instanceof Error ? e.message : 'Unknown error'}`, 'clearInbox', e instanceof Error ? e : undefined));
    }
  }
};