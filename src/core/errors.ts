export class AgentError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public override readonly cause?: Error
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

export class ProviderError extends AgentError {
  constructor(message: string, public readonly provider: string, cause?: Error) {
    super(message, 'PROVIDER_ERROR', cause);
    this.name = 'ProviderError';
  }
}

export class ToolError extends AgentError {
  constructor(message: string, public readonly tool: string, cause?: Error) {
    super(message, 'TOOL_ERROR', cause);
    this.name = 'ToolError';
  }
}

export class GitError extends AgentError {
  constructor(message: string, public readonly operation: string, cause?: Error) {
    super(message, 'GIT_ERROR', cause);
    this.name = 'GitError';
  }
}

export class CommunicationError extends AgentError {
  constructor(message: string, public readonly channel: string, cause?: Error) {
    super(message, 'COMMUNICATION_ERROR', cause);
    this.name = 'CommunicationError';
  }
}

export class MemoryError extends AgentError {
  constructor(message: string, public readonly operation: string, cause?: Error) {
    super(message, 'MEMORY_ERROR', cause);
    this.name = 'MemoryError';
  }
}

export class TaskError extends AgentError {
  constructor(message: string, public readonly taskId: string, cause?: Error) {
    super(message, 'TASK_ERROR', cause);
    this.name = 'TaskError';
  }
}

export class SafetyError extends AgentError {
  constructor(message: string, public readonly permission: string, cause?: Error) {
    super(message, 'SAFETY_ERROR', cause);
    this.name = 'SafetyError';
  }
}

export class ValidationError extends AgentError {
  constructor(message: string, public readonly field: string, cause?: Error) {
    super(message, 'VALIDATION_ERROR', cause);
    this.name = 'ValidationError';
  }
}

export class AppError extends AgentError {
  constructor(message: string, cause?: Error) {
    super(message, 'APP_ERROR', cause);
    this.name = 'AppError';
  }
}