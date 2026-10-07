export interface Result<T, E = Error> {
  ok: true;
  value: T;
}

export interface Err<T, E = Error> {
  ok: false;
  error: E;
}

export type ResultOrError<T, E = Error> = Result<T, E> | Err<T, E>;

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: ResultOrError<T, E>): result is Result<T, E> {
  return result.ok;
}

export function isErr<T, E>(result: ResultOrError<T, E>): result is Err<T, E> {
  return !result.ok;
}