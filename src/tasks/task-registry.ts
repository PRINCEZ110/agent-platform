import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { ResultOrError, ok, err } from '@core/types.js';
import { TaskError } from '@core/errors.js';

export interface Task {
  task_id: string;
  owner: 'agent_a' | 'agent_b';
  description: string;
  status: 'PLANNED' | 'READY' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'COMPLETED' | 'ABANDONED';
  files: string[];
  dependencies: string[];
  expected_output: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

const TASKS_PATH = resolve(process.cwd(), '.ai', 'active-tasks.json');

export class TaskRegistry {
  private tasks = new Map<string, Task>();

  async load(): Promise<ResultOrError<Task[]>> {
    try {
      const content = await readFile(TASKS_PATH, 'utf-8');
      const data = JSON.parse(content);
      this.tasks.clear();
      for (const task of data.tasks) {
        this.tasks.set(task.task_id, {
          ...task,
          createdAt: new Date(task.createdAt),
          updatedAt: new Date(task.updatedAt),
          startedAt: task.startedAt ? new Date(task.startedAt) : undefined,
          completedAt: task.completedAt ? new Date(task.completedAt) : undefined
        });
      }
      return ok(Array.from(this.tasks.values()));
    } catch (e) {
      return err(new TaskError(`Failed to load tasks: ${e instanceof Error ? e.message : 'Unknown error'}`, 'registry'));
    }
  }

  async save(): Promise<ResultOrError<void>> {
    try {
      const data = { tasks: Array.from(this.tasks.values()) };
      await writeFile(TASKS_PATH, JSON.stringify(data, null, 2), 'utf-8');
      return ok(undefined);
    } catch (e) {
      return err(new TaskError(`Failed to save tasks: ${e instanceof Error ? e.message : 'Unknown error'}`, 'registry'));
    }
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  getTasksByOwner(owner: 'agent_a' | 'agent_b'): Task[] {
    return Array.from(this.tasks.values()).filter(t => t.owner === owner);
  }

  getTasksByStatus(status: Task['status']): Task[] {
    return Array.from(this.tasks.values()).filter(t => t.status === status);
  }

  async createTask(task: Omit<Task, 'createdAt' | 'updatedAt'>): Promise<ResultOrError<Task>> {
    if (this.tasks.has(task.task_id)) {
      return err(new TaskError(`Task already exists: ${task.task_id}`, task.task_id));
    }

    const newTask: Task = {
      ...task,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.tasks.set(task.task_id, newTask);
    await this.save();
    return ok(newTask);
  }

  async updateTask(id: string, updates: Partial<Omit<Task, 'task_id' | 'createdAt'>>): Promise<ResultOrError<Task>> {
    const task = this.tasks.get(id);
    if (!task) return err(new TaskError(`Task not found: ${id}`, id));

    const updated: Task = {
      ...task,
      ...updates,
      updatedAt: new Date(),
      startedAt: updates.status === 'IN_PROGRESS' && !task.startedAt ? new Date() : task.startedAt,
      completedAt: updates.status === 'COMPLETED' && !task.completedAt ? new Date() : task.completedAt
    };

    this.tasks.set(id, updated);
    await this.save();
    return ok(updated);
  }

  async setStatus(id: string, status: Task['status']): Promise<ResultOrError<Task>> {
    return this.updateTask(id, { status });
  }

  async deleteTask(id: string): Promise<ResultOrError<void>> {
    if (!this.tasks.has(id)) return err(new TaskError(`Task not found: ${id}`, id));
    this.tasks.delete(id);
    await this.save();
    return ok(undefined);
  }

  getDependencies(id: string): Task[] {
    const task = this.tasks.get(id);
    if (!task) return [];
    return task.dependencies.map(dep => this.tasks.get(dep)).filter(Boolean) as Task[];
  }

  getDependents(id: string): Task[] {
    return Array.from(this.tasks.values()).filter(t => t.dependencies.includes(id));
  }

  canStart(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (task.status !== 'PLANNED' && task.status !== 'READY') return false;
    return this.getDependencies(id).every(d => d.status === 'COMPLETED');
  }

  getReadyTasks(owner?: 'agent_a' | 'agent_b'): Task[] {
    return this.getAllTasks().filter(t => {
      if (owner && t.owner !== owner) return false;
      return this.canStart(t.task_id);
    });
  }
}

export const taskRegistry = new TaskRegistry();