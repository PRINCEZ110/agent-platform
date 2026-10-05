import { describe, it, expect } from 'vitest';
import {
  AgentError,
  ProviderError,
  ToolError,
  GitError,
  CommunicationError,
  MemoryError,
  TaskError,
  SafetyError,
  ValidationError,
  AppError
} from '../../src/core/errors.js';

describe('AgentError hierarchy', () => {
  it('is an Error subclass with code and optional cause', () => {
    const cause = new Error('root');
    const error = new AgentError('base failure', 'BASE_CODE', cause);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AgentError);
    expect(error.name).toBe('AgentError');
    expect(error.code).toBe('BASE_CODE');
    expect(error.cause).toBe(cause);
    expect(error.message).toBe('base failure');
    expect(error.stack).toBeDefined();
  });

  it('works without a cause', () => {
    const error = new AgentError('no cause', 'X');
    expect(error.cause).toBeUndefined();
  });
});

describe('specialised error types', () => {
  it('ProviderError carries the provider name', () => {
    const e = new ProviderError('model unavailable', 'openai');
    expect(e).toBeInstanceOf(AgentError);
    expect(e.name).toBe('ProviderError');
    expect(e.code).toBe('PROVIDER_ERROR');
    expect(e.provider).toBe('openai');
  });

  it('ToolError carries the tool name', () => {
    const e = new ToolError('tool failed', 'terminal');
    expect(e.name).toBe('ToolError');
    expect(e.code).toBe('TOOL_ERROR');
    expect(e.tool).toBe('terminal');
  });

  it('GitError carries the operation', () => {
    const e = new GitError('merge conflict', 'merge');
    expect(e.name).toBe('GitError');
    expect(e.code).toBe('GIT_ERROR');
    expect(e.operation).toBe('merge');
  });

  it('CommunicationError carries the channel', () => {
    const e = new CommunicationError('bus down', 'publish');
    expect(e.name).toBe('CommunicationError');
    expect(e.code).toBe('COMMUNICATION_ERROR');
    expect(e.channel).toBe('publish');
  });

  it('MemoryError carries the operation', () => {
    const e = new MemoryError('index corrupted', 'embed');
    expect(e.name).toBe('MemoryError');
    expect(e.code).toBe('MEMORY_ERROR');
    expect(e.operation).toBe('embed');
  });

  it('TaskError carries the task id', () => {
    const e = new TaskError('task missing', 'TASK-017');
    expect(e.name).toBe('TaskError');
    expect(e.code).toBe('TASK_ERROR');
    expect(e.taskId).toBe('TASK-017');
  });

  it('SafetyError carries the permission', () => {
    const e = new SafetyError('permission denied', 'fs.delete');
    expect(e.name).toBe('SafetyError');
    expect(e.code).toBe('SAFETY_ERROR');
    expect(e.permission).toBe('fs.delete');
  });

  it('ValidationError carries the field', () => {
    const e = new ValidationError('required field missing', 'task_id');
    expect(e.name).toBe('ValidationError');
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.field).toBe('task_id');
  });

  it('AppError carries only the message', () => {
    const e = new AppError('startup failed');
    expect(e.name).toBe('AppError');
    expect(e.code).toBe('APP_ERROR');
    expect(e.message).toBe('startup failed');
  });

  it('every specialised error remains catchable as AgentError', () => {
    const errors = [
      new ProviderError('m', 'p'),
      new ToolError('m', 't'),
      new GitError('m', 'o'),
      new CommunicationError('m', 'c'),
      new MemoryError('m', 'o'),
      new TaskError('m', 'id'),
      new SafetyError('m', 'perm'),
      new ValidationError('m', 'f'),
      new AppError('m')
    ];
    for (const e of errors) {
      expect(e).toBeInstanceOf(AgentError);
      expect(e).toBeInstanceOf(Error);
      expect(e.code).toBeTruthy();
    }
  });
});
