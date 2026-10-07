import { createTool, ToolPermission, ToolResult } from './tool.js';
import { z } from 'zod';
import { ResultOrError, ok, err } from '@core/types.js';
import { ToolError } from '@core/errors.js';
import { spawn, SpawnOptions } from 'child_process';
import { once } from 'events';

const TerminalInputSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  timeout: z.number().positive().optional(),
  shell: z.boolean().optional()
});

type TerminalInput = z.infer<typeof TerminalInputSchema>;

interface TerminalOutput extends ToolResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export const terminalTool = createTool<TerminalInput, TerminalOutput>(
  'terminal',
  'Execute a terminal command with arguments',
  TerminalInputSchema,
  ['terminal.exec'],
  async (input) => {
    const { command, args = [], cwd = process.cwd(), env = {}, timeout = 30000, shell = false } = input;

    return new Promise<ResultOrError<TerminalOutput>>((resolve) => {
      const child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        shell,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => { stdout += data.toString(); });
      child.stderr?.on('data', (data) => { stderr += data.toString(); });

      const timeoutHandle = setTimeout(() => {
        child.kill('SIGTERM');
        resolve(err(new ToolError(`Command timed out after ${timeout}ms`, 'terminal')));
      }, timeout);

      child.on('error', (error) => {
        clearTimeout(timeoutHandle);
        resolve(err(new ToolError(`Failed to spawn: ${error.message}`, 'terminal', error)));
      });

      const handleExit = () => {
        clearTimeout(timeoutHandle);
        const exitCode = child.exitCode;
        resolve(ok({
          success: exitCode === 0,
          stdout,
          stderr,
          exitCode,
          output: { stdout, stderr, exitCode }
        }));
      };

      child.on('exit', handleExit);
      child.on('close', handleExit);
    });
  },
  { timeout: 60000 }
);

const TerminalReadInputSchema = z.object({
  pid: z.number()
});

type TerminalReadInput = z.infer<typeof TerminalReadInputSchema>;

interface TerminalReadOutput extends ToolResult {
  stdout: string;
  stderr: string;
}

const runningProcesses = new Map<number, { child: ReturnType<typeof spawn>; stdout: string; stderr: string }>();

export const terminalReadTool = createTool<TerminalReadInput, TerminalReadOutput>(
  'terminal.read',
  'Read output from a running terminal process',
  TerminalReadInputSchema,
  ['terminal.read'],
  async (input) => {
    const process = runningProcesses.get(input.pid);
    if (!process) {
      return err(new ToolError(`Process not found: ${input.pid}`, 'terminal.read'));
    }
    return ok({
      success: true,
      stdout: process.stdout,
      stderr: process.stderr,
      output: { stdout: process.stdout, stderr: process.stderr }
    });
  }
);

export const terminalWriteTool = createTool<{ pid: number; data: string }, ToolResult>(
  'terminal.write',
  'Write input to a running terminal process',
  z.object({ pid: z.number(), data: z.string() }),
  ['terminal.exec'],
  async (input) => {
    const process = runningProcesses.get(input.pid);
    if (!process) {
      return err(new ToolError(`Process not found: ${input.pid}`, 'terminal.write'));
    }
    process.child.stdin?.write(input.data);
    return ok({ success: true });
  }
);